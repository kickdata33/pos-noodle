// Minimal service worker — exists ONLY to satisfy Chrome/Android's installability requirement
// (a registered service worker with a fetch handler) so "เพิ่มไปที่หน้าจอโฮม" launches in
// standalone mode with no URL bar. Deliberately does NOT cache anything: this is a POS, where a
// stale menu, price, or order screen served from a cache is a worse failure than a network
// request that takes an extra moment. Every request just passes straight through to the network.
self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("fetch", () => {
  // No-op: not calling event.respondWith() means the browser handles the request normally,
  // exactly as if this service worker didn't exist. Present only for the installability check.
});
