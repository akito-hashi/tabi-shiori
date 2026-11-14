// 本物の Firebase に対するテスト（npm run test:firebase）。各テストは自分で作った旅行を最後に削除する。
import test, { after } from "node:test";
import assert from "node:assert/strict";
import { newDevice, closeAll, waitFor, rejectsWithCode, rawDbOf, fb } from "./helpers.mjs";

after(closeAll);
const F = fb.firestore;

const localTrip = () => ({
  id: "local1", name: "_test_金沢", dest: "金沢", start: "2026-12-18", end: "2026-12-19", bookTheme: "washoku", planStart: "09:00", planEnd: "18:00",
  items: [{ id: "i1", date: "2026-12-18", time: "08:12", kind: "move", title: "新幹線", place: "東京駅", memo: "予約 4821", duration: 60 }],
  wishes: [{ id: "w1", name: "兼六園", area: "兼六園周辺", duration: 90, kind: "sight", day: "" }],
  packs: [{ id: "p1", name: "財布", done: true }, { id: "p2", name: "カイロ", done: false }],
});
const watch = (s, id, pred, ms) => waitFor((cb) => s.watchTrip(id, cb), (t) => t && pred(t), ms);

test("スマホ保存の旅行を上げると、参加した別の端末が中身ごと見られる（チェックは送らない）", async () => {
  const a = await newDevice();
  const b = await newDevice();
  const { id, packIds } = await a.createTripFromLocal(localTrip());
  try {
    assert.match(id, /^[A-Za-z0-9_-]{22}$/);
    assert.ok(packIds.p1 && packIds.p2);
    await b.joinTrip(id);
    const t = await watch(b, id, (t) => t.items.length === 1 && t.wishes.length === 1 && t.packs.length === 2);
    assert.equal(t.cloud, true);
    assert.equal(t.name, "_test_金沢");
    assert.equal(t.bookTheme, "washoku");
    assert.equal(t.items[0].memo, "予約 4821");
    assert.ok(t.packs.every((p) => !("done" in p)));
    const list = await waitFor((cb) => b.watchTrips(cb), (ts) => ts.some((x) => x.id === id));
    assert.ok(list.find((x) => x.id === id));
  } finally { await a.deleteTrip(id); }
});

test("一方の変更（追加・変更・削除・旅行の情報）が、もう一方にすぐ届く", async () => {
  const a = await newDevice();
  const b = await newDevice();
  const { id } = await a.createTripFromLocal(localTrip());
  try {
    await b.joinTrip(id);
    const t0 = await watch(b, id, (t) => t.items.length === 1);
    const newId = await a.addEntry(id, "items", { date: "2026-12-19", time: "10:00", kind: "sight", title: "兼六園" });
    await a.updateEntry(id, "items", t0.items[0].id, { title: "北陸新幹線" });
    await a.updateTrip(id, { name: "_test_金沢（改）" });
    await a.deleteEntry(id, "wishes", t0.wishes[0].id);
    const t = await watch(b, id, (t) => t.items.length === 2 && t.wishes.length === 0 && t.name === "_test_金沢（改）"
      && t.items.some((i) => i.title === "北陸新幹線"));
    assert.ok(t.items.some((i) => i.id === newId));
  } finally { await a.deleteTrip(id); }
});

test("時刻のまとめ書きと、自動の予定の入れ替え（同時に 2回入れても二重にならない）", async () => {
  const a = await newDevice();
  const b = await newDevice();
  const { id } = await a.createTripFromLocal(localTrip());
  try {
    await b.joinTrip(id);
    const t0 = await watch(a, id, (t) => t.items.length === 1);
    await a.retimeItems(id, [{ id: t0.items[0].id, date: "2026-12-19", time: "07:00" }]);
    const plan = [{ date: "2026-12-18", time: "09:00", kind: "sight", title: "兼六園", place: "兼六園", duration: 90, area: "x", auto: true },
      { date: "2026-12-18", time: "12:00", kind: "food", title: "昼食", place: "", duration: 60, area: "", auto: true }];
    await Promise.all([a.replaceAutoItems(id, plan), b.replaceAutoItems(id, plan)]);
    let t = await watch(a, id, (t) => t.items.filter((i) => i.auto).length === 2);
    assert.equal(t.items.length, 3);
    assert.equal(t.items.find((i) => !i.auto).time, "07:00");
    // 作り直し（1件に減る）→ 余った自動の予定は消え、自分で入れた予定は残る
    await a.replaceAutoItems(id, plan.slice(0, 1));
    t = await watch(a, id, (t) => t.items.filter((i) => i.auto).length === 1);
    assert.equal(t.items.length, 2);
  } finally { await a.deleteTrip(id); }
});

test("2人いるときに抜けると自分の一覧からだけ消え、最後の 1人が抜けると旅行が消える", async () => {
  const a = await newDevice();
  const b = await newDevice();
  const { id } = await a.createTripFromLocal(localTrip());
  await b.joinTrip(id);
  assert.equal(await b.leaveTrip(id), "left");
  await waitFor((cb) => b.watchTrips(cb), (ts) => !ts.some((x) => x.id === id));
  await watch(a, id, () => true); // a にはまだ見える
  assert.equal(await a.leaveTrip(id), "deleted");
  await rejectsWithCode(b.joinTrip(id), "not-found");
});

test("存在しない旅行への参加は not-found", async () => {
  const a = await newDevice();
  await rejectsWithCode(a.joinTrip("AAAAAAAAAAAAAAAAAAAAAA"), "not-found");
});

test("他人を外す・参加と同時に書き換える・形のおかしい ID は拒否される", async () => {
  const a = await newDevice();
  const b = await newDevice();
  const { id } = await a.createTripFromLocal(localTrip());
  try {
    await b.joinTrip(id);
    const db = rawDbOf(b);
    await rejectsWithCode(F.updateDoc(F.doc(db, "trips", id), { memberUids: [b.uid] }), "permission-denied");
    await rejectsWithCode(F.setDoc(F.doc(db, "trips", id, "items", '"><img>'), { title: "x" }), "permission-denied");
    await rejectsWithCode(F.setDoc(F.doc(db, "trips", id, "secrets", "AAAAAAAAAAAAAAAAAAAA"), { x: 1 }), "permission-denied");
  } finally { await a.deleteTrip(id); }
});

test("圏外で上げようとすると offline になり、何も作られない", async () => {
  const a = await newDevice();
  const db = rawDbOf(a);
  await F.disableNetwork(db);
  try {
    await rejectsWithCode(a.createTripFromLocal({ ...localTrip(), name: "_test_圏外" }), "offline");
  } finally { await F.enableNetwork(db); }
  // サーバーに問い合わせて、この名前の旅行が作られていないことを確かめる
  const s = await F.getDocsFromServer(F.query(F.collection(db, "trips"), F.where("memberUids", "array-contains", a.uid)));
  assert.ok(!s.docs.some((d) => d.data().name === "_test_圏外"));
});

// ---- 見直しで見つかった問題の再現 ----

test("上げた旅行の持ち物・行きたい場所は元の順に並び、あとから足したものは最後に来る", async () => {
  const a = await newDevice();
  const t0 = localTrip();
  t0.packs = ["財布", "スマホ", "充電器", "着替え", "常備薬", "保険証", "ハンカチ", "折りたたみ傘", "カイロ", "手袋"].map((name, i) => ({ id: "p" + i, name, done: false }));
  t0.wishes = ["兼六園", "金沢城", "21世紀美術館", "ひがし茶屋街", "近江町市場"].map((name, i) => ({ id: "w" + i, name, area: "x", duration: 60, kind: "sight", day: "" }));
  const { id } = await a.createTripFromLocal(t0);
  try {
    await a.addEntry(id, "packs", { name: "モバイルバッテリー" });
    const t = await watch(a, id, (t) => t.packs.length === 11);
    assert.deepEqual(t.packs.map((p) => p.name), [...t0.packs.map((p) => p.name), "モバイルバッテリー"]);
    assert.deepEqual(t.wishes.map((w) => w.name), t0.wishes.map((w) => w.name));
  } finally { await a.deleteTrip(id); }
});

test("文書の中に id という項目が入っていても、本当の文書 ID が使われる", async () => {
  const a = await newDevice();
  const { id } = await a.createTripFromLocal(localTrip());
  try {
    const t0 = await watch(a, id, (t) => t.items.length === 1);
    await F.updateDoc(F.doc(rawDbOf(a), "trips", id, "items", t0.items[0].id), { id: "fake" });
    const t = await watch(a, id, (t) => t.items.length === 1 && "title" in t.items[0]);
    assert.equal(t.items[0].id, t0.items[0].id);
  } finally { await a.deleteTrip(id); }
});

test("圏外では旅行を削除できず offline になり、中身も消えない", async () => {
  const a = await newDevice();
  const { id } = await a.createTripFromLocal(localTrip());
  const db = rawDbOf(a);
  try {
    await watch(a, id, (t) => t.items.length === 1);
    await F.disableNetwork(db);
    await rejectsWithCode(a.deleteTrip(id), "offline");
    await F.enableNetwork(db);
    const s = await F.getDocsFromServer(F.collection(db, "trips", id, "items"));
    assert.equal(s.size, 1);
  } finally { await F.enableNetwork(db); await a.deleteTrip(id); }
});

test("上げるときは旅行本体と中身を一度に書く（中身の欠けた旅行が一覧に出ない）", async () => {
  const a = await newDevice();
  const seen = [];
  const stop = a.watchTrips((ts) => seen.push(...ts.filter((x) => x.name === "_test_一括").map((x) => x.id)));
  const { id } = await a.createTripFromLocal({ ...localTrip(), name: "_test_一括" });
  try {
    // 一覧に出た瞬間に、中身（予定・行きたい場所・持ち物）がすべてそろっている
    const t = await watch(a, id, () => true);
    assert.equal(t.items.length, 1);
    assert.equal(t.wishes.length, 1);
    assert.equal(t.packs.length, 2);
    assert.ok(seen.includes(id));
  } finally { stop(); await a.deleteTrip(id); }
});
