const CACHE_NAME = "food-system-courier-v7";
const SHELL = [
  "./index.html", "./app.js", "./styles.css", "./translations.js", "./manifest.webmanifest",
  "../../env.js", "../../assets/favicon.webp", "../../styles/base.css", "../../styles/theme.css",
  "../../shared/api/config.js", "../../shared/ui/appearance-boot.js", "../../shared/ui/appearance.js",
  "../../shared/ui/input-constraints.js", "../../shared/i18n/legacy-control.js", "../../shared/i18n/i18n.js",
  "../../shared/i18n/locales/pt.js", "../../shared/i18n/locales/legacy-text-pairs.js",
  "../../shared/i18n/locales/legacy-dynamic-rules.js"
];
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
  event.respondWith(fetch(request).then(async (response) => {
    if (response.ok) {
      try {
        const cache = await caches.open(CACHE_NAME);
        await cache.put(request, response.clone());
      } catch { /* The network response remains usable if storage is full. */ }
    }
    return response;
  }).catch(async () => (await caches.match(request)) || Response.error()));
});
