import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

import { AuthProvider } from "@/lib/auth/AuthProvider";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";
import { resolveShopNameForMetadata } from "@/lib/shop/shopMetadata";

// Thai-first font that also covers Latin — used app-wide (item 26: "Font ไทยอ่านง่าย").
const notoSansThai = Noto_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

/**
 * Dynamic, not the static `metadata` export — SaaS roadmap: "ทำให้เป็นกลางสำหรับร้านทั่วไป".
 * The browser-tab title/description used to be hardcoded to the original shop's business
 * ("POS ร้านก๋วยเตี๋ยว") and shown that way on every tenant's subdomain. `resolveShopNameForMetadata`
 * resolves the requesting shop (or `null` for the platform's own landing page/apex domain — see
 * its own comment) from the same `x-shop-slug` header `proxy.ts` already sets for routing.
 * `app/manifest.ts` does the equivalent for the installed-PWA name/short_name.
 */
export async function generateMetadata(): Promise<Metadata> {
  const shopName = await resolveShopNameForMetadata();
  const title = shopName ? `POS ${shopName}` : "RanPOS";
  return {
    title,
    description: shopName ? `ระบบ POS ร้าน${shopName}` : "ระบบ POS เช่าใช้ สำหรับร้านค้าทั่วไป",
    // Installed-app icon on iOS — Next.js auto-detects `app/apple-icon.png` and adds the
    // `<link rel="apple-touch-icon">` tag itself; `appleWebApp` below adds the rest of what iOS
    // needs to launch standalone (no URL bar) instead of as a bookmarked Safari tab.
    appleWebApp: {
      capable: true,
      title,
      statusBarStyle: "black-translucent",
    },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Matches `app/manifest.ts`'s theme_color — the color Android tints the status bar/app
  // switcher card with once installed.
  themeColor: "#DC2626",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${notoSansThai.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <RegisterServiceWorker />
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
