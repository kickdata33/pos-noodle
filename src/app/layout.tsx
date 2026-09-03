import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

import { AuthProvider } from "@/lib/auth/AuthProvider";
import { RegisterServiceWorker } from "@/components/RegisterServiceWorker";

// Thai-first font that also covers Latin — used app-wide (item 26: "Font ไทยอ่านง่าย").
// The shop name below is only a build-time fallback string, never the source of truth —
// the real value always comes from the `shopSettings` document (item 16, item 34). Same
// reasoning applies to `app/manifest.json`'s "name"/"short_name" — a PWA manifest has to be a
// static file Next.js can link at build time, so it can't read `shopSettings` either; it's a
// fallback in the same sense, not a second source of truth.
const notoSansThai = Noto_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "POS ร้านก๋วยเตี๋ยว",
  description: "ระบบ POS สำหรับร้านก๋วยเตี๋ยว/ลูกชิ้น",
  // Installed-app icon on iOS — Next.js auto-detects `app/apple-icon.png` and adds the
  // `<link rel="apple-touch-icon">` tag itself; `appleWebApp` below adds the rest of what iOS
  // needs to launch standalone (no URL bar) instead of as a bookmarked Safari tab.
  appleWebApp: {
    capable: true,
    title: "POS ก๋วยเตี๋ยว",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  // Matches `app/manifest.json`'s theme_color — the color Android tints the status bar/app
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
