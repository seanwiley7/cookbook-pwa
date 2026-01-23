const CACHE_NAME = "cookbook-cache-v2";

// List of static files to cache
const STATIC_FILES = [
  "/",
  "/index.html",
  "/styles.css",
  "/script.js",
  "/manifest.json",
  "/icon.png"
];

// --------------------
// Install: Cache static assets
// --------------------
self.addEventListener("install", event => {
  console.log("[SW] Installing service worker and caching static assets");
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(STATIC_FILES))
  );
  self.skipWaiting(); // immediately activate new SW
});

// --------------------
// Activate: clean up old caches
// --------------------
self.addEventListener("activate", event => {
  console.log("[SW] Activating service worker");
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(key => key !== CACHE_NAME)
          .map(key => caches.delete(key))
      )
    )
  );
  self.clients.claim(); // take control immediately
});

// --------------------
// Fetch: Serve cached content, cache new GET requests
// --------------------
self.addEventListener("fetch", event => {
  const request = event.request;

  // Only handle GET requests
  if (request.method !== "GET") return;

  event.respondWith(
    caches.match(request).then(cachedResponse => {
      if (cachedResponse) return cachedResponse;

      return fetch(request)
        .then(networkResponse => {
          // Cache new requests
          return caches.open(CACHE_NAME).then(cache => {
            cache.put(request, networkResponse.clone());
            return networkResponse;
          });
        })
        .catch(() => {
          // Fallback if offline
          if (request.destination === "image") {
            return caches.match("/icon.png"); // fallback image
          }
        });
    })
  );
});
