"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCurrency } from "@/lib/format";
import type { Shop, Subscription } from "@/types";

const STATUS_LABEL: Record<Subscription["status"], string> = {
  trialing: "ทดลองใช้งาน",
  active: "ใช้งานปกติ",
  past_due: "ตัดบัตรล้มเหลว",
  suspended: "ถูกระงับ",
  canceled: "ยกเลิกแล้ว",
};
const STATUS_VARIANT: Record<Subscription["status"], "default" | "success" | "muted" | "destructive"> = {
  trialing: "default",
  active: "success",
  past_due: "destructive",
  suspended: "destructive",
  canceled: "muted",
};

export interface SubscriptionRow {
  subscription: Subscription;
  shop: Shop | null;
}

/** Superadmin's per-shop billing status list + manual overrides (SaaS roadmap Phase 3). */
export function SubscriptionsConsole({ rows }: { rows: SubscriptionRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function callAction(shopId: string, action: string, body?: object) {
    setBusyId(shopId);
    try {
      await fetch(`/api/superadmin/subscriptions/${shopId}/${action}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body ?? {}),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-4">
      {rows.map(({ subscription, shop }) => (
        <Card key={subscription.id}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{shop?.name ?? subscription.shopId}</CardTitle>
              <Badge variant={STATUS_VARIANT[subscription.status]}>{STATUS_LABEL[subscription.status]}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>ค่าบริการ: {formatCurrency(subscription.priceThb, "THB")} / เดือน</p>
            <p>ทดลองใช้งานถึง: {new Date(subscription.trialEndsAt).toLocaleDateString("th-TH")}</p>
            {subscription.nextBillingDate && (
              <p>รอบตัดบัตรถัดไป: {new Date(subscription.nextBillingDate).toLocaleDateString("th-TH")}</p>
            )}
            {subscription.graceEndsAt && (
              <p className="text-destructive">
                หมดช่วงผ่อนผัน: {new Date(subscription.graceEndsAt).toLocaleDateString("th-TH")}
              </p>
            )}
            {subscription.lastChargeError && (
              <p className="text-muted-foreground">ล่าสุด: {subscription.lastChargeError}</p>
            )}
            <p className="text-muted-foreground">
              บัตร: {subscription.omiseCustomerId ? "มีบัตรผูกไว้แล้ว" : "ยังไม่มีบัตร"}
            </p>

            <div className="mt-3 flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === subscription.shopId}
                onClick={() => callAction(subscription.shopId, "extend-trial", { days: 7 })}
              >
                ต่อทดลองใช้ 7 วัน
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === subscription.shopId}
                onClick={() => callAction(subscription.shopId, "mark-paid")}
              >
                ทำเครื่องหมายชำระแล้ว
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busyId === subscription.shopId || !subscription.omiseCustomerId}
                onClick={() => callAction(subscription.shopId, "retry-charge")}
              >
                ลองตัดบัตรอีกครั้ง
              </Button>
              {subscription.status === "suspended" ? (
                <Button
                  size="sm"
                  disabled={busyId === subscription.shopId}
                  onClick={() => callAction(subscription.shopId, "unsuspend")}
                >
                  ปลดระงับ
                </Button>
              ) : (
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={busyId === subscription.shopId}
                  onClick={() => callAction(subscription.shopId, "suspend")}
                >
                  ระงับการใช้งาน
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}

      {rows.length === 0 ? <p className="text-center text-muted-foreground">ยังไม่มีร้านที่สมัคร</p> : null}
    </div>
  );
}
