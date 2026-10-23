const CACHE_NAME = "food-system-courier-v1";
const SHELL = ["./", "./index.html", "./app.js", "./manifest.webmanifest"];
self.addEventListener("install", (event) => { event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL))); self.skipWaiting(); });
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (new URL(request.url).origin !== self.location.origin || request.method !== "GET") return;
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => { const copy = response.clone(); void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)); return response; })));
});
