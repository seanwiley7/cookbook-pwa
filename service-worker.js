const CACHE_NAME = "cookbook-v3";

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
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => {
      return cache.addAll([
        "./",
        "./index.html",
        "./styles.css",
        "./script.js",
        "./manifest.json"
      ]);
    })
  );
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
self.addEventListener("fetch", (event) => {
  // If the user refreshes or enters a URL
  if (event.request.mode === "navigate") {
    event.respondWith(
      caches.match("./index.html").then((cached) => {
        return cached || fetch(event.request);
      })
    );
    return;
  }

  // Normal file requests
  event.respondWith(
    caches.match(event.request).then((cached) => {
      return cached || fetch(event.request);
    })
  );
});

