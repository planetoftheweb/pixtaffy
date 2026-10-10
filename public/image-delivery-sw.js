const STORAGE_HOST = 'firebasestorage.googleapis.com';
const IMAGE_CACHE = 'pixtaffy-storage-images-v1';
const MAX_CACHED_IMAGES = 200;

const isStorageRequest = (request) => {
  if (request.method !== 'GET') return false;
  try {
    return new URL(request.url).hostname === STORAGE_HOST;
  } catch {
    return false;
  }
};

const proxyUrlFor = (sourceUrl) => {
  const proxyUrl = new URL('/api/media', self.location.origin);
  proxyUrl.searchParams.set('url', sourceUrl);
  return proxyUrl.toString();
};

const cacheResponse = async (cache, key, response) => {
  if (!(response.ok || response.type === 'opaque')) return;
  try {
    await cache.put(key, response.clone());
    const keys = await cache.keys();
    const overflow = Math.max(0, keys.length - MAX_CACHED_IMAGES);
    await Promise.all(keys.slice(0, overflow).map((request) => cache.delete(request)));
  } catch {
    // Cache Storage is a performance/reliability layer, never a render gate.
  }
};

const deliverStorageRequest = async (request) => {
  const cache = await caches.open(IMAGE_CACHE);
  try {
    const directResponse = await fetch(request);
    void cacheResponse(cache, request.url, directResponse);
    return directResponse;
  } catch (directError) {
    const cachedResponse = await cache.match(request.url);
    if (cachedResponse) return cachedResponse;

    // A no-cors cross-origin image request may only receive an opaque
    // response from respondWith(). Let the page-level capture handler retry
    // those <img> elements against the same-origin route instead.
    if (request.mode === 'no-cors') throw directError;

    try {
      const proxyResponse = await fetch(proxyUrlFor(request.url), {
        credentials: 'same-origin',
      });
      if (!proxyResponse.ok) throw new Error(`PixTaffy image delivery returned ${proxyResponse.status}`);
      void cacheResponse(cache, request.url, proxyResponse);
      return proxyResponse;
    } catch {
      throw directError;
    }
  }
};

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (!isStorageRequest(event.request)) return;
  event.respondWith(deliverStorageRequest(event.request));
});
