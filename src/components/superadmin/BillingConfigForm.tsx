"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BillingConfig } from "@/types";

export function BillingConfigForm({ config }: { config: BillingConfig }) {
  const router = useRouter();
  const [trialDays, setTrialDays] = useState(String(config.trialDays));
  const [monthlyPriceThb, setMonthlyPriceThb] = useState(String(config.monthlyPriceThb));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/superadmin/billing-config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trialDays: Number(trialDays), monthlyPriceThb: Number(monthlyPriceThb) }),
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
