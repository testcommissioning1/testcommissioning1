const CACHE_NAME = "rotating-pm-gas-20260925h";
const APP_SHELL = [
  "./",
  "index.html",
  "office.html",
  "config.js",
  "manifest.json",
  "icon-192.png",
  "styles.css?v=20260925g",
  "api-adapter.js?v=20260925g",
  "app.js?v=20260925g",
  "office.css?v=20260925g",
  "office.js?v=20260925g"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  );
});

// 화면(HTML)과 설정 파일은 최신 버전을 먼저 받고, 오프라인이면 저장본 사용
async function networkThenCache(request) {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    const cached = (await cache.match(request)) || (await cache.match(request, { ignoreSearch: true }));
    if (cached) return cached;
    if (request.mode === "navigate") {
      const fallback = await cache.match("index.html");
      if (fallback) return fallback;
    }
    throw new Error("offline");
  }
}

// 버전이 붙은 js/css 는 저장본 먼저
async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response.clone());
  }
  return response;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return; // Apps Script, 구글 드라이브 사진은 그대로 통과

  const isVersioned = url.search.includes("v=") || url.pathname.endsWith(".png");
  event.respondWith(isVersioned ? cacheFirst(request) : networkThenCache(request));
});
