import type { Metadata, Viewport } from "next";
import { Noto_Sans_Thai } from "next/font/google";
import "./globals.css";

import { AuthProvider } from "@/lib/auth/AuthProvider";

// Thai-first font that also covers Latin — used app-wide (item 26: "Font ไทยอ่านง่าย").
// The shop name below is only a build-time fallback string, never the source of truth —
// the real value always comes from the `shopSettings` document (item 16, item 34).
const notoSansThai = Noto_Sans_Thai({
  variable: "--font-thai",
  subsets: ["thai", "latin"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "POS ร้านก๋วยเตี๋ยว",
  description: "ระบบ POS สำหรับร้านก๋วยเตี๋ยว/ลูกชิ้น",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${notoSansThai.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
