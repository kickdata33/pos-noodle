"use client";

import { useEffect } from "react";

/**
 * Registers `public/sw.js` — the only piece of the PWA setup that has to happen from client
 * code (manifest + icons are plain file-convention statics Next.js links automatically, see
 * `app/manifest.json` and `app/apple-icon.png`). A registered service worker is Chrome/Android's
 * hard requirement for "เพิ่มไปที่หน้าจอโฮม" to install in standalone mode instead of opening a
 * normal browser tab with the URL bar — see `sw.js` itself for why it deliberately caches
 * nothing. Renders nothing; this is pure side effect.
 */
export function RegisterServiceWorker() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker.register("/sw.js").catch((err) => {
      console.error("Service worker registration failed", err);
    });
  }, []);

  return null;
}
