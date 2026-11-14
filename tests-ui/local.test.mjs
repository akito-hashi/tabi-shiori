// スマホ保存の旅行の動き（同期を入れても変わらないこと）を、Mac の Chrome で確かめる画面テスト
// 使い方: npm run test:ui
import test, { before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import puppeteer, { KnownDevices } from "puppeteer-core";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const APP = "file://" + path.join(ROOT, "index.html");
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
globalThis.Shiori = require("../logic.js");
const ShareLink = require("../share.js");

let browser;
before(async () => { browser = await puppeteer.launch({ executablePath: CHROME, headless: true }); });
after(async () => { await browser?.close(); });

const I = (id, date, time, kind, title, extra = {}) => ({ id, date, time, kind, title, place: "", memo: "", duration: 60, ...extra });
const kanazawa = () => ({
  id: "t1", name: "冬の金沢 ふたり旅", dest: "石川県 金沢市", start: "2026-12-18", end: "2026-12-20", bookTheme: "eki",
  items: [
    I("a1", "2026-12-18", "08:12", "move", "北陸新幹線 かがやき", { place: "東京駅", memo: "7号車 12A・12B\n予約番号 4821" }),
    I("a2", "2026-12-18", "11:30", "food", "近江町市場で海鮮丼", { place: "近江町市場" }),
    I("a3", "2026-12-18", "13:30", "sight", "ひがし茶屋街", { place: "ひがし茶屋街", memo: "金箔ソフト" }),
    I("a4", "2026-12-18", "16:00", "stay", "宿にチェックイン", { place: "湯涌温泉" }),
    I("b1", "2026-12-19", "09:30", "sight", "兼六園", { place: "兼六園" }),
    I("b2", "2026-12-19", "12:00", "food", "おでん", { place: "赤玉" }),
    I("c1", "2026-12-20", "", "other", "おみやげを買う", { place: "金沢百番街" }),
  ],
  packs: ["財布", "スマホ", "充電器", "カイロ"].map((name, k) => ({ id: "p" + k, name, done: k < 2 })),
});

async function open(trip, { device, url = APP } = {}) {
  const ctx = await browser.createBrowserContext();
  const p = await ctx.newPage();
  if (device) await p.emulate(KnownDevices[device]);
  p.errors = [];
  p.on("pageerror", (e) => p.errors.push(e.message));
  p.on("dialog", (d) => d.accept());
  await p.goto(APP);
  await p.evaluate((t) => { localStorage.clear(); if (t) localStorage.setItem("tabi-shiori-v1", JSON.stringify({ trips: [t], currentId: t.id })); }, trip);
  await p.goto(url === APP ? APP + "?" : url);
  return p;
}
const saved = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("tabi-shiori-v1")).trips[0]);

test("予定の追加・編集・削除がスマホに保存される", async () => {
  const p = await open(kanazawa());
  await p.click('[data-add="2026-12-19"]');
  await p.type("#iTitle", "21世紀美術館");
  await p.type("#iTime", "1500");
  await p.click("#itemSave");
  let t = await saved(p);
  assert.ok(t.items.some((i) => i.title === "21世紀美術館" && i.time === "15:00" && i.date === "2026-12-19"));
  await p.click('li[data-item="b2"]');
  await p.$eval("#iTitle", (e) => { e.value = ""; });
  await p.type("#iTitle", "金沢おでん");
  await p.click("#itemSave");
  t = await saved(p);
  assert.equal(t.items.find((i) => i.id === "b2").title, "金沢おでん");
  await p.click('li[data-item="b2"]');
  await p.click("#itemDelete");
  t = await saved(p);
  assert.ok(!t.items.some((i) => i.id === "b2"));
  assert.deepEqual(p.errors, []);
});

test("行きたい場所から自動で作る：下書き → 追加、作り直しは自動の分だけ入れ替え", async () => {
  const t0 = kanazawa();
  t0.items = t0.items.filter((i) => i.id === "a1");
  t0.wishes = [
    { id: "w1", name: "兼六園", area: "兼六園周辺", duration: 90, kind: "sight", day: "" },
    { id: "w2", name: "21世紀美術館", area: "兼六園周辺", duration: 120, kind: "sight", day: "" },
    { id: "w3", name: "ひがし茶屋街", area: "東山", duration: 90, kind: "sight", day: "" },
  ];
  const p = await open(t0);
  await p.click("#makePlan");
  await p.waitForSelector("#planPreview:not([hidden])");
  await p.click("#planApply");
  const t1 = await saved(p);
  assert.ok(t1.items.some((i) => i.id === "a1" && !i.auto));
  assert.equal(t1.items.filter((i) => i.auto && i.kind === "sight").length, 3);
  await p.click("#makePlan");
  await p.waitForSelector("#planPreview:not([hidden])");
  await p.click("#planApply");
  const t2 = await saved(p);
  assert.equal(t2.items.length, t1.items.length);
  assert.deepEqual(p.errors, []);
});

test("指でドラッグして並べ替えると、時刻が組み直される（ドラッグした食事は置いた位置の時刻）", async () => {
  const p = await open(kanazawa(), { device: "iPhone 13" });
  const handle = await p.$('li[data-item="a2"] [data-handle]');
  await handle.scrollIntoView();
  const hb = await handle.boundingBox();
  const tb = await (await p.$('li[data-item="a1"]')).boundingBox();
  const x = hb.x + hb.width / 2, y0 = hb.y + hb.height / 2;
  await p.touchscreen.touchStart(x, y0);
  for (let k = 1; k <= 10; k++) await p.touchscreen.touchMove(x, y0 + ((tb.y + 4) - y0) * (k / 10));
  await p.touchscreen.touchEnd();
  const day = (await saved(p)).items.filter((i) => i.date === "2026-12-18").sort((a, b) => a.time.localeCompare(b.time));
  assert.deepEqual(day.map((i) => `${i.time} ${i.title}`),
    ["08:12 近江町市場で海鮮丼", "09:27 北陸新幹線 かがやき", "10:42 ひがし茶屋街", "16:00 宿にチェックイン"]);
  assert.deepEqual(p.errors, []);
});

test("共有リンクで受け取り、自分のしおりに追加できる", async () => {
  const url = await ShareLink.shareUrl(kanazawa());
  assert.match(url, /\?openExternalBrowser=1#share=y/);
  const p = await open(null, { url: APP + "?r=1" + url.slice(url.indexOf("#")) });
  await p.waitForFunction(() => document.querySelector("#booklet").dataset.ready === "eki", { timeout: 20000 });
  await p.click("#bkImport");
  await p.waitForFunction(() => document.querySelector("#booklet").hidden);
  const t = await saved(p);
  assert.equal(t.name, "冬の金沢 ふたり旅");
  assert.equal(t.items.length, 7);
  assert.deepEqual(p.errors, []);
});

test("冊子の 4デザインで、はみ出し・載せ漏れがなく、PDF のページ数が画面と同じ", async () => {
  const trip = kanazawa();
  const p = await open(trip);
  await p.click("#openBooklet");
  for (const theme of ["eki", "diary", "washoku", "magazine"]) {
    await p.click(`#bkThemes [data-theme="${theme}"]`);
    await p.waitForFunction((th) => document.querySelector("#booklet").dataset.ready === th, { timeout: 20000 }, theme);
    const r = await p.evaluate((t) => {
      const pages = [...document.querySelectorAll("#bkPages .page")];
      const text = document.querySelector("#bkPages").textContent.replace(/\s+/g, " ");
      const missing = [];
      for (const it of t.items) for (const s of [it.title, it.place, it.memo.replace(/\s+/g, " ")]) if (s && !text.includes(s)) missing.push(s);
      return { pages: pages.length, overflow: pages.filter((pg) => pg.scrollHeight > pg.clientHeight + 1).length, missing };
    }, trip);
    assert.equal(r.overflow, 0, theme);
    assert.deepEqual(r.missing, [], theme);
    const pdfPath = path.join(os.tmpdir(), `shiori-${theme}.pdf`);
    await p.pdf({ path: pdfPath, preferCSSPageSize: true, printBackground: true });
    const pdfPages = (fs.readFileSync(pdfPath).toString("latin1").match(/\/Type\s*\/Page[^s]/g) || []).length;
    assert.equal(pdfPages, r.pages, theme);
  }
  assert.deepEqual(p.errors, []);
});

test("行きたい場所の追加・編集・削除と、活動時間がスマホに保存される", async () => {
  const p = await open(kanazawa());
  await p.type("#wName", "兼六園");
  await p.type("#wArea", "兼六園周辺");
  await p.click("#wishSave");
  await p.type("#wName", "金沢城");
  await p.click("#wishSave");
  let t = await saved(p);
  assert.deepEqual(t.wishes.map((w) => [w.name, w.area]), [["兼六園", "兼六園周辺"], ["金沢城", "兼六園周辺"]]);
  await p.click(`[data-wish="${t.wishes[0].id}"]`);
  await p.select("#wDur", "120");
  await p.click("#wishSave");
  await p.click(`[data-wish="${t.wishes[1].id}"]`);
  await p.click("#wishDelete");
  await p.$eval("#pStart", (e) => { e.value = "10:00"; e.dispatchEvent(new Event("change")); });
  t = await saved(p);
  assert.deepEqual(t.wishes.map((w) => [w.name, w.duration]), [["兼六園", 120]]);
  assert.equal(t.planStart, "10:00");
  assert.deepEqual(p.errors, []);
});

test("持ち物の追加・ひな形・チェック・削除がスマホに保存される", async () => {
  const p = await open(kanazawa());
  await p.type("#packName", "手袋");
  await p.click('#packForm button[type="submit"]');
  await p.click("#tplDomestic");
  let t = await saved(p);
  assert.ok(t.packs.some((x) => x.name === "手袋"));
  assert.equal(t.packs.filter((x) => x.name === "財布").length, 1); // ひな形で重ならない
  const glove = t.packs.find((x) => x.name === "手袋");
  await p.click(`[data-pack="${glove.id}"]`);
  t = await saved(p);
  assert.equal(t.packs.find((x) => x.id === glove.id).done, true);
  await p.click(`[data-del-pack="${glove.id}"]`);
  t = await saved(p);
  assert.ok(!t.packs.some((x) => x.id === glove.id));
  assert.deepEqual(p.errors, []);
});
