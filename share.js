// 旅のしおり：旅行の中身をリンク（#share=...）に詰める・取り出す（ブラウザ / Node 両対応）
// 中身は URL の # より後ろに入るので、サーバーには送られない。
(function (root) {
  const SHARE_BASE = "https://akito-hashi.github.io/tabi-shiori/";
  const KINDS = ["sight", "food", "move", "stay", "other"];

  // 共有に必要な分だけを短い形にする
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

  // 圧縮できる環境では "z" + 圧縮、できなければ "j" + そのまま
  async function encode(t) {
    const json = new TextEncoder().encode(JSON.stringify(pack(t)));
    if (typeof CompressionStream === "function") return "z" + toB64url(await pipe(json, new CompressionStream("deflate-raw")));
    return "j" + toB64url(json);
  }

  async function decode(code) {
    const kind = code[0];
    const bytes = fromB64url(code.slice(1));
    let json;
    if (kind === "z") json = await pipe(bytes, new DecompressionStream("deflate-raw"));
    else if (kind === "j") json = bytes;
    else throw new Error("共有リンクの形式が正しくありません");
    return unpack(JSON.parse(new TextDecoder().decode(json)));
  }

  async function shareUrl(t) {
    return SHARE_BASE + "#share=" + (await encode(t));
  }

  // 「#share=...」を含む文字列から共有コードを取り出す（なければ null）
  function codeFrom(hash) {
    const m = String(hash || "").match(/#share=([A-Za-z0-9_-]+)/);
    return m ? m[1] : null;
  }

  const api = { encode, decode, shareUrl, codeFrom, SHARE_BASE };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ShareLink = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
