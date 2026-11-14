// 本物の Firebase に対するテスト用の補助。各テストは自分で作った帳簿を最後に削除する。
import * as app from "firebase/app";
import * as auth from "firebase/auth";
import * as firestore from "firebase/firestore";
import { firebaseConfig } from "../firebase-config.js";
import { createStore } from "../store.js";


const fb = { app, auth, firestore };
let n = 0;
const opened = [];
const raw = new WeakMap();

// テストで「別の端末が直接書き込んだ状態」を作るための生の Firestore
export function rawDbOf(store) {
  return raw.get(store);
}

// 別々の匿名ユーザー（＝別の端末）。匿名ユーザーの作成数には上限（1時間あたり約100）があるので、
// 3台を作って使い回す。呼ぶたびに次の端末を返すので、続けて呼べば別の端末になる。
const POOL_SIZE = 3;
const pool = [];
let next = 0;
export async function newDevice() {
  const i = next++ % POOL_SIZE;
  if (!pool[i]) {
    pool[i] = (async () => {
      const appName = "t" + Date.now() + "-" + n++;
      const store = createStore(fb, firebaseConfig, { appName });
      await store.init();
      raw.set(store, firestore.getFirestore(app.getApp(appName)));
      opened.push(store);
      return store;
    })();
  }
  return pool[i];
}

export async function closeAll() {
  for (const s of opened.splice(0)) await s.close();
}

// watch* の通知を待つ。pred が真になった値で解決する
export function waitFor(watch, pred, ms = 8000) {
  return new Promise((resolve, reject) => {
    let unsub = () => {};
    const timer = setTimeout(() => { unsub(); reject(new Error("timeout")); }, ms);
    unsub = watch((v) => {
      if (pred(v)) { clearTimeout(timer); unsub(); resolve(v); }
    });
  });
}

export async function rejectsWithCode(promise, code) {
  try { await promise; } catch (e) { if (e.code === code) return; throw new Error(`code ${e.code} (expected ${code}): ${e.message}`); }
  throw new Error(`expected rejection with ${code}`);
}

export { fb };
