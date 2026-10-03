"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/format";
import { MODULE_LABELS, type EnabledModules, type ShopModuleKey } from "@/lib/shop/modules";
import type { AppUser, PaymentSlip, Shop, Subscription } from "@/types";

const MODULE_KEYS = Object.keys(MODULE_LABELS) as ShopModuleKey[];

function randomPin(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

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

/** `<input type="date">` wants "YYYY-MM-DD"; empty string leaves the field blank (no date set). */
function toDateInputValue(ms: number | null): string {
  if (ms === null) return "";
  return new Date(ms).toISOString().slice(0, 10);
}

export interface SubscriptionRow {
  subscription: Subscription;
  shop: Shop | null;
  pendingSlips: PaymentSlip[];
  enabledModules: EnabledModules;
  admins: AppUser[];
}

/** Superadmin's per-shop billing status list + manual overrides (SaaS roadmap Phase 3),
 * including reviewing bank-transfer slips (Phase 3 bank-transfer alternative — a human looks at
 * every slip, no auto-verify, confirmed with the user). */
export function SubscriptionsConsole({ rows }: { rows: SubscriptionRow[] }) {
  const router = useRouter();
  const [busyId, setBusyId] = useState<string | null>(null);

  const [resetting, setResetting] = useState<{ shopId: string; uid: string; name: string } | null>(null);
  const [resetPin, setResetPin] = useState("");
  const [resetSubmitting, setResetSubmitting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetDone, setResetDone] = useState(false);

  function openReset(shopId: string, uid: string, name: string) {
    setResetting({ shopId, uid, name });
    setResetPin(randomPin());
    setResetError(null);
    setResetDone(false);
  }

  async function submitReset() {
    if (!resetting) return;
    setResetSubmitting(true);
    setResetError(null);
    try {
      const res = await fetch(`/api/superadmin/subscriptions/${resetting.shopId}/reset-admin-pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ uid: resetting.uid, pin: resetPin }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setResetError(data.error ?? "รีเซ็ต PIN ไม่สำเร็จ");
        return;
      }
      setResetDone(true);
    } catch {
      setResetError("รีเซ็ต PIN ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setResetSubmitting(false);
    }
  }

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

  async function deleteShop(shopId: string, shopName: string) {
    const typed = window.prompt(
      `พิมพ์ชื่อร้าน "${shopName}" ให้ตรงเป๊ะเพื่อยืนยันการลบถาวร — ลบแล้วกู้คืนไม่ได้ ข้อมูลออเดอร์/พนักงาน/บิลทั้งหมดของร้านนี้จะหายหมด`
    );
    if (typed !== shopName) {
      if (typed !== null) window.alert("ชื่อไม่ตรง ยกเลิกการลบ");
      return;
    }
    setBusyId(shopId);
    try {
      const res = await fetch(`/api/superadmin/subscriptions/${shopId}/delete`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        window.alert(data.error ?? "ลบไม่สำเร็จ");
        return;
      }
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function saveSchedule(shopId: string) {
    const suspendInput = document.getElementById(`suspend-${shopId}`) as HTMLInputElement | null;
    const reactivateInput = document.getElementById(`reactivate-${shopId}`) as HTMLInputElement | null;
    const scheduledSuspendAt = suspendInput?.value ? new Date(suspendInput.value).getTime() : null;
    const scheduledReactivateAt = reactivateInput?.value ? new Date(reactivateInput.value).getTime() : null;

    setBusyId(shopId);
    try {
      await fetch(`/api/superadmin/subscriptions/${shopId}/schedule`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledSuspendAt, scheduledReactivateAt }),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  async function toggleModule(shopId: string, moduleKey: ShopModuleKey, value: boolean) {
    await callAction(shopId, "modules", { [moduleKey]: value });
  }

  async function reviewSlip(shopId: string, slipId: string, decision: "approve" | "reject") {
    const reason =
      decision === "reject" ? window.prompt("เหตุผลที่ปฏิเสธ (ถ้ามี)") ?? undefined : undefined;
    setBusyId(shopId);
    try {
      await fetch(`/api/superadmin/subscriptions/${shopId}/slips/${slipId}/${decision}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(decision === "reject" ? { reason } : {}),
      });
      router.refresh();
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="grid gap-4">
      {rows.map(({ subscription, shop, pendingSlips, enabledModules, admins }) => (
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

            {pendingSlips.length > 0 && (
              <div className="mt-2 grid gap-3">
                {pendingSlips.map((slip) => (
                  <div key={slip.id} className="rounded-md border border-border p-3">
                    <p className="mb-2 text-sm font-medium">
                      สลิปโอนเงิน {formatCurrency(slip.amountThb, "THB")} —{" "}
                      {new Date(slip.submittedAt).toLocaleString("th-TH")}
                    </p>
                    {slip.note && <p className="mb-2 text-sm text-muted-foreground">หมายเหตุ: {slip.note}</p>}
                    {/* eslint-disable-next-line @next/next/no-img-element -- data URL, not a Next-optimizable remote asset */}
                    <img
                      src={slip.slipImage}
                      alt="สลิปโอนเงิน"
                      className="mb-2 max-h-96 w-full rounded-md border border-border object-contain"
                    />
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        disabled={busyId === subscription.shopId}
                        onClick={() => reviewSlip(subscription.shopId, slip.id, "approve")}
                      >
                        อนุมัติ
                      </Button>
                      <Button
                        size="sm"
                        variant="destructive"
                        disabled={busyId === subscription.shopId}
                        onClick={() => reviewSlip(subscription.shopId, slip.id, "reject")}
                      >
                        ปฏิเสธ
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}

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

            <div className="mt-3 rounded-md border border-border p-3 text-sm">
              <p className="mb-2 font-medium">ตั้งเวลาอัตโนมัติ (เช็คทุกวัน ไม่ใช่นาทีต่อนาที)</p>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="grid gap-1">
                  <label htmlFor={`suspend-${subscription.shopId}`} className="text-xs text-muted-foreground">
                    ระงับอัตโนมัติวันที่
                  </label>
                  <input
                    id={`suspend-${subscription.shopId}`}
                    type="date"
                    defaultValue={toDateInputValue(subscription.scheduledSuspendAt ?? null)}
                    className="h-10 rounded-md border border-input bg-card px-2 text-sm"
                  />
                </div>
                <div className="grid gap-1">
                  <label htmlFor={`reactivate-${subscription.shopId}`} className="text-xs text-muted-foreground">
                    เปิดใช้งานอัตโนมัติวันที่
                  </label>
                  <input
                    id={`reactivate-${subscription.shopId}`}
                    type="date"
                    defaultValue={toDateInputValue(subscription.scheduledReactivateAt ?? null)}
                    className="h-10 rounded-md border border-input bg-card px-2 text-sm"
                  />
                </div>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="mt-2"
                disabled={busyId === subscription.shopId}
                onClick={() => saveSchedule(subscription.shopId)}
              >
                บันทึกเวลาที่ตั้ง
              </Button>
            </div>

            <div className="mt-3 rounded-md border border-border p-3 text-sm">
              <p className="mb-2 font-medium">
                โมดูลเฉพาะทาง (ปิดเป็นค่าเริ่มต้นสำหรับร้านทั่วไป — เปิดเฉพาะร้านที่ต้องการ)
              </p>
              <div className="grid gap-2 sm:grid-cols-2">
                {MODULE_KEYS.map((key) => (
                  <label key={key} className="flex items-center justify-between gap-2">
                    <span>{MODULE_LABELS[key]}</span>
                    <Switch
                      checked={enabledModules[key]}
                      disabled={busyId === subscription.shopId}
                      onCheckedChange={(checked) => toggleModule(subscription.shopId, key, checked)}
                    />
                  </label>
                ))}
              </div>
            </div>

            <div className="mt-3 rounded-md border border-border p-3 text-sm">
              <p className="mb-2 font-medium">บัญชีแอดมิน</p>
              {admins.length === 0 ? (
                <p className="text-muted-foreground">ไม่พบบัญชีแอดมินของร้านนี้ในระบบ</p>
              ) : (
                <div className="grid gap-2">
                  {admins.map((admin) => (
                    <div key={admin.id} className="flex items-center justify-between gap-2">
                      <span>{admin.name}</span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openReset(subscription.shopId, admin.id, admin.name)}
                      >
                        รีเซ็ต PIN
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="mt-3">
              <Button
                size="sm"
                variant="destructive"
                disabled={busyId === subscription.shopId}
                onClick={() => deleteShop(subscription.shopId, shop?.name ?? subscription.shopId)}
              >
                ลบร้านถาวร
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      {rows.length === 0 ? <p className="text-center text-muted-foreground">ยังไม่มีร้านที่สมัคร</p> : null}

      <Dialog open={resetting !== null} onOpenChange={(open) => !open && setResetting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>รีเซ็ต PIN: {resetting?.name}</DialogTitle>
          </DialogHeader>

          {resetDone ? (
            <div className="grid gap-2 text-sm">
              <p>ตั้ง PIN ใหม่สำเร็จ — ส่ง PIN นี้ให้เจ้าของร้าน:</p>
              <p>
                PIN เข้าใช้งาน: <strong>{resetPin}</strong>
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="resetPin">PIN 6 หลักใหม่</Label>
                <div className="flex gap-2">
                  <Input id="resetPin" value={resetPin} onChange={(e) => setResetPin(e.target.value)} />
                  <Button type="button" variant="outline" onClick={() => setResetPin(randomPin())}>
                    สุ่ม
                  </Button>
                </div>
              </div>
              {resetError ? <p className="text-sm text-destructive">{resetError}</p> : null}
            </div>
          )}

          <DialogFooter>
            {resetDone ? (
              <Button onClick={() => setResetting(null)}>ปิด</Button>
            ) : (
              <Button onClick={submitReset} disabled={resetSubmitting}>
                {resetSubmitting ? "กำลังตั้งค่า..." : "ยืนยันรีเซ็ต"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
