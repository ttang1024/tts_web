// ---------------------------------------------------------------------------
// Offline support.
//
// The library and every sentence of audio already heard live in the browser
// (IndexedDB), so a document you have listened to needs nothing from the
// network to be read again — except the app itself, which until now had to be
// downloaded before any of it could be used. This caches the app so opening it
// on a plane, or on a train between tunnels, works.
//
// Deliberately small and hand-written: the app has three routes and no build
// step to hook into. Two strategies, and nothing clever.
//
//   Navigations   network first, falling back to the last cached page. Online
//                 readers always get the current deployment; offline ones get
//                 the last one they saw, whose chunk hashes match what was
//                 cached alongside it.
//   Build assets  cache first. Everything under /_next/static is content-
//                 hashed, so a hit is never stale.
//
// /api/* is never cached: synthesis, extraction, and summaries are POSTs, and
// their results belong in the audio cache rather than here.
// ---------------------------------------------------------------------------

const VERSION = "v1";
const SHELL = `tts-shell-${VERSION}`;
const ASSETS = `tts-assets-${VERSION}`;
const CURRENT = [SHELL, ASSETS];

// The app's two pages, so a first offline launch has something to open.
const SHELL_URLS = ["/", "/library"];

// Hashed build output accumulates across deployments; keep the newest entries
// and let the rest go.
const MAX_ASSETS = 300;

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL);
      // Best-effort: a page that fails to precache is simply fetched later.
      await Promise.allSettled(SHELL_URLS.map((url) => cache.add(url)));
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names.filter((name) => name.startsWith("tts-") && !CURRENT.includes(name))
          .map((name) => caches.delete(name))
      );
      await self.clients.claim();
    })()
  );
});

async function trim(cacheName, max) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  // Cache keys come back in insertion order, so the front is the oldest.
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

async function cacheFirst(request) {
  const cache = await caches.open(ASSETS);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    void trim(ASSETS, MAX_ASSETS);
  }
  return response;
}

async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (err) {
    const hit = (await cache.match(request)) || (await cache.match("/"));
    if (hit) return hit;
    throw err;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || url.pathname.startsWith("/icon")) {
    event.respondWith(cacheFirst(request));
  }
});
