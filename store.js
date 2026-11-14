// 旅のしおり：Firebase（Firestore + 匿名認証）とのやり取り。みんなで編集中の旅行だけを扱う。
// Firebase の SDK は外から渡す（ブラウザは CDN、テストは npm パッケージ）。
//
// データ：trips/{tripId}（name, dest, start, end, bookTheme, planStart, planEnd, memberUids[], createdAt）
//         trips/{tripId}/items|wishes|packs/{docId}（1件 1文書）
const BATCH_SIZE = 400;
const KINDS = ["items", "wishes", "packs"];

function err(code, message) {
  const e = new Error(message || code);
  e.code = code;
  return e;
}

// 自動で入れる予定の文書 ID は番号で決める（auto + 16桁）。二人が同時に「追加」しても同じ ID に
// 上書きされるだけなので、二重にならない。
const autoDocId = (i) => "auto" + String(i).padStart(16, "0");

// 推測できない 22文字の旅行 ID（128bit、URL 安全な base64）
function newTripId() {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([k, v]) => k !== "id" && v !== undefined));
const TRIP_FIELDS = ["name", "dest", "start", "end", "bookTheme", "planStart", "planEnd"];

export function createStore(fb, firebaseConfig, opts = {}) {
  const { initializeApp, deleteApp } = fb.app;
  const { getAuth, signInAnonymously, onAuthStateChanged } = fb.auth;
  const F = fb.firestore;

  const app = initializeApp(firebaseConfig, opts.appName || "[DEFAULT]");
  const auth = getAuth(app);
  const db = opts.persistent
    ? F.initializeFirestore(app, { localCache: F.persistentLocalCache({ tabManager: F.persistentMultipleTabManager() }) })
    : F.getFirestore(app);
  let uid = null;

  const tripRef = (id) => F.doc(db, "trips", id);
  const sub = (id, kind) => F.collection(db, "trips", id, kind);
  const withId = (d) => ({ id: d.id, ...d.data() });

  // onSnapshot は一度エラー（権限拒否など）になると止まる。作成・参加の直後はサーバーへの反映前で
  // 拒否されることがあるので、少し待ってやり直す（1, 2, 4, 8, 16 秒、計 5 回まで）。
  function listen(target, onData, onGiveUp = () => {}) {
    let stopped = false;
    let unsub = () => {};
    let tries = 0;
    const start = () => {
      unsub = F.onSnapshot(target, (s) => { tries = 0; onData(s); }, (e) => {
        if (stopped) return;
        if (tries >= 5) { console.warn("listen stopped:", e.code || e.message); return onGiveUp(e); }
        setTimeout(() => { if (!stopped) start(); }, 1000 * 2 ** tries++);
      });
    };
    start();
    return () => { stopped = true; unsub(); };
  }

  // 前回の匿名ユーザーがこの端末に残っていればそれを使い、なければ新しく作る（初回は通信が必要）
  async function init() {
    const existing = await new Promise((resolve) => {
      const unsub = onAuthStateChanged(auth, (u) => { unsub(); resolve(u); });
    });
    uid = existing ? existing.uid : (await signInAnonymously(auth)).user.uid;
    return uid;
  }

  async function close() {
    await F.terminate(db);
    await deleteApp(app);
  }

  // サーバーに届くか確かめる（圏外なら code "offline"）
  async function requireOnline() {
    try {
      await F.getDocFromServer(tripRef("connectivity-check-0000"));
    } catch (e) {
      if (e.code === "permission-denied") return; // 届いてはいる
      throw err("offline", "インターネットにつながっていません");
    }
  }

  // ---- 旅行の一覧（自分が参加しているもの。中身は watchTrip で） ----
  function watchTrips(cb) {
    const q = F.query(F.collection(db, "trips"), F.where("memberUids", "array-contains", uid));
    return listen(q, (s) => cb(s.docs.map(withId).sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))));
  }

  // ---- 1つの旅行を、中身（予定・行きたい場所・持ち物）ごとまとめて見張る ----
  // cb({ id, cloud: true, ...旅行の情報, items, wishes, packs })。旅行が消えたら cb(null)
  function watchTrip(id, cb) {
    const parts = { trip: undefined, items: undefined, wishes: undefined, packs: undefined };
    const emit = () => {
      if (Object.values(parts).some((v) => v === undefined)) return; // まだそろっていない
      if (parts.trip === null) return cb(null);
      cb({ ...parts.trip, id, cloud: true, items: parts.items, wishes: parts.wishes, packs: parts.packs });
    };
    const unsubs = [
      listen(tripRef(id), (s) => { parts.trip = s.exists() ? s.data() : null; emit(); }, () => { parts.trip = null; emit(); }),
      ...KINDS.map((k) => listen(sub(id, k), (s) => { parts[k] = s.docs.map(withId); emit(); })),
    ];
    return () => unsubs.forEach((u) => u());
  }

  // ---- スマホ保存の旅行をクラウドへ上げる（通信が必要。圏外なら何も作らずに code "offline"） ----
  async function createTripFromLocal(t) {
    await requireOnline();
    const id = newTripId();
    const head = { ...Object.fromEntries(TRIP_FIELDS.filter((k) => t[k] !== undefined).map((k) => [k, t[k]])),
      memberUids: [uid], createdAt: Date.now() };
    await F.setDoc(tripRef(id), head);
    const writes = [];
    for (const it of t.items || []) writes.push([F.doc(sub(id, "items")), clean(it)]);
    for (const w of t.wishes || []) writes.push([F.doc(sub(id, "wishes")), clean(w)]);
    const packIds = {};
    for (const p of t.packs || []) {
      const ref = F.doc(sub(id, "packs"));
      packIds[p.id] = ref.id;
      writes.push([ref, { name: p.name }]); // チェックは人ごとなので送らない
    }
    for (const part of chunk(writes, BATCH_SIZE)) {
      const batch = F.writeBatch(db);
      for (const [ref, data] of part) batch.set(ref, data);
      await batch.commit();
    }
    return { id, packIds }; // packIds：元の持ち物 ID → クラウドの ID（チェックの引き継ぎ用）
  }

  async function joinTrip(id) {
    let snap;
    try {
      snap = await F.getDocFromServer(tripRef(id));
    } catch (e) {
      throw err("offline", "旅行を確認できませんでした（通信を確認してください）");
    }
    if (!snap.exists()) throw err("not-found", "旅行が見つかりません");
    if ((snap.data().memberUids || []).includes(uid)) return;
    try {
      await F.updateDoc(tripRef(id), { memberUids: F.arrayUnion(uid) });
    } catch (e) {
      if (e.code === "permission-denied") throw err("full", "この旅行は参加できる人数の上限に達しています");
      throw e;
    }
  }

  // 自分の一覧から外す。最後の 1人なら旅行ごと削除する（誰も入れない旅行を残さないため）
  async function leaveTrip(id) {
    let snap;
    try { snap = await F.getDocFromServer(tripRef(id)); } catch (e) { throw err("offline", "インターネットにつながっていません"); }
    if (!snap.exists()) return "deleted";
    const members = snap.data().memberUids || [];
    if (members.length <= 1) { await deleteTrip(id); return "deleted"; }
    await F.updateDoc(tripRef(id), { memberUids: F.arrayRemove(uid) });
    return "left";
  }

  // 中身を先に消し、最後に旅行を消す（旅行が先に消えるとルール上、中身を消せなくなる）
  async function deleteTrip(id) {
    for (const k of KINDS) {
      const snap = await F.getDocs(sub(id, k));
      for (const part of chunk(snap.docs, BATCH_SIZE)) {
        const batch = F.writeBatch(db);
        for (const d of part) batch.delete(d.ref);
        await batch.commit();
      }
    }
    await F.deleteDoc(tripRef(id));
  }

  function updateTrip(id, fields) {
    return F.updateDoc(tripRef(id), clean(fields));
  }

  async function addEntry(id, kind, data) {
    const ref = F.doc(sub(id, kind));
    await F.setDoc(ref, clean(data));
    return ref.id;
  }

  function updateEntry(id, kind, docId, fields) {
    return F.updateDoc(F.doc(sub(id, kind), docId), clean(fields));
  }

  function deleteEntry(id, kind, docId) {
    return F.deleteDoc(F.doc(sub(id, kind), docId));
  }

  // 並べ替えたあとの日付・時刻をまとめて書く。changes: [{ id, date, time }]
  async function retimeItems(id, changes) {
    for (const part of chunk(changes, BATCH_SIZE)) {
      const batch = F.writeBatch(db);
      for (const c of part) batch.update(F.doc(sub(id, "items"), c.id), { date: c.date, time: c.time });
      await batch.commit();
    }
  }

  // 自動で入れた予定を入れ替える。新しい予定は番号の決まった ID に書き、それ以外の自動の予定は消す
  async function replaceAutoItems(id, newItems) {
    const keep = new Set(newItems.map((_, i) => autoDocId(i)));
    const old = await F.getDocs(F.query(sub(id, "items"), F.where("auto", "==", true)));
    const writes = [
      ...newItems.map((it, i) => (b) => b.set(F.doc(sub(id, "items"), autoDocId(i)), { ...clean(it), auto: true })),
      ...old.docs.filter((d) => !keep.has(d.id)).map((d) => (b) => b.delete(d.ref)),
    ];
    for (const part of chunk(writes, BATCH_SIZE)) {
      const batch = F.writeBatch(db);
      for (const w of part) w(batch);
      await batch.commit();
    }
  }

  return {
    get uid() { return uid; },
    init, close, watchTrips, watchTrip, createTripFromLocal, joinTrip, leaveTrip, deleteTrip,
    updateTrip, addEntry, updateEntry, deleteEntry, retimeItems, replaceAutoItems,
  };
}

export { newTripId, autoDocId };
