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

  const api = { tripDays, sortItems, nextItem, tripPhase, toISO };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Shiori = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
