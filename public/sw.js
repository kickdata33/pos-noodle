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

// --- Lock-screen "เรียกเสิร์ฟ" notifications (Web Push) — see src/lib/push/webPush.ts ---
// A call shows as a sticky, vibrating notification; when someone acknowledges it, the server
// sends a "done" push with the same tag, which quietly replaces the alert on every phone.
self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "อาหารพร้อมเสิร์ฟ", body: event.data ? event.data.text() : "" };
  }
  const done = data.kind === "serveCallDone";
  const tag = "serve-" + (data.callId || "call");
  event.waitUntil(
    self.registration.showNotification(data.title || "อาหารพร้อมเสิร์ฟ", {
      body: data.body || "",
      tag,
      renotify: !done,
      requireInteraction: !done,
      silent: done,
      vibrate: done ? undefined : [500, 200, 500, 200, 800],
      icon: "/icons/icon-192.png",
      badge: "/icons/icon-192.png",
      data: { url: "/pos" },
    })
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || "/pos";
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clients) => {
      // Bring an open POS window forward (its full-screen alarm has the "รับทราบ" button);
      // otherwise open the POS.
      for (const client of clients) {
        if ("focus" in client) return client.focus();
      }
      return self.clients.openWindow(url);
    })
  );
});
