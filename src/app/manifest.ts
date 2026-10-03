import type { MetadataRoute } from "next";

import { resolveShopNameForMetadata } from "@/lib/shop/shopMetadata";

/**
 * Dynamic (not a static `manifest.json`) so the installed-PWA name follows the requesting
 * shop's subdomain — SaaS roadmap: "ทำให้เป็นกลางสำหรับร้านทั่วไป" (see `resolveShopNameForMetadata`
 * and the root `layout.tsx`'s matching `generateMetadata`, which does the same for the browser
 * tab). Calling that function reads `headers()` under the hood, which is what makes Next.js treat
 * this route as per-request instead of caching one build-time manifest for every shop — see
 * `node_modules/next/dist/docs/.../manifest.md`'s "Good to know" on request-time APIs.
 *
 * `short_name` is capped — it renders under the home-screen icon, where a long shop name would
 * wrap or clip.
 */
export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const shopName = await resolveShopNameForMetadata();
  const name = shopName ? `POS ${shopName}` : "RanPOS";
  const shortName = shopName ? truncate(shopName, 14) : "RanPOS";

  return {
    name,
    short_name: shortName,
    description: shopName ? `ระบบ POS ร้าน${shopName}` : "ระบบ POS เช่าใช้ สำหรับร้านค้าทั่วไป",
    start_url: "/pos",
    scope: "/",
    display: "standalone",
    orientation: "any",
    background_color: "#FFF3E0",
    theme_color: "#DC2626",
    lang: "th",
    dir: "ltr",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
      { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
      { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
