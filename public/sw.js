// Commons service worker — caches the app shell so it installs and opens offline.
// (Messages still need the server running to sync; the UI shell loads offline.)
//
// Bump CACHE whenever the shell changes so installed clients drop the old copy.
const CACHE = "commons-v3";
const SHELL = [
  "./", "index.html", "app.js", "lucide.js", "qrcode.min.js",
  "react.min.js", "react-dom.min.js", "manifest.webmanifest",
  "icon-192.png", "icon-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== self.location.origin) return;
  // Never cache the API — always hit the network for live data.
  if (url.pathname.startsWith("/api/")) {
    e.respondWith(fetch(e.request).catch(() => new Response("null", { headers: { "Content-Type": "application/json" } })));
    return;
  }
  // Network-first so a new deploy is picked up immediately, cache as the offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(e.request, copy)).catch(() => {});
        }
        return res;
      })
      .catch(() => caches.match(e.request))
  );
});
