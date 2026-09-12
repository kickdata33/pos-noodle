import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/**
 * Apex-domain marketing/signup landing page (SaaS roadmap Phase 2/3) — shown only when a
 * request carries no shop subdomain (`src/proxy.ts` sets no `x-shop-slug` header), i.e. the bare
 * `ranpos.online`, `pos-noodle.vercel.app`, or a local dev server. Every shop's own POS/Admin
 * still lives at `{slug}.ranpos.online` and is untouched by this page.
 *
 * Deliberately a plain server-rendered page (no client JS) — this replaces paying for a
 * separate page-builder product just to have something to show at the apex; the app is already
 * hosted on Vercel, so this costs nothing extra.
 */
export function LandingPage() {
  return (
    <main className="flex min-h-full flex-col">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4 sm:px-6">
          <span className="text-lg font-bold text-primary">RanPOS</span>
          <nav className="flex items-center gap-2">
            <Button asChild variant="ghost" size="sm">
              <Link href="/login">เข้าสู่ระบบ</Link>
            </Button>
            <Button asChild size="sm">
              <Link href="/signup">สมัครใช้งานฟรี</Link>
            </Button>
          </nav>
        </div>
      </header>

      <section className="mx-auto w-full max-w-5xl px-4 py-16 text-center sm:px-6 sm:py-24">
        <p className="mb-3 text-sm font-medium text-primary">ระบบ POS สำหรับร้านอาหารไทย</p>
        <h1 className="text-3xl font-bold tracking-tight sm:text-5xl">
          จัดการร้านอาหาร ง่าย ครบ จบในระบบเดียว
        </h1>
        <p className="mx-auto mt-4 max-w-2xl text-base text-muted-foreground sm:text-lg">
          สั่งอาหาร คิดเงิน จัดการโต๊ะ และดูยอดขายแบบเรียลไทม์ — ออกแบบมาให้พนักงานหน้าร้านใช้ได้ทันทีโดยไม่ต้องฝึกนาน
        </p>
        <div className="mt-8 flex flex-col items-center justify-center gap-3 sm:flex-row">
          <Button asChild size="lg">
            <Link href="/signup">เริ่มสมัครใช้งานฟรี</Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="/login">ร้านที่สมัครแล้ว เข้าสู่ระบบ</Link>
          </Button>
        </div>
      </section>

      <section className="mx-auto w-full max-w-5xl px-4 pb-20 sm:px-6">
        <div className="grid gap-4 sm:grid-cols-3">
          {FEATURES.map((feature) => (
            <Card key={feature.title}>
              <CardContent className="p-6">
                <h3 className="mb-2 text-base font-semibold">{feature.title}</h3>
                <p className="text-sm text-muted-foreground">{feature.description}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>

      <footer className="mt-auto border-t border-border py-6 text-center text-sm text-muted-foreground">
        © {new Date().getFullYear()} RanPOS
      </footer>
    </main>
  );
}

const FEATURES = [
  {
    title: "สั่งอาหารและคิดเงินไว",
    description: "หน้าจอสั่งอาหารสำหรับพนักงาน รองรับทั้งนั่งโต๊ะ กลับบ้าน และเดลิเวอรี พร้อมคำนวณยอด/ทอนเงินอัตโนมัติ",
  },
  {
    title: "จัดการร้านจากที่ไหนก็ได้",
    description: "เมนู โต๊ะ พนักงาน และรายงานยอดขาย จัดการผ่านเว็บเบราว์เซอร์ ไม่ต้องติดตั้งโปรแกรมเพิ่ม",
  },
  {
    title: "ร้านของคุณ โดเมนของคุณ",
    description: "แต่ละร้านมีลิงก์ของตัวเอง (เช่น yourshop.ranpos.online) แยกข้อมูลกันชัดเจน ปลอดภัย",
  },
];
