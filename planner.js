// 旅のしおり：行きたい場所から、日ごとの予定を決まったルールで組み立てる（ブラウザ / Node 両対応）
//
// ルール
//  1. 日を指定した場所はその日へ。残りはエリアごとにまとめ、合計時間の大きいエリアから
//     「空き時間が一番多い日」に入れる（同じエリアがすでにある日を優先）。入りきらない分は次に空いている日へ。
//  2. 同じ日の中では同じエリアを続けて並べる。移動の目安は同じエリア 15分、違うエリア 30分。
//  3. 12:00〜 に昼食（食事の場所があればそれを昼食に）、活動時間の終わりに夕食（2つ目の食事の場所があればそれ）。
//     場所が 1つも入らなかった日には食事を入れない。自分で入れた食事が近くにあれば入れない。
//  4. 自分で入れた時刻付きの予定（1時間とみなす）とは重ねない。活動時間の終わりを超えない。
//  5. どの日にも入らなかった場所は leftover として返す。
(function (root) {
  const LUNCH_AT = 12 * 60;
  const LUNCH_MIN = 60;
  const DINNER_MIN = 90;
  const FIXED_MIN = 60;
  const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
  const toHM = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  const gap = (prev, w) => (!prev ? 0 : prev.area && prev.area === w.area ? 15 : 30);

  // [s, s+dur) が予定（blocks）と重ならない一番早い開始時刻。end を超えるなら null
  function findSlot(s, dur, blocks, end) {
    let moved = true;
    while (moved) {
      moved = false;
      for (const b of blocks) {
        if (s < b.end && s + dur > b.start) { s = b.end; moved = true; }
      }
    }
    return s + dur <= end ? s : null;
  }

  function planTrip({ days, dayStart = "09:00", dayEnd = "18:00", wishes, fixed = [] }) {
    if (!wishes.length || !days.length) return { items: [], leftover: [] };
    const start = toMin(dayStart), end = toMin(dayEnd);

    // ---- 日ごとの状態 ----
    const st = Object.fromEntries(days.map((d) => {
      const own = fixed.filter((f) => f.date === d && f.time);
      const blocks = own.map((f) => ({ start: toMin(f.time), end: toMin(f.time) + FIXED_MIN }));
      const fixedFoodNear = (from, to) => own.some((f) => f.kind === "food" && toMin(f.time) >= from && toMin(f.time) < to);
      const lunchOk = start < LUNCH_AT && end >= LUNCH_AT + LUNCH_MIN && !fixedFoodNear(11 * 60, 14 * 60)
        && !blocks.some((b) => b.start < LUNCH_AT + LUNCH_MIN && b.end > LUNCH_AT);
      const dinnerOk = !own.some((f) => f.kind === "food" && toMin(f.time) >= 17 * 60);
      const busy = blocks.reduce((t, b) => t + Math.max(0, Math.min(b.end, end) - Math.max(b.start, start)), 0);
      return [d, { blocks, lunchOk, dinnerOk, free: end - start - busy - (lunchOk ? LUNCH_MIN : 0), list: [], placed: [], cursor: start, prev: null }];
    }));

    // ---- 1. 日への振り分け ----
    const rest = [];
    for (const w of wishes) {
      if (w.day && st[w.day]) { st[w.day].list.push(w); st[w.day].free -= w.duration; }
      else rest.push(w);
    }
    const groups = new Map();
    for (const w of rest) {
      const key = w.area ? "a:" + w.area : "w:" + w.id; // エリアなしは 1か所ずつ
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(w);
    }
    const total = (g) => g.reduce((t, w) => t + w.duration, 0);
    const ordered = [...groups.values()].sort((a, b) => total(b) - total(a));
    for (const g of ordered) {
      let queue = g.slice();
      while (queue.length) {
        const area = queue[0].area;
        const pick = days.slice().sort((a, b) => {
          const sameA = area && st[a].list.some((w) => w.area === area) ? 1 : 0;
          const sameB = area && st[b].list.some((w) => w.area === area) ? 1 : 0;
          return sameB - sameA || st[b].free - st[a].free;
        })[0];
        const s = st[pick];
        const take = [];
        let room = s.free;
        for (const w of queue) if (w.duration <= room || (!take.length && !s.list.length)) { take.push(w); room -= w.duration; }
        if (!take.length) take.push(queue[0]); // どの日にも余裕がない：あとで入りきらなければ leftover
        for (const w of take) { s.list.push(w); s.free -= w.duration; }
        queue = queue.filter((w) => !take.includes(w));
      }
    }

    // ---- 2. 日の中の並び（同じエリアを続ける）と時刻の決定 ----
    const overflow = [];
    const place = (d, w) => {
      const s = st[d];
      const at = findSlot(s.cursor + gap(s.prev, w), w.duration, s.blocks, end);
      if (at === null) return false;
      s.placed.push({ w, at });
      s.blocks.push({ start: at, end: at + w.duration });
      s.cursor = at + w.duration;
      s.prev = w;
      return true;
    };
    for (const d of days) {
      const s = st[d];
      const areaOrder = [];
      for (const w of s.list) if (!areaOrder.includes(w.area || w.id)) areaOrder.push(w.area || w.id);
      s.list.sort((a, b) => areaOrder.indexOf(a.area || a.id) - areaOrder.indexOf(b.area || b.id));
      // 食事の場所を昼食・夕食に充てる
      const foods = s.list.filter((w) => w.kind === "food");
      s.lunchFood = s.lunchOk ? foods.shift() || null : null;
      s.dinnerFood = s.dinnerOk ? foods.shift() || null : null;
      if (s.lunchOk) s.blocks.push({ start: LUNCH_AT, end: LUNCH_AT + (s.lunchFood ? s.lunchFood.duration : LUNCH_MIN) });
      for (const w of s.list) {
        if (w === s.lunchFood || w === s.dinnerFood) continue;
        if (!place(d, w)) overflow.push(w);
      }
    }
    // 入りきらなかった場所は、空いている日の最後に入れられないか試す
    const leftover = [];
    for (const w of overflow) {
      const tryDays = days.slice().sort((a, b) => (end - st[b].cursor) - (end - st[a].cursor));
      if (!tryDays.some((d) => place(d, w))) leftover.push(w);
    }

    // ---- 3. 予定にする（食事は、場所が入った日だけ） ----
    const items = [];
    const item = (date, at, kind, title, place, duration, area = "") => ({ date, time: toHM(at), kind, title, place, memo: "", auto: true, duration, area });
    for (const d of days) {
      const s = st[d];
      const hasWish = s.placed.length > 0 || s.lunchFood || s.dinnerFood;
      for (const { w, at } of s.placed) items.push(item(d, at, w.kind || "sight", w.name, w.name, w.duration, w.area || ""));
      if (!hasWish) continue;
      if (s.lunchOk) {
        items.push(s.lunchFood ? item(d, LUNCH_AT, "food", s.lunchFood.name, s.lunchFood.name, s.lunchFood.duration, s.lunchFood.area || "")
          : item(d, LUNCH_AT, "food", "昼食", "", LUNCH_MIN));
      }
      if (s.dinnerOk) {
        items.push(s.dinnerFood ? item(d, end, "food", s.dinnerFood.name, s.dinnerFood.name, s.dinnerFood.duration, s.dinnerFood.area || "")
          : item(d, end, "food", "夕食", "", DINNER_MIN));
      }
    }
    items.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : toMin(a.time) - toMin(b.time)));
    return { items, leftover };
  }

  const api = { planTrip };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Planner = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
