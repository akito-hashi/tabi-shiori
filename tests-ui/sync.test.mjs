// みんなで編集（同期）の画面テスト：Mac の Chrome を 2台の端末（A・B）に見立て、本物の Firebase を使う。
// 使い方: npm run test:ui（匿名ユーザーは 2件だけ作って使い回す）
import test, { before, after, afterEach } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import puppeteer from "puppeteer-core";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 8700 + Math.floor(Math.random() * 90);
const BASE = `http://localhost:${PORT}/`;
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

let server, browser;
const ctx = [];
const pages = [];

before(async () => {
  server = spawn("python3", ["-m", "http.server", String(PORT)], { cwd: ROOT, stdio: "ignore" });
  await new Promise((r) => setTimeout(r, 800));
  browser = await puppeteer.launch({ executablePath: CHROME, headless: true });
});
afterEach(async () => {
  for (const p of pages.splice(0)) {
    // このテストで作った旅行を片付ける（参加中のものは全部消す）
    try {
      await p.evaluate(async () => {
        if (!cloud.store) return;
        for (const t of state.trips.filter((x) => x.cloud)) await cloud.store.deleteTrip(t.id).catch(() => {});
      });
    } catch (e) { /* ページが閉じている */ }
    await p.close().catch(() => {});
  }
});
after(async () => { await browser?.close(); server?.kill(); });

const D = (date, time, kind, title) => ({ id: Math.random().toString(36).slice(2), date, time, kind, title, place: "", memo: "", duration: 60 });
const localTrip = (name) => ({
  id: "L" + Date.now(), name, dest: "金沢", start: "2026-12-18", end: "2026-12-19",
  items: [D("2026-12-18", "08:12", "move", "新幹線"), D("2026-12-18", "12:00", "food", "近江町市場")],
  wishes: [{ id: "w1", name: "兼六園", area: "兼六園周辺", duration: 90, kind: "sight", day: "" }],
  packs: [{ id: "p1", name: "財布", done: false }, { id: "p2", name: "カイロ", done: false }],
});

// 端末 i（0 = A、1 = B）でアプリを開く。trips を渡すとスマホ保存の旅行として入れておく
async function device(i, { trips, url = BASE } = {}) {
  if (!ctx[i]) ctx[i] = await browser.createBrowserContext();
  const p = await ctx[i].newPage();
  pages.push(p);
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.dialogs = [];
  p.on("dialog", (d) => { p.dialogs.push(d.message()); d.accept(); });
  await p.goto(BASE + "manifest.webmanifest");
  await p.evaluate((ts) => {
    if (ts) localStorage.setItem("tabi-shiori-v1", JSON.stringify({ trips: ts, currentId: ts[0].id }));
  }, trips || null);
  await p.goto(url);
  return p;
}
const waitFor = (p, fn, arg, timeout = 20000) => p.waitForFunction(fn, { timeout }, arg).catch(async (e) => {
  const snap = await p.evaluate(() => ({
    days: document.querySelector("#days")?.textContent.replace(/\s+/g, " ").slice(0, 300),
    items: trip() && trip().items.map((i) => `${i.date} ${i.time} ${i.title}`),
  })).catch(() => ({}));
  console.log("waitFor failed:", JSON.stringify(snap), "dialogs:", JSON.stringify(p.dialogs), "errors:", JSON.stringify(p.errors));
  throw e;
});
const cur = (p) => p.evaluate(() => { const t = trip(); return t && JSON.parse(JSON.stringify(t)); });

// A がスマホ保存の旅行を「みんなで編集する」にして、招待リンク（このテスト用のアドレスに読み替え）を返す
async function shareToGroup(a) {
  await a.click("#syncTrip");
  await waitFor(a, () => !document.querySelector("#inviteCard").hidden && trip() && trip().cloud);
  const link = await a.$eval("#inviteLink", (e) => e.value);
  assert.match(link, /^https:\/\/akito-hashi\.github\.io\/tabi-shiori\/\?openExternalBrowser=1#join=[A-Za-z0-9_-]{22}$/);
  return { link, local: BASE + "?r=1" + link.slice(link.indexOf("#")), id: link.split("#join=")[1] };
}

test("A がみんなで編集にし、B が招待リンクで参加。お互いの変更がすぐ届き、持ち物のチェックは人ごと", async () => {
  const a = await device(0, { trips: [localTrip("_test_同期")] });
  const { local, id } = await shareToGroup(a);
  const b = await device(1, { url: local });
  await waitFor(b, (id) => trip() && trip().id === id && trip().items.length === 2, id);
  assert.equal(await b.$eval("#syncBadge", (e) => e.hidden), false);

  // A が予定を足す → B に届く
  await a.click('[data-add="2026-12-19"]');
  await a.type("#iTitle", "兼六園を散歩");
  await a.type("#iTime", "1000");
  await a.click("#itemSave");
  await waitFor(b, () => document.querySelector("#days").textContent.includes("兼六園を散歩"));

  // B が旅行名を変える → A に届く
  await b.click("#editTrip");
  await b.$eval("#tName", (e) => { e.value = ""; });
  await b.type("#tName", "_test_同期（改）");
  await b.click("#tripSave");
  await waitFor(a, () => document.querySelector("#hTitle").textContent === "_test_同期（改）");

  // B が持ち物にチェック → A には付かない
  const packId = (await cur(b)).packs.find((x) => x.name === "財布").id;
  await b.click(`[data-pack="${packId}"]`);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await b.$eval(`[data-pack="${packId}"]`, (e) => e.checked), true);
  assert.equal(await a.$eval(`[data-pack="${packId}"]`, (e) => e.checked), false);
  assert.deepEqual([...a.errors, ...b.errors], []);
});

test("招待リンクを貼り付けて参加できる。壊れたリンク・存在しない旅行はエラーになる", async () => {
  const a = await device(0, { trips: [localTrip("_test_貼り付け")] });
  const { link, id } = await shareToGroup(a);
  const b = await device(1);
  if (await b.$eval("#joinCard", (e) => e.hidden)) await b.click("#joinOpen");
  await b.type("#joinInput", "https://example.com/#join=short");
  await b.click("#joinBtn");
  await waitFor(b, () => /形式が正しくありません/.test(document.querySelector("#joinError").textContent));
  await b.$eval("#joinInput", (e) => { e.value = ""; });
  await b.type("#joinInput", "https://akito-hashi.github.io/tabi-shiori/?openExternalBrowser=1#join=AAAAAAAAAAAAAAAAAAAAAA");
  await b.click("#joinBtn");
  await waitFor(b, () => /見つかりません/.test(document.querySelector("#joinError").textContent));
  await b.$eval("#joinInput", (e) => { e.value = ""; });
  await b.type("#joinInput", link);
  await b.click("#joinBtn");
  await waitFor(b, (id) => trip() && trip().id === id, id);
});

test("圏外で入れた予定が、つながると相手に届く", async () => {
  const a = await device(0, { trips: [localTrip("_test_圏外")] });
  const { local, id } = await shareToGroup(a);
  const b = await device(1, { url: local });
  await waitFor(b, (id) => trip() && trip().id === id, id);
  await b.setOfflineMode(true);
  await b.click('[data-add="2026-12-19"]');
  await b.type("#iTitle", "圏外の買い物");
  await b.click("#itemSave");
  await waitFor(b, () => document.querySelector("#days").textContent.includes("圏外の買い物")); // 自分の画面にはすぐ出る
  await new Promise((r) => setTimeout(r, 1500));
  assert.ok(!(await a.$eval("#days", (e) => e.textContent)).includes("圏外の買い物"));
  await b.setOfflineMode(false);
  await waitFor(a, () => document.querySelector("#days").textContent.includes("圏外の買い物"), null, 40000);
});

test("入力中に相手が変更しても、自分の入力は消えず、保存すると両方の変更が残る", async () => {
  const a = await device(0, { trips: [localTrip("_test_入力中")] });
  const { local, id } = await shareToGroup(a);
  const b = await device(1, { url: local });
  await waitFor(b, (id) => trip() && trip().id === id, id);
  const target = (await cur(a)).items.find((i) => i.title === "新幹線").id;
  await a.click(`li[data-item="${target}"]`);
  await a.$eval("#iTitle", (e) => { e.value = ""; });
  await a.type("#iTitle", "北陸新幹線 かがやき");
  await a.select("#iDate", "2026-12-18");
  // この間に B が予定を足す
  await b.click('[data-add="2026-12-19"]');
  await b.type("#iTitle", "Bが足した予定");
  await b.click("#itemSave");
  await new Promise((r) => setTimeout(r, 2000));
  assert.equal(await a.$eval("#iTitle", (e) => e.value), "北陸新幹線 かがやき");
  assert.equal(await a.$eval("#iDate", (e) => e.value), "2026-12-18");
  await a.click("#itemSave");
  await waitFor(b, () => { const t = document.querySelector("#days").textContent; return t.includes("北陸新幹線 かがやき") && t.includes("Bが足した予定"); });
  await waitFor(a, () => { const t = document.querySelector("#days").textContent; return t.includes("北陸新幹線 かがやき") && t.includes("Bが足した予定"); });
});

test("みんなで編集中の旅行でも、自動作成とドラッグの並べ替えが相手に届く", async () => {
  const a = await device(0, { trips: [localTrip("_test_自動")] });
  const { local, id } = await shareToGroup(a);
  const b = await device(1, { url: local });
  await waitFor(b, (id) => trip() && trip().id === id, id);
  await a.click("#makePlan");
  await a.waitForSelector("#planPreview:not([hidden])");
  await a.click("#planApply");
  await waitFor(b, () => trip().items.some((i) => i.auto && i.title === "兼六園"));
  // B が 2日目の兼六園を 1日目の先頭へドラッグ
  const autoId = (await cur(b)).items.find((i) => i.title === "兼六園").id;
  const firstId = (await cur(b)).items.filter((i) => i.date === "2026-12-18").sort((x, y) => x.time.localeCompare(y.time))[0].id;
  const handle = await b.$(`li[data-item="${autoId}"] [data-handle]`);
  await handle.scrollIntoView();
  const hb = await handle.boundingBox();
  await b.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await b.mouse.down();
  const target = await b.$(`li[data-item="${firstId}"]`);
  await target.scrollIntoView();
  for (let k = 0; k < 6; k++) { const tb = await target.boundingBox(); await b.mouse.move(tb.x + tb.width / 2, tb.y + 4, { steps: 4 }); }
  await b.mouse.up();
  await waitFor(a, (autoId) => { const it = trip().items.find((i) => i.id === autoId); return it && it.date === "2026-12-18" && it.time === "08:12"; }, autoId);
});

test("2人いるときに一覧から外すと自分からだけ消え、最後の 1人が外すと旅行が削除される", async () => {
  const a = await device(0, { trips: [localTrip("_test_抜ける")] });
  const { local, id } = await shareToGroup(a);
  const b = await device(1, { url: local });
  await waitFor(b, (id) => trip() && trip().id === id, id);
  await waitFor(a, () => (trip().memberUids || []).length === 2);
  await b.click("#leaveTrip");
  await waitFor(b, (id) => !state.trips.some((t) => t.id === id), id);
  await waitFor(a, () => (trip().memberUids || []).length === 1);
  await a.click("#leaveTrip");
  await waitFor(a, (id) => !state.trips.some((t) => t.id === id), id);
  const exists = await a.evaluate(async (id) => (await cloud.store.joinTrip(id).then(() => true, (e) => e.code)), id);
  assert.equal(exists, "not-found");
});

// ---- 見直しで見つかった問題の再現 ----

test("開いている旅行が他の人に削除されたら、入力欄を閉じて知らせ、別の旅行には書き込まない", async () => {
  const other = { ...localTrip("_test_別の旅行"), id: "Lother" };
  const a = await device(0, { trips: [localTrip("_test_削除される"), other] });
  const { local, id } = await shareToGroup(a);
  const b = await device(1, { url: local });
  await waitFor(b, (id) => trip() && trip().id === id, id);
  const target = (await cur(a)).items[0].id;
  await a.click(`li[data-item="${target}"]`);
  await a.$eval("#iTitle", (e) => { e.value = ""; });
  await a.type("#iTitle", "書きかけ");
  await b.evaluate((id) => cloud.store.deleteTrip(id), id);
  await waitFor(a, () => document.querySelector("#itemFormCard").hidden);
  assert.ok(a.dialogs.some((m) => /削除|外れ/.test(m)), JSON.stringify(a.dialogs));
  const saved = await a.evaluate(() => JSON.parse(localStorage.getItem("tabi-shiori-v1")).trips.find((t) => t.id === "Lother"));
  assert.ok(!saved.items.some((i) => i.title === "書きかけ"));
  assert.deepEqual(a.errors, []);
});

test("圏外で「みんなで編集する」を押すと（部品の読み込みが失敗しても）、日本語で知らせ、元の旅行は残る", async () => {
  const c = await device(2, { trips: [localTrip("_test_圏外で同期")] });
  // Safari の圏外と同じく、Firebase の部品（gstatic）の読み込みそのものを失敗させる
  await c.setBypassServiceWorker(true);
  await c.setRequestInterception(true);
  c.on("request", (r) => (r.url().includes("gstatic.com/firebasejs") ? r.abort("internetdisconnected") : r.continue()));
  await c.click("#syncTrip");
  await waitFor(c, () => !document.querySelector("#syncTrip").disabled);
  await new Promise((r) => setTimeout(r, 500));
  const after = c.dialogs.slice(1); // 最初は「よろしいですか？」の確認
  assert.equal(after.length, 1, JSON.stringify(c.dialogs));
  assert.match(after[0], /インターネットにつながっていません|インターネットにつながっていない/);
  assert.doesNotMatch(after[0], /[A-Za-z]{6,}/); // 英語のエラー文をそのまま出さない
  assert.equal(await c.evaluate(() => trip() && trip().name), "_test_圏外で同期");
  assert.equal(await c.evaluate(() => !!trip().cloud), false);
});

test("ドラッグ中にその日の別の予定が他の人に消されても、止まらずに並べ替えが終わる", async () => {
  const t0 = localTrip("_test_ドラッグ中");
  t0.items.push(D("2026-12-18", "15:00", "sight", "ひがし茶屋街"));
  const a = await device(0, { trips: [t0] });
  const { local, id } = await shareToGroup(a);
  const b = await device(1, { url: local });
  await waitFor(b, (id) => trip() && trip().id === id && trip().items.length === 3, id);
  const items = (await cur(a)).items;
  const moving = items.find((i) => i.title === "ひがし茶屋街").id;
  const first = items.find((i) => i.title === "新幹線").id;
  const victim = items.find((i) => i.title === "近江町市場").id;
  const handle = await a.$(`li[data-item="${moving}"] [data-handle]`);
  await handle.scrollIntoView();
  const hb = await handle.boundingBox();
  await a.mouse.move(hb.x + hb.width / 2, hb.y + hb.height / 2);
  await a.mouse.down();
  const target = await a.$(`li[data-item="${first}"]`);
  for (let k = 0; k < 4; k++) { const tb = await target.boundingBox(); await a.mouse.move(tb.x + tb.width / 2, tb.y + 4, { steps: 3 }); }
  await b.evaluate(({ id, victim }) => cloud.store.deleteEntry(id, "items", victim), { id, victim });
  await waitFor(a, (victim) => !trip().items.some((i) => i.id === victim), victim);
  await a.mouse.up();
  await waitFor(a, () => !document.querySelector("li.placeholder"));
  await waitFor(b, (moving) => { const it = trip().items.find((i) => i.id === moving); return it && it.time === "08:12"; }, moving);
  assert.deepEqual(a.errors, []);
});

test("みんなで編集を使ったあとは、Firebase の部品がスマホに保存されている（次に圏外で開いても読み込める）", async () => {
  // 招待リンクから初めて開いたときと同じく、オフライン用の仕組み（Service Worker）がまだ画面を受け持っていない状態
  const ctx3 = await browser.createBrowserContext();
  const a = await ctx3.newPage();
  pages.push(a);
  a.errors = []; a.dialogs = [];
  a.on("dialog", (d) => { a.dialogs.push(d.message()); d.accept(); });
  await a.setBypassServiceWorker(true);
  await a.goto(BASE + "manifest.webmanifest");
  await a.evaluate((t) => localStorage.setItem("tabi-shiori-v1", JSON.stringify({ trips: [t], currentId: t.id })), localTrip("_test_部品の保存"));
  await a.goto(BASE);
  await shareToGroup(a);
  await waitFor(a, () => caches.open("tabi-shiori-fonts").then((c) => Promise.all(
    ["firebase-app.js", "firebase-auth.js", "firebase-firestore.js"].map((f) => c.match("https://www.gstatic.com/firebasejs/11.10.0/" + f))))
    .then((hits) => hits.every(Boolean)), null, 10000);
});

test("圏外で旅行を削除しようとすると、日本語で知らせ、何も消えない（相手の画面にも残る）", async () => {
  const a = await device(0, { trips: [localTrip("_test_圏外で削除")] });
  const { local, id } = await shareToGroup(a);
  const b = await device(1, { url: local });
  await waitFor(b, (id) => trip() && trip().id === id && trip().items.length === 2, id);
  await a.setOfflineMode(true);
  await a.click("#deleteTrip");
  await waitFor(a, () => true);
  await new Promise((r) => setTimeout(r, 1500));
  const after = a.dialogs.filter((m) => !/削除します/.test(m));
  assert.ok(after.some((m) => /インターネットにつながっていません/.test(m)), JSON.stringify(a.dialogs));
  await a.setOfflineMode(false);
  await new Promise((r) => setTimeout(r, 3000));
  // 相手の画面には、予定も含めてそのまま残っている
  assert.equal(await b.evaluate((id) => !!(trip() && trip().id === id && trip().items.length === 2), id), true);
  assert.equal(await a.evaluate((id) => state.trips.some((t) => t.id === id), id), true);
});
