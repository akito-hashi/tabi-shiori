// みんなで編集（同期）の部品を読み込む。「みんなで編集する」「参加」を使ったときに初めて読み込まれる
// （一人で使う人は Firebase を読み込まず、匿名の目印も作られない）。
import * as app from "https://www.gstatic.com/firebasejs/11.10.0/firebase-app.js";
import * as auth from "https://www.gstatic.com/firebasejs/11.10.0/firebase-auth.js";
import * as firestore from "https://www.gstatic.com/firebasejs/11.10.0/firebase-firestore.js";
import { firebaseConfig } from "./firebase-config.js";
import { createStore } from "./store.js";

let ready = null;

// 準備のできた store を返す。初回は匿名ログインのため通信が必要（失敗したら次に呼んだときにやり直す）
export function getStore() {
  if (!ready) {
    ready = (async () => {
      const store = createStore({ app, auth, firestore }, firebaseConfig, { persistent: true });
      await store.init();
      return store;
    })().catch((e) => { ready = null; throw e; });
  }
  return ready;
}
