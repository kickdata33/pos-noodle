"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

type SlugStatus = "idle" | "checking" | "available" | "unavailable";

/**
 * Public shop-signup application (SaaS roadmap Phase 2) — "fill a form, we approve/create it",
 * not automated self-serve account creation (the user's explicit choice for this phase). Submits
 * to `/api/signup`, which only ever writes a `shopSignupRequests` doc for the superadmin console
 * to review at `/superadmin`.
 */
export default function SignupPage() {
  const [shopName, setShopName] = useState("");
  const [requestedSlug, setRequestedSlug] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [note, setNote] = useState("");
  const [website, setWebsite] = useState(""); // honeypot — never shown to a real visitor

  const [slugStatus, setSlugStatus] = useState<SlugStatus>("idle");
  const [slugReason, setSlugReason] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  function handleSlugChange(value: string) {
    setRequestedSlug(value);
    setSlugReason(null);
    setSlugStatus(value.trim() ? "checking" : "idle");
  }

  // Debounced live availability check — cosmetic only, the server re-checks authoritatively on
  // submit (and again at approval time), so a race here is harmless. The "idle"/"checking" resets
  // above happen synchronously in the change handler, not in this effect, so the effect only ever
  // calls setState from the async timeout callback below, never directly in its own body.
  const checkTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (checkTimer.current) clearTimeout(checkTimer.current);
    const slug = requestedSlug.trim().toLowerCase();
    if (!slug) return;

    checkTimer.current = setTimeout(async () => {
      try {
        const res = await fetch(`/api/signup/check-slug?slug=${encodeURIComponent(slug)}`);
        const data = (await res.json()) as { available: boolean; reason?: string };
        setSlugStatus(data.available ? "available" : "unavailable");
        setSlugReason(data.reason ?? null);
      } catch {
        setSlugStatus("idle");
      }
    }, 400);
    return () => {
      if (checkTimer.current) clearTimeout(checkTimer.current);
    };
  }, [requestedSlug]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/api/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shopName,
          requestedSlug: requestedSlug.trim().toLowerCase(),
          ownerName,
          phone,
          email,
          note,
          website,
        }),
      });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setError(data.error ?? "ส่งคำขอไม่สำเร็จ กรุณาลองใหม่");
        return;
      }
      setDone(true);
    } catch {
      setError("ส่งคำขอไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSubmitting(false);
    }
  }

  if (done) {
    return (
      <main className="mx-auto flex min-h-screen max-w-md items-center justify-center p-6">
        <Card>
          <CardHeader>
            <CardTitle>ส่งคำขอเรียบร้อยแล้ว</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <p className="text-muted-foreground">
              ทีมงานจะตรวจสอบและติดต่อกลับทางเบอร์โทรหรืออีเมลที่ให้ไว้ ภายใน 1-2 วันทำการ
            </p>
            <Button asChild variant="outline">
              <Link href="/">กลับหน้าหลัก</Link>
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-md p-6">
      <Card>
        <CardHeader>
          <CardTitle>สมัครใช้งานระบบ POS</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="shopName">ชื่อร้าน</Label>
              <Input id="shopName" required value={shopName} onChange={(e) => setShopName(e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="requestedSlug">ชื่อ URL ของร้าน</Label>
              <Input
                id="requestedSlug"
                required
                placeholder="เช่น champnoodles"
                value={requestedSlug}
                onChange={(e) => handleSlugChange(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                ใช้ตัวเล็ก a-z, 0-9 และขีดกลางเท่านั้น (3-40 ตัวอักษร) — จะเป็นที่อยู่เว็บของร้านคุณ
              </p>
              {slugStatus === "checking" ? (
                <p className="text-xs text-muted-foreground">กำลังตรวจสอบ...</p>
              ) : null}
              {slugStatus === "available" ? <p className="text-xs text-success">ใช้ได้</p> : null}
              {slugStatus === "unavailable" ? (
                <p className="text-xs text-destructive">{slugReason ?? "ไม่สามารถใช้ได้"}</p>
              ) : null}
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="ownerName">ชื่อผู้ติดต่อ</Label>
              <Input id="ownerName" required value={ownerName} onChange={(e) => setOwnerName(e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="phone">เบอร์โทร</Label>
              <Input
                id="phone"
                required
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="email">อีเมล (ไม่บังคับ)</Label>
              <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>

            <div className="grid gap-1.5">
              <Label htmlFor="note">ข้อความเพิ่มเติม (ไม่บังคับ)</Label>
              <Textarea id="note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>

            {/* Honeypot: hidden from real visitors via CSS + tabIndex, never via `type="hidden"`
                (some bots skip those specifically) — any bot filling every visible-looking input
                trips this. */}
            <div className="absolute -left-[9999px]" aria-hidden="true">
              <label htmlFor="website">Website</label>
              <input
                id="website"
                name="website"
                type="text"
                tabIndex={-1}
                autoComplete="off"
                value={website}
                onChange={(e) => setWebsite(e.target.value)}
              />
            </div>

            {error ? <p className="text-sm text-destructive">{error}</p> : null}

            <Button type="submit" disabled={submitting}>
              {submitting ? "กำลังส่ง..." : "ส่งคำขอ"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
