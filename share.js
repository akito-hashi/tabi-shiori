// 旅のしおり：旅行の中身をリンク（#share=...）に詰める・取り出す（ブラウザ / Node 両対応）
// 中身は URL の # より後ろに入るので、サーバーには送られない。
(function (root) {
  const SHARE_BASE = "https://akito-hashi.github.io/tabi-shiori/";
  const KINDS = ["sight", "food", "move", "stay", "other"];

  const THEMES = ["eki", "diary", "washoku", "magazine"];
  // 区切り文字（入力からは取り除くので、中身と混ざらない）
  const FS = "\u001f", RS = "\u001e", GS = "\u001d";
  // 制御文字は改行（\n）以外取り除く（区切りと置き換え記号に使うため）
  const clean = (x) => String(x ?? "").replace(/\t/g, " ").replace(/[\u0000-\u0009\u000b-\u001f]/g, "");

  // よく使う言葉を 1バイトの記号（\u0001〜\u0008, \u000b〜\u001c）に置き換える辞書。
  // 一度公開したら並びを変えないこと（変えると前に送ったリンクが読めなくなる）。長い言葉から順に置き換える。
  const WORDS = ["ハンカチ・ティッシュ", "モバイルバッテリー", "チェックアウト", "チェックイン", "パスポート", "折りたたみ傘",
    "予約番号", "レストラン", "歯ブラシ", "新幹線", "ホテル", "着替え", "常備薬", "充電器", "保険証", "スマホ", "ランチ",
    "空港", "温泉", "観光", "財布", "散歩", "から", "駅", "号", "市"];
  const CODES = [1, 2, 3, 4, 5, 6, 7, 8, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28].map((c) => String.fromCharCode(c));
  const ORDER = WORDS.map((w, k) => [w, CODES[k]]).sort((a, b) => b[0].length - a[0].length);
  const squeeze = (str) => ORDER.reduce((acc, [w, c]) => acc.split(w).join(c), str);
  const expand = (str) => str.replace(/[\u0001-\u0008\u000b-\u001c]/g, (c) => WORDS[CODES.indexOf(c)] ?? "");
  const ymd = (iso) => iso.replace(/-/g, "");
  const iso = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

  // v2：JSON をやめ、区切り文字で詰めた文字列にする。日付は「出発日から何日目か」、時刻は 4桁
  //   見出し：名前 FS 行き先 FS 出発日(8桁) FS 日数 FS デザイン番号
  //   予定  ：何日目 FS 時刻 FS 種類番号 FS 内容 FS 場所 FS メモ（各予定は RS 区切り）
  //   持ち物：先頭 1文字が 1/0（チェック済みか）+ 名前（RS 区切り）
  function packV2(t) {
    const days = Shiori.tripDays(t.start, t.end);
    const head = [clean(t.name), clean(t.dest), ymd(t.start), days.length, Math.max(0, THEMES.indexOf(t.bookTheme || "eki"))].join(FS);
    const items = Shiori.sortItems(t.items).map((it) => [
      Math.max(0, days.indexOf(it.date)).toString(36), (it.time || "").replace(":", ""), Math.max(0, KINDS.indexOf(it.kind)),
      clean(it.title), clean(it.place), clean(it.memo),
    ].join(FS)).join(RS);
    const packs = (t.packs || []).map((x) => (x.done ? "1" : "0") + clean(x.name)).join(RS);
    return squeeze([head, items, packs].join(GS));
  }

  function unpackV2(text) {
    const [head = "", items = "", packs = ""] = expand(text).split(GS);
    const [n, d, s, len, th] = head.split(FS);
    if (!/^\d{8}$/.test(s || "") || !(Number(len) >= 1)) throw new Error("共有リンクの中身を読み取れませんでした");
    const start = iso(s);
    const days = [start];
    const dt = new Date(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8));
    for (let k = 1; k < Math.min(Number(len), 60); k++) { dt.setDate(dt.getDate() + 1); days.push(Shiori.toISO(dt)); }
    return unpack({
      v: 1, n, d, s: start, e: days[days.length - 1], th: THEMES[Number(th)] || "eki",
      i: items ? items.split(RS).map((r) => {
        const [day, hm, k, title, place, memo] = r.split(FS);
        return [days[parseInt(day, 36)] || start, hm ? `${hm.slice(0, 2)}:${hm.slice(2, 4)}` : "", Number(k), title, place, memo];
      }) : [],
      p: packs ? packs.split(RS).map((r) => [r.slice(1), r[0] === "1" ? 1 : 0]) : [],
    });
  }

  // v1（最初の版）：短い JSON。前に送ったリンクを開くために読み取りは残す
  function pack(t) {
    return {
      v: 1, n: t.name, d: t.dest || "", s: t.start, e: t.end, th: t.bookTheme || "eki",
      i: Shiori.sortItems(t.items).map((it) => [it.date, it.time || "", Math.max(0, KINDS.indexOf(it.kind)), it.title, it.place || "", it.memo || ""]),
      p: (t.packs || []).map((x) => [x.name, x.done ? 1 : 0]),
    };
  }

  function unpack(o) {
    if (!o || o.v !== 1 || typeof o.n !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.s) || !/^\d{4}-\d{2}-\d{2}$/.test(o.e)) {
      throw new Error("共有リンクの中身を読み取れませんでした");
    }
    const str = (x, max) => String(x ?? "").slice(0, max);
    let k = 0;
    return {
      id: "shared", name: str(o.n, 40), dest: str(o.d, 60), start: o.s, end: o.e, bookTheme: str(o.th, 20),
      items: (Array.isArray(o.i) ? o.i : []).slice(0, 500).map((a) => ({
        id: "s" + k++, date: str(a[0], 10), time: str(a[1], 5), kind: KINDS[a[2]] || "other",
        title: str(a[3], 60), place: str(a[4], 80), memo: str(a[5], 500),
      })),
      packs: (Array.isArray(o.p) ? o.p : []).slice(0, 300).map((a) => ({ id: "s" + k++, name: str(a[0], 40), done: !!a[1] })),
    };
  }

  const toB64url = (bytes) => {
    let bin = "";
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  };
  const fromB64url = (s) => {
    const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
    return Uint8Array.from(bin, (c) => c.charCodeAt(0));
  };

  async function pipe(bytes, stream) {
    const out = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await out.arrayBuffer());
  }

  // 先頭 1文字で形式を表す。y = v2 圧縮、x = v2 そのまま（圧縮できない環境）、z / j = v1
  async function encode(t) {
    const bytes = new TextEncoder().encode(packV2(t));
    if (typeof CompressionStream === "function") return "y" + toB64url(await pipe(bytes, new CompressionStream("deflate-raw")));
    return "x" + toB64url(bytes);
  }

  async function _encodeV1(t) {
    const json = new TextEncoder().encode(JSON.stringify(pack(t)));
    return "z" + toB64url(await pipe(json, new CompressionStream("deflate-raw")));
  }

  async function decode(code) {
    const kind = code[0];
    const bytes = fromB64url(code.slice(1));
    const text = async (compressed) => new TextDecoder().decode(compressed ? await pipe(bytes, new DecompressionStream("deflate-raw")) : bytes);
    if (kind === "y") return unpackV2(await text(true));
    if (kind === "x") return unpackV2(await text(false));
    if (kind === "z") return unpack(JSON.parse(await text(true)));
    if (kind === "j") return unpack(JSON.parse(await text(false)));
    throw new Error("共有リンクの形式が正しくありません");
  }

  async function shareUrl(t) {
    return SHARE_BASE + "#share=" + (await encode(t));
  }

  // 「#share=...」を含む文字列から共有コードを取り出す（なければ null）
  function codeFrom(hash) {
    const m = String(hash || "").match(/#share=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  const api = { encode, decode, shareUrl, codeFrom, SHARE_BASE, _encodeV1 };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ShareLink = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
