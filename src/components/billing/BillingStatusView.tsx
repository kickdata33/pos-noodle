"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { BillingCardForm } from "@/components/billing/BillingCardForm";
import { SlipUploadForm } from "@/components/billing/SlipUploadForm";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { BillingConfig, PaymentSlip, Subscription } from "@/types";

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

type PaymentTab = "card" | "transfer";

/**
 * Client half of `/billing` — shows current subscription status, then either the Omise card
 * form or the bank-transfer/slip-upload flow, whichever the shop picks (SaaS roadmap Phase 3:
 * both options are always offered side by side, confirmed with the user — this is not a
 * fallback, the shop just chooses whichever is convenient for them each time).
 */
export function BillingStatusView({
  subscription,
  billingConfig,
  slips,
}: {
  subscription: Subscription | null;
  billingConfig: BillingConfig;
  slips: PaymentSlip[];
}) {
  const router = useRouter();
  const [showCardForm, setShowCardForm] = useState(!subscription?.omiseCustomerId);
  const hasTransferOption = Boolean(billingConfig.bankAccountNumber);
  const [tab, setTab] = useState<PaymentTab>(subscription?.omiseCustomerId || !hasTransferOption ? "card" : "transfer");

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

      {hasTransferOption && (
        <div className="flex gap-2 rounded-md bg-muted p-1 text-sm">
          <button
            type="button"
            className={`flex-1 rounded-sm py-1.5 font-medium ${tab === "card" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
            onClick={() => setTab("card")}
          >
            บัตรเครดิต/เดบิต
          </button>
          <button
            type="button"
            className={`flex-1 rounded-sm py-1.5 font-medium ${tab === "transfer" ? "bg-card shadow-sm" : "text-muted-foreground"}`}
            onClick={() => setTab("transfer")}
          >
            โอนเงิน/QR
          </button>
        </div>
      )}

      {tab === "card" ? (
        showCardForm ? (
          <BillingCardForm onSaved={() => router.refresh()} />
        ) : (
          <button
            type="button"
            className="text-sm text-primary underline"
            onClick={() => setShowCardForm(true)}
          >
            เปลี่ยนบัตร
          </button>
        )
      ) : (
        <SlipUploadForm
          billingConfig={billingConfig}
          defaultAmountThb={subscription.priceThb}
          slips={slips}
          onSubmitted={() => router.refresh()}
        />
      )}
    </div>
  );
}
