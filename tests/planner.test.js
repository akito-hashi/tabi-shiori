const test = require("node:test");
const assert = require("node:assert/strict");
globalThis.Shiori = require("../logic.js");
const { planTrip } = require("../planner.js");

const DAYS = ["2026-12-18", "2026-12-19", "2026-12-20"];
let n = 0;
const W = (name, area, duration, extra = {}) => ({ id: "w" + n++, name, area, duration, kind: "sight", day: "", ...extra });
const min = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
const onDay = (items, d) => items.filter((it) => it.date === d).sort((a, b) => min(a.time) - min(b.time));
const titles = (items) => items.map((it) => it.title);
const base = { days: DAYS, dayStart: "09:00", dayEnd: "18:00", fixed: [] };

test("同じエリアの場所は同じ日にまとまり、日ごとに振り分けられる", () => {
  const wishes = [W("兼六園", "兼六園周辺", 90), W("21世紀美術館", "兼六園周辺", 120), W("ひがし茶屋街", "東山", 90),
    W("主計町", "東山", 60), W("近江町市場", "武蔵", 60)];
  const { items, leftover } = planTrip({ ...base, wishes });
  assert.equal(leftover.length, 0);
  const dayOf = (t) => items.find((it) => it.title === t).date;
  assert.equal(dayOf("兼六園"), dayOf("21世紀美術館"));
  assert.equal(dayOf("ひがし茶屋街"), dayOf("主計町"));
  // 3つのエリアは 3日に散らばる（合計時間の少ない日から埋める）
  assert.equal(new Set(["兼六園", "ひがし茶屋街", "近江町市場"].map(dayOf)).size, 3);
});

test("日を指定した場所はその日に入る", () => {
  const wishes = [W("金沢城", "兼六園周辺", 60, { day: "2026-12-20" }), W("兼六園", "兼六園周辺", 60)];
  const { items } = planTrip({ ...base, wishes });
  assert.equal(items.find((it) => it.title === "金沢城").date, "2026-12-20");
});

test("昼食は 12:00 に 1時間入り、食事の場所があればそれが昼食・夕食になる", () => {
  const plain = planTrip({ ...base, days: [DAYS[0]], wishes: [W("A", "x", 120), W("B", "x", 120)] });
  const lunch = plain.items.find((it) => it.title === "昼食");
  assert.equal(lunch.time, "12:00");
  assert.equal(lunch.kind, "food");
  assert.equal(plain.items.find((it) => it.title === "夕食").time, "18:00");

  const withFood = planTrip({ ...base, days: [DAYS[0]], wishes: [W("A", "x", 120), W("海鮮丼", "x", 60, { kind: "food" }), W("おでん", "y", 60, { kind: "food" })] });
  assert.equal(withFood.items.find((it) => it.title === "海鮮丼").time, "12:00");
  assert.equal(withFood.items.find((it) => it.title === "おでん").time, "18:00");
  assert.ok(!withFood.items.some((it) => it.title === "昼食" || it.title === "夕食"));
});

test("移動の目安：同じエリアは 15分、違うエリアは 30分あける", () => {
  const { items } = planTrip({ ...base, days: [DAYS[0]], dayStart: "13:00", wishes: [W("A", "x", 60), W("B", "x", 60), W("C", "y", 60)] });
  assert.deepEqual(onDay(items, DAYS[0]).filter((it) => it.kind !== "food").map((it) => [it.title, it.time]),
    [["A", "13:00"], ["B", "14:15"], ["C", "15:45"]]);
});

test("自分で入れた時刻付きの予定（1時間とみなす）とは重ならない", () => {
  const fixed = [{ date: DAYS[0], time: "10:00" }];
  const { items } = planTrip({ ...base, days: [DAYS[0]], fixed, wishes: [W("A", "x", 90), W("B", "x", 60)] });
  for (const it of items.filter((x) => x.date === DAYS[0])) {
    const s = min(it.time), e = s + it.duration;
    assert.ok(e <= 600 || s >= 660, `${it.title} ${it.time} が 10:00〜11:00 と重なる`);
  }
});

test("活動時間の終わりを超えない。入りきらない場所は「入りきらなかった場所」になる", () => {
  const wishes = [W("A", "x", 180), W("B", "x", 180), W("C", "x", 180)];
  const { items, leftover } = planTrip({ ...base, days: [DAYS[0]], wishes });
  for (const it of items.filter((x) => x.kind !== "food")) assert.ok(min(it.time) + it.duration <= min("18:00"));
  assert.deepEqual(leftover.map((w) => w.name), ["C"]);
});

test("1日に入りきらないエリアは翌日以降に分かれる", () => {
  const wishes = [W("A", "x", 180), W("B", "x", 180), W("C", "x", 180)];
  const { items, leftover } = planTrip({ ...base, days: DAYS.slice(0, 2), wishes });
  assert.equal(leftover.length, 0);
  assert.equal(new Set(items.filter((it) => it.kind !== "food").map((it) => it.date)).size, 2);
});

test("場所が 1つもない日には食事を入れない", () => {
  const { items } = planTrip({ ...base, wishes: [W("A", "x", 60, { day: DAYS[0] })] });
  assert.deepEqual([...new Set(items.map((it) => it.date))], [DAYS[0]]);
});

test("自動で作った予定には印が付き、場所の名前が地図用の場所になる", () => {
  const { items } = planTrip({ ...base, days: [DAYS[0]], wishes: [W("兼六園", "兼六園周辺", 60)] });
  const it = items.find((x) => x.title === "兼六園");
  assert.equal(it.auto, true);
  assert.equal(it.place, "兼六園");
  assert.ok(items.every((x) => x.auto === true));
});

test("場所が空なら何も作らない", () => {
  assert.deepEqual(planTrip({ ...base, wishes: [] }), { items: [], leftover: [] });
});
