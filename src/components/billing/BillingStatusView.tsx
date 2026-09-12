"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { BillingCardForm } from "@/components/billing/BillingCardForm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { Subscription } from "@/types";

const STATUS_LABEL: Record<Subscription["status"], string> = {
  trialing: "ทดลองใช้งาน",
  active: "ใช้งานปกติ",
  past_due: "ตัดบัตรล้มเหลว (อยู่ในช่วงผ่อนผัน)",
  suspended: "ถูกระงับการใช้งาน",
  canceled: "ยกเลิกแล้ว",
};
const STATUS_VARIANT: Record<Subscription["status"], "default" | "success" | "muted" | "destructive"> = {
  trialing: "default",
  active: "success",
  past_due: "destructive",
  suspended: "destructive",
  canceled: "muted",
};

/**
 * Client half of `/billing` — shows current subscription status and the card form when there's
 * no card on file yet, or a "เปลี่ยนบัตร" affordance when there is (SaaS roadmap Phase 3).
 */
export function BillingStatusView({ subscription }: { subscription: Subscription | null }) {
  const router = useRouter();
  const [showForm, setShowForm] = useState(!subscription?.omiseCustomerId);

  if (!subscription) {
    // Shouldn't normally happen (every shop gets one at provisioning) — fail safe rather than
    // crash the page.
    return <p className="text-muted-foreground">ไม่พบข้อมูลการชำระเงินของร้านนี้</p>;
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center justify-between">
            สถานะ
            <Badge variant={STATUS_VARIANT[subscription.status]}>{STATUS_LABEL[subscription.status]}</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-1 text-sm text-muted-foreground">
          {subscription.status === "trialing" && (
            <p>ทดลองใช้งานฟรีถึงวันที่ {new Date(subscription.trialEndsAt).toLocaleDateString("th-TH")}</p>
          )}
          {subscription.nextBillingDate && (
            <p>รอบตัดบัตรถัดไป: {new Date(subscription.nextBillingDate).toLocaleDateString("th-TH")}</p>
          )}
          <p>ค่าบริการ: {formatCurrency(subscription.priceThb, "THB")} / เดือน</p>
          {subscription.omiseCustomerId && <p>มีบัตรผูกกับร้านนี้แล้ว</p>}
          {subscription.lastChargeStatus === "failed" && subscription.lastChargeError && (
            <p className="text-destructive">ล่าสุด: {subscription.lastChargeError}</p>
          )}
        </CardContent>
      </Card>

      {showForm ? (
        <BillingCardForm onSaved={() => router.refresh()} />
      ) : (
        <button
          type="button"
          className="text-sm text-primary underline"
          onClick={() => setShowForm(true)}
        >
          เปลี่ยนบัตร
        </button>
      )}
    </div>
  );
}
