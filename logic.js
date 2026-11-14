// 旅のしおり：日付・予定まわりの計算（ブラウザ / Node 両対応）
(function (root) {
  const pad = (n) => String(n).padStart(2, "0");
  const toISO = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

  // 開始日〜終了日（両端を含む）の日付の一覧
  function tripDays(start, end) {
    const out = [];
    if (!start || !end || end < start) return out;
    for (let d = parse(start); toISO(d) <= end && out.length < 60; d.setDate(d.getDate() + 1)) out.push(toISO(d));
    return out;
  }

  // 日付 → 時刻なし（終日）→ 時刻順
  function sortItems(items) {
    return items.slice().sort((a, b) =>
      a.date !== b.date ? (a.date < b.date ? -1 : 1)
      : (a.time || "") < (b.time || "") ? -1 : (a.time || "") > (b.time || "") ? 1 : 0);
  }

  // いまの次の予定（今日の時刻なしの予定は、その日のうちは「次」に含める）
  function nextItem(items, now) {
    const today = toISO(now);
    const hm = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
    return sortItems(items).find((it) =>
      it.date > today || (it.date === today && (!it.time || it.time >= hm))) || null;
  }

  // 旅行との位置関係：出発前 / 旅行中（何日目）/ 終了後
  function tripPhase(start, end, now) {
    const today = toISO(now);
    if (today < start) return { phase: "before", daysLeft: Math.round((parse(start) - parse(today)) / 86400000) };
    if (today > end) return { phase: "after" };
    return { phase: "during", day: Math.round((parse(today) - parse(start)) / 86400000) + 1 };
  }

  // 並べ替えた順に時刻を振り直す。先頭に続く「終日」の予定は終日のまま。
  // 所要時間がなければ 60分、移動の目安は同じエリア 15分・違うエリア 30分（エリア不明なら 15分）。
  // 移動・宿・食事は時刻が決まっていることが多いので、元の時刻より早めない（押されたときだけ後ろへ）。
  const ANCHORED = new Set(["move", "stay", "food"]);
  function retime(items, start) {
    const toMin = (hm) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3, 5));
    const toHM = (m) => (m >= 24 * 60 ? "23:59" : `${pad(Math.floor(m / 60))}:${pad(m % 60)}`);
    let cursor = toMin(start);
    let prev = null;
    let leading = true;
    return items.map((it) => {
      if (leading && !it.time) return { ...it };
      leading = false;
      if (prev) cursor += (prev.duration || 60) + (prev.area && it.area && prev.area !== it.area ? 30 : 15);
      if (ANCHORED.has(it.kind) && it.time) cursor = Math.max(cursor, toMin(it.time));
      prev = it;
      return { ...it, time: toHM(cursor) };
    });
  }

  const api = { tripDays, sortItems, nextItem, tripPhase, toISO, retime };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Shiori = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
