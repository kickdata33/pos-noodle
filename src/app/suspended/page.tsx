import Link from "next/link";
import { redirect } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getServerSession } from "@/lib/auth/session";

/**
 * Landed on by `/admin` and `/pos`'s layout gate once a shop's subscription status is
 * `suspended` (SaaS roadmap Phase 3) — trial ended with no card ever added, or the 3-day grace
 * window after a failed charge expired unpaid. `/billing` stays reachable from here (and isn't
 * itself gated) so a shop can recover access on its own by adding/fixing a card.
 */
export default async function SuspendedPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // A shop that isn't actually suspended has no reason to be here — send them back.
  if (session.subscription?.status !== "suspended") redirect("/pos");

  return (
    <main className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
      <Card>
        <CardHeader>
          <CardTitle>บัญชีถูกระงับการใช้งานชั่วคราว</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <p className="text-muted-foreground">
            {session.subscription.lastChargeError
              ? `การตัดบัตรล้มเหลว: ${session.subscription.lastChargeError}`
              : "ยังไม่มีบัตรผูกกับร้านนี้ หรือช่วงทดลองใช้งานหมดอายุแล้ว"}
          </p>
          <p className="text-muted-foreground">
            กรุณาอัปเดตข้อมูลการชำระเงินเพื่อเปิดใช้งานระบบอีกครั้ง
          </p>
          <Button asChild>
            <Link href="/billing">ไปหน้าชำระเงิน</Link>
          </Button>
        </CardContent>
      </Card>
    </main>
  );
}
