// firestore.rules を本番の Firebase に対して確認する。
// 使い方: tabi-shiori フォルダで `npm install` のあと `npm run check:rules`。
// 確認用の旅行と匿名ユーザー約50件を作り、旅行は最後に削除する（匿名ユーザーの作成は 1時間に約100件までなので、何度も続けて動かさない）。
import { initializeApp } from "firebase/app";
import { getAuth, signInAnonymously } from "firebase/auth";
import {
  getFirestore, doc, setDoc, getDoc, updateDoc, deleteDoc, addDoc, collection, getDocs, query, where, arrayUnion, arrayRemove, terminate,
} from "firebase/firestore";
import { firebaseConfig } from "../firebase-config.js";
import { newTripId } from "../store.js";

let n = 0;
async function client() {
  const app = initializeApp(firebaseConfig, "c" + n++);
  const cred = await signInAnonymously(getAuth(app));
  return { db: getFirestore(app), uid: cred.user.uid };
}

let pass = 0, fail = 0;
async function expect(label, shouldSucceed, fn) {
  let ok, err = "";
  try { await fn(); ok = true; } catch (e) { ok = false; err = e.code || e.message; }
  const good = ok === shouldSucceed;
  good ? pass++ : fail++;
  console.log(`${good ? "PASS" : "FAIL"}  ${label}  (期待: ${shouldSucceed ? "許可" : "拒否"} / 結果: ${ok ? "許可" : "拒否 " + err})`);
}

const tripId = newTripId();
const owner = await client();
const outsider = await client();
const joiner = await client();
const clients = [];
const tripRef = (c) => doc(c.db, "trips", tripId);
const trip = (uids) => ({ name: "_test_", start: "2026-12-18", end: "2026-12-19", memberUids: uids, createdAt: Date.now() });

try {
  await expect("旅行の作成（作成者のみ memberUids）", true, () => setDoc(tripRef(owner), trip([owner.uid])));
  await expect("他人を memberUids に入れた旅行の作成", false, () => setDoc(doc(owner.db, "trips", newTripId()), trip([owner.uid, "x"])));
  await expect("参加者が予定を追加", true, () => addDoc(collection(owner.db, "trips", tripId, "items"), { title: "兼六園" }));
  await expect("参加者が持ち物を追加", true, () => addDoc(collection(owner.db, "trips", tripId, "packs"), { name: "財布" }));
  await expect("決められた以外の中身（secrets）", false, () => setDoc(doc(owner.db, "trips", tripId, "secrets", "AAAAAAAAAAAAAAAAAAAA"), { x: 1 }));
  await expect("形のおかしい文書 ID", false, () => setDoc(doc(owner.db, "trips", tripId, "items", "bad id"), { title: "x" }));

  await expect("未参加の端末が旅行の存在を確認（get）", true, () => getDoc(tripRef(outsider)));
  await expect("未参加の端末が予定を読む", false, () => getDocs(collection(outsider.db, "trips", tripId, "items")));
  await expect("未参加の端末が予定を書く", false, () => addDoc(collection(outsider.db, "trips", tripId, "items"), { title: "x" }));
  await expect("未参加の端末が旅行名を変える", false, () => updateDoc(tripRef(outsider), { name: "乗っ取り" }));
  await expect("参加と同時に旅行名を変える", false, () => updateDoc(tripRef(outsider), { memberUids: arrayUnion(outsider.uid), name: "乗っ取り" }));
  await expect("自分以外の uid を足して参加させる", false, () => updateDoc(tripRef(outsider), { memberUids: arrayUnion("someone-else") }));
  await expect("絞り込みなしで旅行の一覧を取る", false, () => getDocs(collection(outsider.db, "trips")));

  await expect("招待リンクで参加（自分を 1つ足すだけ）", true, () => updateDoc(tripRef(joiner), { memberUids: arrayUnion(joiner.uid) }));
  await expect("参加後は予定を読める", true, () => getDocs(collection(joiner.db, "trips", tripId, "items")));
  await expect("参加者が旅行名を変える", true, () => updateDoc(tripRef(joiner), { name: "_test_改" }));
  await expect("参加者が他の端末を外す", false, () => updateDoc(tripRef(joiner), { memberUids: arrayRemove(owner.uid) }));
  await expect("自分が入っている旅行の一覧", true, async () => {
    const s = await getDocs(query(collection(joiner.db, "trips"), where("memberUids", "array-contains", joiner.uid)));
    if (!s.docs.some((d) => d.id === tripId)) throw new Error("一覧に出ない");
  });
  await expect("参加者が自分を外す（抜ける）", true, () => updateDoc(tripRef(joiner), { memberUids: arrayRemove(joiner.uid) }));
  await expect("抜けたあとは予定を読めない", false, () => getDocs(collection(joiner.db, "trips", tripId, "items")));

  // 上限 50 台：owner 1台。あと 49 台参加させて 50 台、51 台目は拒否
  for (let i = 0; i < 49; i++) {
    const c = await client();
    clients.push(c);
    await updateDoc(tripRef(c), { memberUids: arrayUnion(c.uid) });
  }
  console.log(`      参加端末数: ${(await getDoc(tripRef(owner))).data().memberUids.length}`);
  const c51 = await client();
  clients.push(c51);
  await expect("51 台目の参加", false, () => updateDoc(tripRef(c51), { memberUids: arrayUnion(c51.uid) }));
} finally {
  try {
    for (const k of ["items", "wishes", "packs"]) {
      for (const d of (await getDocs(collection(owner.db, "trips", tripId, k))).docs) await deleteDoc(d.ref);
    }
    await deleteDoc(tripRef(owner));
    console.log(`片付け: 確認用の旅行を削除 → ${(await getDoc(tripRef(owner))).exists() ? "残っている" : "削除済み"}`);
  } catch (e) {
    console.log("片付けに失敗:", e.code || e.message, "tripId=", tripId);
  }
  console.log(`\n結果: ${pass} PASS / ${fail} FAIL`);
  for (const c of [owner, outsider, joiner, ...clients]) await terminate(c.db);
  process.exit(fail ? 1 : 0);
}
