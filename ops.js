// 旅のしおり：データを変える窓口。画面はここだけを呼ぶ。
//  - スマホ保存の旅行（t.cloud が偽）：その場で書き換えて save() でスマホに保存する
//  - みんなで編集中の旅行（t.cloud が真）：store（Firebase）に書く。画面への反映は watchTrip の通知で行う
//    （圏外でも端末内の保存にすぐ入り、つながったら送られる）
// 持ち物のチェック：スマホ保存の旅行は今までどおり pack.done。みんなで編集中の旅行は人ごとなので、
// サーバーには送らず、この端末の localStorage（CHECKS_KEY）にだけ保存する。
(function (root) {
  const CHECKS_KEY = "tabi-shiori-checks";

  function createOps({ save, uid, getStore, onError = (e) => console.error(e), storage = root.localStorage }) {
    let checks = {};
    try { checks = JSON.parse(storage.getItem(CHECKS_KEY)) || {}; } catch (e) { checks = {}; }
    const saveChecks = () => { try { storage.setItem(CHECKS_KEY, JSON.stringify(checks)); } catch (e) {} };

    // クラウドの書き込みは待たない（圏外でも止まらないように）。失敗だけ知らせる
    const fire = (p) => { Promise.resolve(p).catch(onError); };
    const store = () => getStore();
    const strip = ({ id, ...rest }) => rest;

    return {
      // ---- 旅行 ----
      updateTrip(t, fields) {
        if (t.cloud) return fire(store().updateTrip(t.id, fields));
        Object.assign(t, fields);
        save();
      },

      // ---- 予定 ----
      addItem(t, data) {
        if (t.cloud) return fire(store().addEntry(t.id, "items", data));
        t.items.push({ id: uid(), ...data });
        save();
      },
      updateItem(t, id, fields) {
        if (t.cloud) return fire(store().updateEntry(t.id, "items", id, fields));
        Object.assign(t.items.find((x) => x.id === id), fields);
        save();
      },
      deleteItems(t, ids) {
        if (!ids.length) return;
        if (t.cloud) return fire(Promise.all(ids.map((id) => store().deleteEntry(t.id, "items", id))));
        t.items = t.items.filter((x) => !ids.includes(x.id));
        save();
      },
      // 並べ替えたあとの日付・時刻をまとめて反映する。changes: [{ id, date, time }]
      applyRetime(t, changes) {
        if (!changes.length) return;
        if (t.cloud) return fire(store().retimeItems(t.id, changes));
        for (const c of changes) Object.assign(t.items.find((x) => x.id === c.id), { date: c.date, time: c.time });
        save();
      },
      // 自動で入れた予定を入れ替える（自分で入れた予定はそのまま）
      replaceAutoItems(t, newItems) {
        if (t.cloud) return fire(store().replaceAutoItems(t.id, newItems.map(strip)));
        t.items = [...t.items.filter((it) => !it.auto), ...newItems.map((it) => ({ id: uid(), ...strip(it) }))];
        save();
      },

      // ---- 行きたい場所 ----
      addWish(t, data) {
        if (t.cloud) return fire(store().addEntry(t.id, "wishes", data));
        (t.wishes = t.wishes || []).push({ id: uid(), ...data });
        save();
      },
      updateWish(t, id, fields) {
        if (t.cloud) return fire(store().updateEntry(t.id, "wishes", id, fields));
        Object.assign(t.wishes.find((x) => x.id === id), fields);
        save();
      },
      deleteWish(t, id) {
        if (t.cloud) return fire(store().deleteEntry(t.id, "wishes", id));
        t.wishes = (t.wishes || []).filter((x) => x.id !== id);
        save();
      },

      // ---- 持ち物 ----
      addPacks(t, names) {
        const have = new Set((t.packs || []).map((p) => p.name));
        const fresh = names.filter((n) => !have.has(n));
        if (!fresh.length) return;
        if (t.cloud) return fire(Promise.all(fresh.map((name) => store().addEntry(t.id, "packs", { name }))));
        t.packs = t.packs || [];
        for (const name of fresh) t.packs.push({ id: uid(), name, done: false });
        save();
      },
      deletePack(t, id) {
        if (t.cloud) {
          if (checks[t.id]) { delete checks[t.id][id]; saveChecks(); }
          return fire(store().deleteEntry(t.id, "packs", id));
        }
        t.packs = (t.packs || []).filter((p) => p.id !== id);
        save();
      },
      isChecked(t, pack) {
        return t.cloud ? !!(checks[t.id] && checks[t.id][pack.id]) : !!pack.done;
      },
      setCheck(t, packId, on) {
        if (t.cloud) {
          checks[t.id] = checks[t.id] || {};
          if (on) checks[t.id][packId] = true; else delete checks[t.id][packId];
          return saveChecks();
        }
        t.packs.find((p) => p.id === packId).done = on;
        save();
      },
      // チェックを反映した旅行（冊子・見るだけの共有リンク用）
      withChecks(t) {
        if (!t.cloud) return t;
        return { ...t, packs: (t.packs || []).map((p) => ({ ...p, done: this.isChecked(t, p) })) };
      },
      // クラウドへ移した旅行のチェックを、この端末のチェックとして引き継ぐ
      adoptChecks(tripId, doneByPackId) {
        checks[tripId] = { ...(checks[tripId] || {}), ...doneByPackId };
        saveChecks();
      },
      forgetChecks(tripId) {
        delete checks[tripId];
        saveChecks();
      },
    };
  }

  const api = { createOps, CHECKS_KEY };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Ops = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
