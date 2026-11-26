/*
 * The service worker of the installed app (and of the site in a browser): it lets Transparent Earth open with no
 * network, as an app pinned to a home screen should, and keeps the heavy static files on the phone.
 *
 * Nothing is precached - the build is 50 MB, most of it sky layers a visitor may never switch on. What has been used
 * is kept:
 *   - the page: network first, the kept copy when offline, so a release is never hidden behind an old page;
 *   - assets/: Vite fingerprints every name, so a kept copy is never stale - cache first;
 *   - the rest of this site (data, guides): the kept copy at once, refreshed behind it;
 *   - elevation tiles and Blue Marble imagery: they never change - cache first, the oldest dropped past a cap.
 * Live feeds (earthquakes, weather, space weather) and the video host are left alone: a kept copy of a live feed
 * would be wrong, and a film is fetched in ranges.
 *
 * Bump VERSION to drop every kept copy on the next visit.
 */

const VERSION = 'v1';
const SHELL = `shell-${VERSION}`;
const ASSETS = `assets-${VERSION}`;
const DATA = `data-${VERSION}`;
const TILES = `tiles-${VERSION}`;
const KEEP = [SHELL, ASSETS, DATA, TILES];
const TILE_LIMIT = 600;

/** Cross-origin files that never change: worth keeping. */
const STATIC_REMOTE = [
  /^https:\/\/s3\.amazonaws\.com\/elevation-tiles-prod\//,
  /^https:\/\/gibs\.earthdata\.nasa\.gov\/wmts\/epsg4326\/best\/BlueMarble_NextGeneration\//,
];

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) if (!KEEP.includes(name)) await caches.delete(name);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || request.headers.has('range')) return;
  const url = new URL(request.url);

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request, SHELL));
    return;
  }
  if (url.origin === self.location.origin) {
    const scope = new URL(self.registration.scope);
    const path = url.pathname.slice(scope.pathname.length);
    if (path === 'sw.js') return;
    event.respondWith(path.startsWith('assets/') ? cacheFirst(request, ASSETS) : staleWhileRevalidate(event, request, DATA));
    return;
  }
  if (STATIC_REMOTE.some((pattern) => pattern.test(request.url))) {
    event.respondWith(cacheFirst(request, TILES, TILE_LIMIT));
  }
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch (error) {
    // Any page of the app is the same page: a link with ?guide= opens offline too.
    const kept = (await cache.match(request, { ignoreSearch: true })) ?? (await cache.match(self.registration.scope));
    if (kept) return kept;
    throw error;
  }
}

async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const kept = await cache.match(request);
  if (kept) return kept;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    if (limit) await trim(cache, limit);
  }
  return response;
}

async function staleWhileRevalidate(event, request, cacheName) {
  const cache = await caches.open(cacheName);
  const kept = await cache.match(request);
  const fresh = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  });
  if (kept) {
    event.waitUntil(fresh.catch(() => undefined));
    return kept;
  }
  return fresh;
}

/** Keys come back oldest first: drop from the front. */
async function trim(cache, limit) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]);
}
