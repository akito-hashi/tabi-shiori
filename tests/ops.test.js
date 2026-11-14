const test = require("node:test");
const assert = require("node:assert/strict");
const { createOps, CHECKS_KEY } = require("../ops.js");

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), _m: m };
}
function fakeStore() {
  const calls = [];
  const rec = (name) => (...args) => { calls.push([name, ...args]); return Promise.resolve("newid"); };
  return { calls, updateTrip: rec("updateTrip"), addEntry: rec("addEntry"), updateEntry: rec("updateEntry"),
    deleteEntry: rec("deleteEntry"), retimeItems: rec("retimeItems"), replaceAutoItems: rec("replaceAutoItems") };
}
function setup() {
  let saves = 0, n = 0;
  const store = fakeStore();
  const storage = memStorage();
  const ops = createOps({ save: () => saves++, uid: () => "id" + n++, getStore: () => store, storage });
  return { ops, store, storage, saves: () => saves };
}
const localTrip = () => ({ id: "L", items: [{ id: "i1", date: "2026-12-18", time: "09:00", title: "A" }, { id: "i2", date: "2026-12-18", time: "10:00", title: "B", auto: true }],
  wishes: [], packs: [{ id: "p1", name: "財布", done: false }] });
const cloudTrip = () => ({ ...localTrip(), id: "C", cloud: true });

test("スマホ保存の旅行：その場で書き換えて保存する", () => {
  const { ops, store, saves } = setup();
  const t = localTrip();
  ops.addItem(t, { title: "C", date: "2026-12-18", time: "" });
  ops.updateItem(t, "i1", { title: "A2" });
  ops.applyRetime(t, [{ id: "i1", date: "2026-12-19", time: "08:00" }]);
  ops.replaceAutoItems(t, [{ id: "draft", title: "自動", auto: true, date: "2026-12-18", time: "13:00" }]);
  ops.deleteItems(t, ["i1"]);
  assert.deepEqual(t.items.map((i) => i.title), ["C", "自動"]);
  assert.ok(t.items.every((i) => i.id && i.id !== "draft"));
  assert.equal(store.calls.length, 0);
  assert.equal(saves(), 5);
});

test("みんなで編集中の旅行：store を呼び、その場では書き換えない", async () => {
  const { ops, store, saves } = setup();
  const t = cloudTrip();
  ops.addItem(t, { title: "C" });
  ops.updateItem(t, "i1", { title: "A2" });
  ops.applyRetime(t, [{ id: "i1", date: "2026-12-19", time: "08:00" }]);
  ops.replaceAutoItems(t, [{ id: "draft", title: "自動", auto: true }]);
  ops.deleteItems(t, ["i1"]);
  ops.addWish(t, { name: "兼六園" });
  ops.addPacks(t, ["財布", "カイロ"]);
  ops.updateTrip(t, { name: "新しい名前" });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(store.calls.map((c) => c[0]), ["addEntry", "updateEntry", "retimeItems", "replaceAutoItems", "deleteEntry", "addEntry", "addEntry", "updateTrip"]);
  assert.deepEqual(store.calls[3][2], [{ title: "自動", auto: true }]); // 下書きの仮 id は送らない
  assert.deepEqual(store.calls[6], ["addEntry", "C", "packs", { name: "カイロ" }]); // 既にある「財布」は足さない
  assert.equal(t.items.length, 2);
  assert.equal(saves(), 0);
});

test("持ち物のチェック：みんなで編集中の旅行は端末の中にだけ残り、store には送らない", () => {
  const { ops, store, storage } = setup();
  const t = cloudTrip();
  ops.setCheck(t, "p1", true);
  assert.equal(ops.isChecked(t, t.packs[0]), true);
  assert.equal(t.packs[0].done, false);
  assert.equal(store.calls.length, 0);
  assert.deepEqual(JSON.parse(storage.getItem(CHECKS_KEY)), { C: { p1: true } });
  assert.deepEqual(ops.withChecks(t).packs.map((p) => p.done), [true]);
  ops.setCheck(t, "p1", false);
  assert.equal(ops.isChecked(t, t.packs[0]), false);
});

test("持ち物のチェック：スマホ保存の旅行は今までどおり pack.done", () => {
  const { ops, storage } = setup();
  const t = localTrip();
  ops.setCheck(t, "p1", true);
  assert.equal(t.packs[0].done, true);
  assert.equal(storage.getItem(CHECKS_KEY), null);
  assert.equal(ops.withChecks(t), t);
});

test("クラウドの書き込みが失敗したら onError に知らせる", async () => {
  const errors = [];
  const ops = createOps({ save() {}, uid: () => "x", storage: memStorage(), onError: (e) => errors.push(e.message),
    getStore: () => ({ addEntry: () => Promise.reject(new Error("permission-denied")) }) });
  ops.addItem(cloudTrip(), { title: "x" });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(errors, ["permission-denied"]);
});
