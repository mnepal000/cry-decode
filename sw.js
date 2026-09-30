/* CryDecode service worker: makes the app work offline.
   On first visit the app shell (HTML, CSS, JS) is cached; afterwards the
   cached copy is served instantly and refreshed quietly in the background.
   Only same-origin requests are cached, so the source links in the
   references section still go to the network when you tap them. */

const CACHE = "crydecode-v1";
const ASSETS = [
  "./",
  "./index.html",
  "./styles.css",
  "./app.js",
  "./cry-analysis.js"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // external links: network only

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetched = fetch(request)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(CACHE).then((cache) => cache.put(request, copy));
          }
          return res;
        })
        .catch(() => null);

      // Offline-first: serve the cache right away and refresh it quietly.
      // If nothing is cached (very first load), wait for the network, and
      // fall back to the app shell for page navigations.
      if (cached) return cached;
      return fetched.then((res) => {
        if (res) return res;
        if (request.mode === "navigate") return caches.match("./index.html");
        throw new Error("offline and not cached");
      });
    })
  );
});
