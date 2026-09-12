"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { compressImageFile } from "@/lib/billing/compressImage";
import { formatCurrency } from "@/lib/format";
import type { BillingConfig, PaymentSlip } from "@/types";

const SLIP_STATUS_LABEL: Record<PaymentSlip["status"], string> = {
  pending: "รอตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ถูกปฏิเสธ",
};
const SLIP_STATUS_VARIANT: Record<PaymentSlip["status"], "default" | "success" | "destructive"> = {
  pending: "default",
  approved: "success",
  rejected: "destructive",
};

/**
 * Shop-facing bank-transfer/QR payment flow (SaaS roadmap Phase 3 — the alternative to Omise
 * card billing, confirmed with the user). Shows the platform's one shared bank account/QR
 * (`billingConfig`, set once by the superadmin), lets the shop upload a photo of their transfer
 * slip, and lists that shop's own past submissions with their review status. There is no
 * auto-verification — a submitted slip just sits as `pending` until a human (the superadmin)
 * looks at it and approves or rejects it, which can take a while; the shop sees that state
 * reflected here rather than silently waiting.
 */
export function SlipUploadForm({
  billingConfig,
  defaultAmountThb,
  slips,
  onSubmitted,
}: {
  billingConfig: BillingConfig;
  defaultAmountThb: number;
  slips: PaymentSlip[];
  onSubmitted: () => void;
}) {
  const [amountThb, setAmountThb] = useState(String(defaultAmountThb));
  const [note, setNote] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!billingConfig.bankAccountNumber) {
    // Superadmin hasn't set up the transfer option yet — nothing sensible to show.
    return <p className="text-sm text-muted-foreground">ยังไม่เปิดให้ชำระด้วยการโอนเงินในขณะนี้</p>;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const amount = Number(amountThb);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("กรุณาระบุจำนวนเงินให้ถูกต้อง");
      return;
    }
    if (!file) {
      setError("กรุณาแนบรูปสลิปโอนเงิน");
      return;
    }

    setSubmitting(true);
    try {
      const slipImage = await compressImageFile(file);
      const res = await fetch("/api/billing/slip", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ amountThb: amount, slipImage, note: note.trim() || undefined }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "ส่งสลิปไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      setFile(null);
      setNote("");
      onSubmitted();
    } catch (err) {
      setError(err instanceof Error ? err.message : "ส่งสลิปไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>โอนเงินเข้าบัญชี</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3">
          <div className="grid gap-1 text-sm">
            <p>ธนาคาร: {billingConfig.bankName}</p>
            <p>ชื่อบัญชี: {billingConfig.bankAccountName}</p>
            <p>เลขบัญชี: {billingConfig.bankAccountNumber}</p>
          </div>
          {billingConfig.qrCodeImage && (
            // eslint-disable-next-line @next/next/no-img-element -- data URL, not a Next-optimizable remote asset
            <img
              src={billingConfig.qrCodeImage}
              alt="QR สำหรับโอนเงิน"
              className="mx-auto h-56 w-56 rounded-md border border-border object-contain"
            />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>แนบสลิปโอนเงิน</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="slipAmount">จำนวนเงินที่โอน (บาท)</Label>
              <Input
                id="slipAmount"
                type="number"
                min={0}
                required
                value={amountThb}
                onChange={(e) => setAmountThb(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="slipImage">รูปสลิป</Label>
              <Input
                id="slipImage"
                type="file"
                accept="image/*"
                required
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="slipNote">หมายเหตุ (ถ้ามี)</Label>
              <Textarea id="slipNote" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={submitting}>
              {submitting ? "กำลังส่ง..." : "ส่งสลิป"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {slips.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>ประวัติการส่งสลิป</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3">
            {slips.map((slip) => (
              <div key={slip.id} className="flex items-center justify-between gap-2 border-b border-border pb-2 text-sm last:border-0 last:pb-0">
                <div>
                  <p>{formatCurrency(slip.amountThb, "THB")}</p>
                  <p className="text-muted-foreground">{new Date(slip.submittedAt).toLocaleString("th-TH")}</p>
                  {slip.status === "rejected" && slip.reviewNote && (
                    <p className="text-destructive">เหตุผล: {slip.reviewNote}</p>
                  )}
                </div>
                <Badge variant={SLIP_STATUS_VARIANT[slip.status]}>{SLIP_STATUS_LABEL[slip.status]}</Badge>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
