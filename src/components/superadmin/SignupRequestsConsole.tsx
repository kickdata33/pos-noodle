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
import type { ShopSignupRequest } from "@/types";

const STATUS_LABEL: Record<ShopSignupRequest["status"], string> = {
  pending: "รอตรวจสอบ",
  approved: "อนุมัติแล้ว",
  rejected: "ปฏิเสธแล้ว",
};

const STATUS_VARIANT: Record<ShopSignupRequest["status"], "default" | "success" | "muted"> = {
  pending: "default",
  approved: "success",
  rejected: "muted",
};

function randomPin(): string {
  return String(Math.floor(Math.random() * 1_000_000)).padStart(6, "0");
}

export function SignupRequestsConsole({ requests }: { requests: ShopSignupRequest[] }) {
  const router = useRouter();
  const [approving, setApproving] = useState<ShopSignupRequest | null>(null);
  const [finalSlug, setFinalSlug] = useState("");
  const [adminName, setAdminName] = useState("");
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<{ slug: string; adminName: string; pin: string } | null>(null);

  function openApprove(req: ShopSignupRequest) {
    setApproving(req);
    setFinalSlug(req.requestedSlug);
    setAdminName(req.ownerName);
    setPin(randomPin());
    setError(null);
    setSummary(null);
  }

  async function submitApprove() {
    if (!approving) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/superadmin/signup-requests/${approving.id}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finalSlug, adminName, pin }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string; slug?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "อนุมัติไม่สำเร็จ");
        return;
      }
      setSummary({ slug: data.slug ?? finalSlug, adminName, pin });
      router.refresh();
    } catch {
      setError("อนุมัติไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  async function reject(req: ShopSignupRequest) {
    const reason = window.prompt("เหตุผลที่ปฏิเสธ (ไม่บังคับ)") ?? "";
    await fetch(`/api/superadmin/signup-requests/${req.id}/reject`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason }),
    });
    router.refresh();
  }

  return (
    <div className="grid gap-4">
      {requests.map((req) => (
        <Card key={req.id}>
          <CardHeader>
            <div className="flex items-center justify-between gap-2">
              <CardTitle>{req.shopName}</CardTitle>
              <Badge variant={STATUS_VARIANT[req.status]}>{STATUS_LABEL[req.status]}</Badge>
            </div>
          </CardHeader>
          <CardContent className="grid gap-1 text-sm">
            <p>ชื่อ URL ที่ขอ: {req.requestedSlug}</p>
            <p>ผู้ติดต่อ: {req.ownerName}</p>
            <p>เบอร์โทร: {req.phone}</p>
            {req.email ? <p>อีเมล: {req.email}</p> : null}
            {req.note ? <p className="text-muted-foreground">หมายเหตุ: {req.note}</p> : null}
            <p className="text-muted-foreground">ส่งเมื่อ {new Date(req.createdAt).toLocaleString("th-TH")}</p>

            {req.status === "pending" ? (
              <div className="mt-3 flex gap-2">
                <Button size="sm" onClick={() => openApprove(req)}>
                  อนุมัติ
                </Button>
                <Button size="sm" variant="outline" onClick={() => reject(req)}>
                  ปฏิเสธ
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}

      {requests.length === 0 ? <p className="text-center text-muted-foreground">ยังไม่มีคำขอ</p> : null}

      <Dialog open={approving !== null} onOpenChange={(open) => !open && setApproving(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>อนุมัติร้าน: {approving?.shopName}</DialogTitle>
          </DialogHeader>

          {summary ? (
            <div className="grid gap-2 text-sm">
              <p>สร้างร้านสำเร็จ — ส่งข้อมูลนี้ให้เจ้าของร้าน:</p>
              <p>
                ลิงก์ร้าน: <strong>{summary.slug}</strong>.&lt;โดเมนของคุณ&gt;
              </p>
              <p>
                ชื่อแอดมิน: <strong>{summary.adminName}</strong>
              </p>
              <p>
                PIN เข้าใช้งาน: <strong>{summary.pin}</strong>
              </p>
            </div>
          ) : (
            <div className="grid gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="finalSlug">ชื่อ URL (แก้ไขได้ถ้าชื่อที่ขอถูกใช้ไปแล้ว)</Label>
                <Input id="finalSlug" value={finalSlug} onChange={(e) => setFinalSlug(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="adminName">ชื่อแอดมินคนแรก</Label>
                <Input id="adminName" value={adminName} onChange={(e) => setAdminName(e.target.value)} />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="pin">PIN 6 หลัก</Label>
                <div className="flex gap-2">
                  <Input id="pin" value={pin} onChange={(e) => setPin(e.target.value)} />
                  <Button type="button" variant="outline" onClick={() => setPin(randomPin())}>
                    สุ่ม
                  </Button>
                </div>
              </div>
              {error ? <p className="text-sm text-destructive">{error}</p> : null}
            </div>
          )}

          <DialogFooter>
            {summary ? (
              <Button onClick={() => setApproving(null)}>ปิด</Button>
            ) : (
              <Button onClick={submitApprove} disabled={submitting}>
                {submitting ? "กำลังสร้าง..." : "ยืนยันอนุมัติ"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
