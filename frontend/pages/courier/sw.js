const CACHE_NAME = "food-system-courier-v2";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest"];
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (event) => event.waitUntil(
  caches.keys()
    .then((names) => Promise.all(names.filter((name) => name.startsWith("food-system-courier-") && name !== CACHE_NAME).map((name) => caches.delete(name))))
    .then(() => self.clients.claim())
));
self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || request.method !== "GET" || url.pathname.startsWith("/api/") || url.pathname === "/up" || request.headers.has("X-Courier-Token") || request.headers.has("Authorization")) return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => { const copy = response.clone(); void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); return response; })));
});
