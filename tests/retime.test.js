const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../logic.js");

const I = (id, time, duration, area) => ({ id, time, duration, area });
const times = (list) => list.map((x) => [x.id, x.time]);

test("並べた順に、所要時間と 15分の移動をはさんで時刻を振り直す", () => {
  const out = S.retime([I("a", "13:00", 60), I("b", "09:00", 30), I("c", "", 60)], "09:00");
  assert.deepEqual(times(out), [["a", "09:00"], ["b", "10:15"], ["c", "11:00"]]);
});

test("所要時間がなければ 1時間とみなす", () => {
  const out = S.retime([I("a", "10:00"), I("b", "10:00")], "10:00");
  assert.deepEqual(times(out), [["a", "10:00"], ["b", "11:15"]]);
});

test("エリアが分かるときは、同じエリア 15分・違うエリア 30分", () => {
  const out = S.retime([I("a", "09:00", 60, "東山"), I("b", "12:00", 60, "東山"), I("c", "16:00", 60, "兼六園")], "09:00");
  assert.deepEqual(times(out), [["a", "09:00"], ["b", "10:15"], ["c", "11:45"]]);
});

test("先頭にある終日の予定は終日のまま。途中に入れた終日の予定には時刻が付く", () => {
  const out = S.retime([I("x", "", 60), I("a", "09:00", 60), I("y", "", 30), I("b", "15:00", 60)], "09:00");
  assert.deepEqual(times(out), [["x", ""], ["a", "09:00"], ["y", "10:15"], ["b", "11:00"]]);
});

test("日付をまたぐときは 23:59 で止める", () => {
  const out = S.retime([I("a", "22:00", 60), I("b", "08:00", 60), I("c", "09:00", 60)], "22:00");
  assert.deepEqual(times(out), [["a", "22:00"], ["b", "23:15"], ["c", "23:59"]]);
});

test("元の配列は書き換えない", () => {
  const src = [I("a", "13:00", 60)];
  S.retime(src, "09:00");
  assert.equal(src[0].time, "13:00");
});

test("移動・宿・食事は元の時刻より早くならない（押されたときだけ後ろへずれる）", () => {
  const K = (id, time, duration, kind) => ({ id, time, duration, kind });
  const out = S.retime([K("a", "09:00", 60, "sight"), K("lunch", "12:00", 60, "food"), K("b", "15:00", 60, "sight"),
    K("dinner", "18:00", 90, "food"), K("hotel", "20:00", 60, "stay")], "09:00");
  assert.deepEqual(times(out), [["a", "09:00"], ["lunch", "12:00"], ["b", "13:15"], ["dinner", "18:00"], ["hotel", "20:00"]]);
  const pushed = S.retime([K("a", "09:00", 240, "sight"), K("train", "10:00", 60, "move")], "09:00");
  assert.deepEqual(times(pushed), [["a", "09:00"], ["train", "13:15"]]);
});

test("ドラッグした予定は、移動・宿・食事でも置いた位置の時刻になる", () => {
  const K = (id, time, duration, kind) => ({ id, time, duration, kind });
  const day = [K("dinner", "18:00", 90, "food"), K("train", "08:12", 60, "move"), K("higashi", "09:12", 90, "sight")];
  const out = S.retime(day, "08:12", { moved: "dinner" });
  assert.deepEqual(times(out), [["dinner", "08:12"], ["train", "09:57"], ["higashi", "11:12"]]);
});

test("開始時刻：並べ替えたあとの予定の元の時刻のうち一番早いもの（なければ指定の時刻）", () => {
  const K = (id, time) => ({ id, time });
  assert.equal(S.dayStartFor([K("a", "12:00"), K("b", "09:12"), K("c", "")], "09:00"), "09:12");
  assert.equal(S.dayStartFor([K("c", "")], "09:00"), "09:00");
  assert.equal(S.dayStartFor([], "10:00"), "10:00");
});
