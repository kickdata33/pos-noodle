"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { compressImageFile } from "@/lib/billing/compressImage";
import type { BillingConfig } from "@/types";

export function BillingConfigForm({ config }: { config: BillingConfig }) {
  const router = useRouter();
  const [trialDays, setTrialDays] = useState(String(config.trialDays));
  const [monthlyPriceThb, setMonthlyPriceThb] = useState(String(config.monthlyPriceThb));
  const [bankName, setBankName] = useState(config.bankName);
  const [bankAccountName, setBankAccountName] = useState(config.bankAccountName);
  const [bankAccountNumber, setBankAccountNumber] = useState(config.bankAccountNumber);
  const [qrCodeImage, setQrCodeImage] = useState<string | null>(config.qrCodeImage);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleQrFileChange(file: File | null) {
    if (!file) return;
    try {
      setQrCodeImage(await compressImageFile(file));
    } catch (err) {
      setError(err instanceof Error ? err.message : "อ่านรูป QR ไม่สำเร็จ");
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/superadmin/billing-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          trialDays: Number(trialDays),
          monthlyPriceThb: Number(monthlyPriceThb),
          bankName,
          bankAccountName,
          bankAccountNumber,
          qrCodeImage,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "บันทึกไม่สำเร็จ");
        return;
      }
      setSaved(true);
      router.refresh();
    } catch {
      setError("บันทึกไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>ตั้งค่าราคา/ช่วงทดลองใช้งาน</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4" onSubmit={handleSubmit}>
          <div className="grid gap-1.5">
            <Label htmlFor="trialDays">ช่วงทดลองใช้งานฟรี (วัน)</Label>
            <Input
              id="trialDays"
              type="number"
              min={0}
              value={trialDays}
              onChange={(e) => setTrialDays(e.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="monthlyPriceThb">ค่าบริการรายเดือน (บาท)</Label>
            <Input
              id="monthlyPriceThb"
              type="number"
              min={0}
              value={monthlyPriceThb}
              onChange={(e) => setMonthlyPriceThb(e.target.value)}
            />
          </div>

          <div className="border-t border-border pt-4">
            <p className="mb-3 text-sm font-medium">
              บัญชีรับโอน (ทางเลือกแทนบัตร — เว้นว่างไว้ถ้ายังไม่เปิดใช้)
            </p>
            <div className="grid gap-3">
              <div className="grid gap-1.5">
                <Label htmlFor="bankName">ธนาคาร</Label>
                <Input id="bankName" value={bankName} onChange={(e) => setBankName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bankAccountName">ชื่อบัญชี</Label>
                <Input
                  id="bankAccountName"
                  value={bankAccountName}
                  onChange={(e) => setBankAccountName(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="bankAccountNumber">เลขบัญชี</Label>
                <Input
                  id="bankAccountNumber"
                  value={bankAccountNumber}
                  onChange={(e) => setBankAccountNumber(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="qrFile">รูป QR สำหรับโอนเงิน (ถ้ามี)</Label>
                {qrCodeImage && (
                  // eslint-disable-next-line @next/next/no-img-element -- data URL, not a Next-optimizable remote asset
                  <img src={qrCodeImage} alt="QR ปัจจุบัน" className="h-40 w-40 rounded-md border border-border object-contain" />
                )}
                <Input
                  id="qrFile"
                  type="file"
                  accept="image/*"
                  onChange={(e) => handleQrFileChange(e.target.files?.[0] ?? null)}
                />
                {qrCodeImage && (
                  <button
                    type="button"
                    className="justify-self-start text-sm text-muted-foreground underline"
                    onClick={() => setQrCodeImage(null)}
                  >
                    ลบรูป QR
                  </button>
                )}
              </div>
            </div>
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
          {saved ? <p className="text-sm text-success">บันทึกแล้ว</p> : null}
          <Button type="submit" disabled={submitting}>
            {submitting ? "กำลังบันทึก..." : "บันทึก"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
