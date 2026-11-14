// 旅のしおり：冊子（A5）ページを組み立てる。画面ではページを並べて見せ、印刷すると PDF になる。
// デザイン（theme）ごとに表紙・日の見出し・裏表紙の作りを変え、それ以外の見た目は booklet.css が受け持つ。
(function (root) {
  const KINDS = { sight: "📍", food: "🍽", move: "🚃", stay: "🏨", other: "📝" };
  const KANJI = ["〇", "一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];
  const WD = ["日", "月", "火", "水", "木", "金", "土"];
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const mapUrl = (q) => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(q);
  const ymd = (iso) => iso.split("-").map(Number);
  const md = (iso) => { const [y, m, d] = ymd(iso); return `${m}月${d}日（${WD[new Date(y, m - 1, d).getDay()]}）`; };
  const dotDate = (iso) => iso.replace(/-/g, ".");

  function kanjiNum(n) {
    if (n <= 10) return KANJI[n];
    const t = Math.floor(n / 10), o = n % 10;
    return (t > 1 ? KANJI[t] : "") + "十" + (o ? KANJI[o] : "");
  }

  function nightsLabel(days) {
    return days <= 1 ? "日帰り" : `${days - 1}泊${days}日`;
  }

  // 落款風の印に入れる地名：最初の行き先の最後の語から「市・町・県」などを除いた 4文字まで
  // （例：石川県 金沢市 → 金沢、石川県 金沢市・富山県 富山市 → 金沢）
  function sealName(dest) {
    const first = (dest || "旅").split(/[・、,／/]/)[0];
    const last = first.trim().split(/\s+/).filter(Boolean).pop() || "旅";
    const core = last.length > 2 ? last.replace(/[都道府県市区町村]$/, "") : last;
    return core.slice(0, 4);
  }

  // 題名が長いときは表紙の文字を小さくする
  const titleSize = (name) => (name.length <= 10 ? "" : name.length <= 18 ? " t-mid" : " t-long");

  const THEMES = {
    eki: {
      label: "駅スタンプ帳",
      dayLabel: (i) => `${kanjiNum(i + 1)}日目`,
      memoTitle: "メモと記念スタンプ",
      stampSlots: true,
      cover: (t, days) => `
        <div class="ticket-band"><span>旅のしおり</span><span class="band-no">No.${esc(t.start.replace(/-/g, "").slice(2))}</span></div>
        <div class="perf"></div>
        <h1 class="cover-title${titleSize(t.name)}">${esc(t.name)}</h1>
        <div class="cover-stamp">${stamp(t.dest, t.start)}</div>
        ${coverMeta(t, days)}`,
      back: (t) => `<p class="back-word">いってらっしゃい</p>
        <div class="stub"><span>${esc(t.name)}</span><span>${esc(dotDate(t.start))} から ${esc(dotDate(t.end))}</span></div>`,
    },
    diary: {
      label: "絵日記",
      dayLabel: (i) => `${i + 1}にちめ`,
      memoTitle: "おもいでメモ",
      picture: true,
      cover: (t, days) => `
        <p class="diary-label">たびの えにっき</p>
        <svg class="diary-sun" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="22"/>
          ${Array.from({ length: 10 }, (_, k) => `<line x1="50" y1="12" x2="50" y2="22" transform="rotate(${k * 36} 50 50)"/>`).join("")}</svg>
        <div class="diary-frame"><h1 class="cover-title${titleSize(t.name)}">${esc(t.name)}</h1></div>
        ${coverMeta(t, days)}`,
      back: () => `<p class="back-word">いってきます！</p><p class="back-sub">たのしい たびに なりますように</p>`,
    },
    washoku: {
      label: "和モダン",
      dayLabel: (i) => `${kanjiNum(i + 1)}日目`,
      memoTitle: "覚え書き",
      cover: (t, days) => `
        <div class="wa-frame"></div>
        <h1 class="cover-title${titleSize(t.name)}">${esc(t.name)}</h1>
        <div class="seal">${esc(sealName(t.dest))}</div>
        <p class="wa-sub">${t.dest ? `<span>${esc(t.dest)}</span>` : ""}<span>${esc(nightsLabel(days.length))}　${esc(md(t.start))}より</span></p>`,
      back: (t) => `<div class="seal small">${esc(sealName(t.dest))}</div><p class="back-word">良き旅を</p>`,
    },
    magazine: {
      label: "旅行雑誌",
      dayLabel: (i) => `${i + 1}日目`,
      memoTitle: "メモ",
      cover: (t, days) => `
        <div class="mag-mast">旅のしおり<span>${esc(dotDate(t.start))}</span></div>
        <p class="mag-dest${(t.dest || t.name).length <= 6 ? "" : (t.dest || t.name).length <= 12 ? " d-mid" : " d-long"}">${esc(t.dest || t.name)}</p>
        <div class="mag-sticker">${esc(nightsLabel(days.length))}</div>
        <h1 class="cover-title${titleSize(t.name)}">${esc(t.name)}</h1>
        ${coverMeta(t, days)}`,
      back: () => `<p class="back-word">いってきます！</p>`,
    },
  };

  // 駅スタンプ風の丸い印（かすれは SVG フィルター）
  // 行き先が複数並んでいるときは最初の地名だけ（例：石川県 金沢市・富山県 富山市 → 石川県 金沢市）
  function stamp(dest, start) {
    const first = (dest || "旅").split(/[・、,／/]/)[0].trim() || "旅";
    const name = esc(first.slice(0, 8));
    const size = name.length <= 3 ? 26 : name.length <= 5 ? 20 : 15;
    return `<svg class="stamp" viewBox="0 0 200 200" aria-hidden="true">
      <defs><filter id="rough"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7"/>
        <feDisplacementMap in="SourceGraphic" scale="3"/><feComponentTransfer><feFuncA type="discrete" tableValues="0 1 1 1 1 1 1 0.85 1 1"/></feComponentTransfer></filter></defs>
      <g filter="url(#rough)" fill="none" stroke="currentColor">
        <circle cx="100" cy="100" r="92" stroke-width="5"/>
        <circle cx="100" cy="100" r="80" stroke-width="1.6"/>
        <path d="M34 124 H166" stroke-width="1.6"/>
        <path d="M100 30 l5 12 13 1 -10 8 3 13 -11 -7 -11 7 3 -13 -10 -8 13 -1z" fill="currentColor" stroke="none"/>
        <text x="100" y="${108 + size / 4}" text-anchor="middle" font-size="${size}" fill="currentColor" stroke="none" class="stamp-name">${name}</text>
        <text x="100" y="148" text-anchor="middle" font-size="13" fill="currentColor" stroke="none" letter-spacing="2">${esc(dotDate(start))}</text>
        <text x="100" y="165" text-anchor="middle" font-size="9" fill="currentColor" stroke="none" letter-spacing="3">旅の記念</text>
      </g></svg>`;
  }

  function coverMeta(t, days) {
    return `<dl class="cover-meta">
      <div><dt>行き先</dt><dd>${esc(t.dest || "未定")}</dd></div>
      <div><dt>日程</dt><dd>${esc(md(t.start))} から ${esc(md(t.end))}</dd></div>
      <div><dt>旅の長さ</dt><dd>${esc(nightsLabel(days.length))}</dd></div>
    </dl>`;
  }

  function overview(t, days, byDay, th) {
    const stays = Shiori.sortItems(t.items.filter((it) => it.kind === "stay"));
    const stations = days.map((d, i) => {
      const picks = byDay[d].filter((it) => it.kind !== "move").slice(0, 2).map((it) => esc(it.title));
      return `<li><span class="st-dot"></span><span class="st-day">${th.dayLabel(i)}</span>
        <span class="st-date">${esc(md(d))}</span><span class="st-picks">${picks.join("<br>") || "自由行動"}</span>
        <span class="st-page" data-day="${d}"></span></li>`;
    }).join("");
    return `<section class="page overview">
      <h2 class="page-title">旅の行程</h2>
      <ol class="route ${days.length > 4 ? "route-vertical" : ""}">${stations}</ol>
      <h3 class="sub-title">泊まるところ</h3>
      ${stays.length ? `<ul class="stays">${stays.map((s) => `<li><span>${esc(md(s.date))}</span><b>${esc(s.title)}</b>${s.place ? `<a href="${esc(mapUrl(s.place))}">${esc(s.place)}</a>` : ""}${s.memo ? `<small>${esc(s.memo)}</small>` : ""}</li>`).join("")}</ul>`
        : `<p class="empty">宿の予定を「🏨 宿」で登録すると、ここに載ります。</p>`}
    </section>`;
  }

  function dayHead(label, date, cont, th) {
    return `<header class="day-head${cont ? " cont" : ""}">
        <span class="day-num">${label}</span>
        <span class="day-date">${date}${cont ? "（つづき）" : ""}</span>
        ${th.picture && !cont ? `<span class="weather">てんき　☀　☁　☂</span>` : ""}
      </header>`;
  }

  // 1日を 1ページとして作る。入りきらない分は layout() が「つづき」のページへ送る
  function dayPage(d, i, items, th) {
    return `<section class="page day-page" data-day="${d}" data-day-label="${esc(th.dayLabel(i))}" data-date="${esc(md(d))}">
      ${dayHead(esc(th.dayLabel(i)), esc(md(d)), false, th)}
      ${th.picture ? `<div class="picture"><span>えを かこう ・ しゃしんを はろう</span></div>` : ""}
      ${items.length ? `<ol class="line">${items.map((it) => `<li class="stop kind-${esc(it.kind)}">
          <span class="stop-time">${esc(it.time || "終日")}</span>
          <span class="stop-dot">${KINDS[it.kind] || ""}</span>
          <div class="stop-body"><b>${esc(it.title)}</b>
            ${it.place ? `<a href="${esc(mapUrl(it.place))}">${esc(it.place)}</a>` : ""}
            ${it.memo ? `<p>${esc(it.memo)}</p>` : ""}</div></li>`).join("")}</ol>`
        : `<p class="empty">この日の予定はまだありません。思いつくままに過ごす日にしても。</p>`}
    </section>`;
  }

  function packPages(t) {
    const packs = t.packs || [];
    if (!packs.length) return [];
    const per = 30;
    const out = [];
    for (let i = 0; i < packs.length; i += per) {
      out.push(`<section class="page">
        <h2 class="page-title">持ち物${i ? "（つづき）" : ""}</h2>
        <ul class="packs-list">${packs.slice(i, i + per).map((p) => `<li><span class="box${p.done ? " on" : ""}"></span>${esc(p.name)}</li>`).join("")}</ul>
      </section>`);
    }
    return out;
  }

  function memoPage(th) {
    return `<section class="page memo">
      <h2 class="page-title">${th.memoTitle}</h2>
      <div class="ruled${th.stampSlots ? "" : " tall"}"></div>
      ${th.stampSlots ? `<div class="stamp-slots"><span></span><span></span><span></span></div>
      <p class="slot-note">旅先のスタンプを押す場所</p>` : ""}
    </section>`;
  }

  function build(t, themeKey) {
    const th = THEMES[themeKey] || THEMES.eki;
    const days = Shiori.tripDays(t.start, t.end);
    const sorted = Shiori.sortItems(t.items);
    const byDay = Object.fromEntries(days.map((d) => [d, sorted.filter((it) => it.date === d)]));
    return [
      `<section class="page cover">${th.cover(t, days)}</section>`,
      overview(t, days, byDay, th),
      ...days.map((d, i) => dayPage(d, i, byDay[d], th)),
      ...packPages(t),
      memoPage(th),
      `<section class="page back">${th.back(t)}</section>`,
    ].join("");
  }

  const overflows = (page) => page.scrollHeight > page.clientHeight + 1;

  // ページを実際に並べた後に呼ぶ（書体の読み込み後）。はみ出した予定を「つづき」のページへ送り、
  // ページ番号と行程ページの参照ページを振り直す。
  // pages: 並び順の .page 要素の配列。insertAfter(newPage, refPage): 新しいページを差し込む関数
  function layout(pages, insertAfter) {
    const all = [...pages];
    for (let i = 0; i < all.length; i++) {
      const page = all[i];
      if (!page.classList.contains("day-page")) continue;
      const line = page.querySelector(".line");
      if (!line || !overflows(page) || line.children.length < 2) continue;
      const next = document.createElement("section");
      next.className = "page day-page";
      next.innerHTML = dayHead(page.dataset.dayLabel, page.dataset.date, true, {}) + `<ol class="line"></ol>`;
      next.dataset.dayLabel = page.dataset.dayLabel;
      next.dataset.date = page.dataset.date;
      const nextLine = next.querySelector(".line");
      while (overflows(page) && line.children.length > 1) nextLine.prepend(line.lastElementChild);
      insertAfter(next, page);
      all.splice(i + 1, 0, next); // 次の周回で、つづきのページもはみ出していないか確かめる
    }
    all.forEach((page, i) => {
      page.querySelector(".folio")?.remove();
      if (i > 0 && i < all.length - 1) page.insertAdjacentHTML("beforeend", `<footer class="folio">${i + 1}</footer>`);
      const day = page.dataset.day;
      if (day) all[1].querySelector(`.st-page[data-day="${day}"]`)?.replaceChildren(`${i + 1}ページ`);
    });
    return all;
  }

  const themes = Object.fromEntries(Object.entries(THEMES).map(([k, v]) => [k, v.label]));
  root.Booklet = { build, layout, themes, kanjiNum, nightsLabel, sealName };
})(globalThis);
