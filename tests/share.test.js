const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.Shiori = require("../logic.js");
const L = require("../share.js");

const strip = (x) => ({ date: x.date, time: x.time, kind: x.kind, title: x.title, place: x.place, memo: x.memo });

function sampleTrip() {
  const titles = ["北陸新幹線 かがやき 503号", "金沢駅に到着", "近江町市場で海鮮丼", "ひがし茶屋街を散歩", "宿にチェックイン",
    "兼六園", "金沢21世紀美術館", "おでん", "長町武家屋敷跡", "2泊目の宿", "おみやげを買う", "かがやき 512号で帰る"];
  const places = ["東京駅", "金沢駅", "近江町市場", "ひがし茶屋街", "金沢 湯涌温泉", "兼六園", "金沢21世紀美術館",
    "金沢おでん 赤玉", "長町武家屋敷跡", "金沢駅 ホテル", "金沢百番街", "金沢駅"];
  const memos = ["7号車 12A・12B\n予約番号 4821", "", "", "金箔ソフトを食べる", "夕食 18:30 から", "雪吊りを見る",
    "スイミング・プールは整理券が必要", "", "", "", "", ""];
  const days = ["2026-12-18", "2026-12-18", "2026-12-18", "2026-12-18", "2026-12-18", "2026-12-19", "2026-12-19",
    "2026-12-19", "2026-12-19", "2026-12-19", "2026-12-20", "2026-12-20"];
  const times = ["08:12", "11:00", "11:30", "13:30", "16:00", "09:30", "11:30", "13:00", "15:00", "17:00", "", "15:40"];
  const kinds = ["move", "move", "food", "sight", "stay", "sight", "sight", "food", "sight", "stay", "other", "move"];
  return {
    id: "t1", name: "冬の金沢 ふたり旅", dest: "石川県 金沢市", start: "2026-12-18", end: "2026-12-20", bookTheme: "washoku",
    items: titles.map((title, k) => ({ id: "x" + k, date: days[k], time: times[k], kind: kinds[k], title, place: places[k], memo: memos[k] })),
    packs: ["財布", "スマホ", "充電器", "着替え", "常備薬", "折りたたみ傘", "手袋", "カイロ"].map((name, k) => ({ id: "p" + k, name, done: k < 2 })),
  };
}

test("新しい詰め方で、中身が元どおりに戻る", async () => {
  const t = sampleTrip();
  const back = await L.decode(L.codeFrom(await L.shareUrl(t)));
  assert.equal(back.name, t.name);
  assert.equal(back.dest, t.dest);
  assert.equal(back.start, t.start);
  assert.equal(back.end, t.end);
  assert.equal(back.bookTheme, "washoku");
  assert.deepEqual(back.items.map(strip), Shiori.sortItems(t.items).map(strip));
  assert.deepEqual(back.packs.map((p) => [p.name, p.done]), t.packs.map((p) => [p.name, p.done]));
});

test("前の詰め方より 2割以上短い", async () => {
  const t = sampleTrip();
  const now = (await L.shareUrl(t)).length;
  const old = (L.SHARE_BASE + "#share=" + (await L._encodeV1(t))).length;
  console.log(`  リンクの長さ: 前 ${old} 文字 → 今 ${now} 文字`);
  assert.ok(now <= old * 0.8, `${now} > ${old} * 0.8`);
});

test("前の詰め方のリンクも開ける", async () => {
  const t = sampleTrip();
  const back = await L.decode(await L._encodeV1(t));
  assert.equal(back.name, t.name);
  assert.deepEqual(back.items.map(strip), Shiori.sortItems(t.items).map(strip));
});

test("期間外の日付・空欄・区切りに使う文字が入っていても壊れない", async () => {
  const t = sampleTrip();
  t.dest = "";
  t.items = [
    { id: "a", date: "2026-12-18", time: "", kind: "other", title: "メモ\u001fに\u001e変な文字", place: "", memo: "" },
    { id: "b", date: "2026-12-20", time: "23:59", kind: "food", title: "夜食", place: "", memo: "改行\nあり" },
  ];
  t.packs = [];
  const back = await L.decode(L.codeFrom(await L.shareUrl(t)));
  assert.equal(back.dest, "");
  assert.deepEqual(back.items.map(strip), [
    { date: "2026-12-18", time: "", kind: "other", title: "メモに変な文字", place: "", memo: "" },
    { date: "2026-12-20", time: "23:59", kind: "food", title: "夜食", place: "", memo: "改行\nあり" },
  ]);
  assert.deepEqual(back.packs, []);
});

test("壊れたリンクはエラーになる", async () => {
  await assert.rejects(L.decode("yAAAA"));
  await assert.rejects(L.decode("q123"));
});

test("共有リンクは LINE の中ではなく外のブラウザで開く指定が付き、中身も取り出せる", async () => {
  const url = await L.shareUrl(sampleTrip());
  assert.match(url, /^https:\/\/akito-hashi\.github\.io\/tabi-shiori\/\?openExternalBrowser=1#share=y[A-Za-z0-9_-]+$/);
  assert.equal((await L.decode(L.codeFrom(url))).name, "冬の金沢 ふたり旅");
});
