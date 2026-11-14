// オフラインでも開けるようにするための Service Worker。
// アプリのファイル：ネットから最新を取り、つながらないときだけ保存済みを使う。
// 冊子の書体（Google Fonts）：一度読み込んだものを保存して使う（圏外でも冊子がきれいに出る）。
// ファイルを追加・改名したときは FILES を直し、VERSION の数字を上げる。
const VERSION = "v1";
const CACHE = "tabi-shiori-" + VERSION;
const FONT_CACHE = "tabi-shiori-fonts";
const FILES = [
  "./",
  "./index.html",
  "./logic.js",
  "./booklet.js",
  "./booklet.css",
  "./share.js",
  "./planner.js",
  "./manifest.webmanifest",
  "./icons/icon-180.png",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("tabi-shiori-") && k !== CACHE && k !== FONT_CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    event.respondWith(
      caches.open(FONT_CACHE).then((c) => c.match(req).then((hit) => hit || fetch(req).then((res) => {
        if (res.ok || res.type === "opaque") c.put(req, res.clone());
        return res;
      })))
    );
    return;
  }

  if (url.origin !== self.location.origin) return;
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() =>
        caches.match(req, { ignoreSearch: true })
          .then((r) => r || (req.mode === "navigate" ? caches.match("./index.html") : null))
          .then((r) => r || Response.error())
      )
  );
});
