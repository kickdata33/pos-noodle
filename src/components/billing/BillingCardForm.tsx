"use client";

import Script from "next/script";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Minimal shape of the global `Omise` object Omise.js attaches to `window` — just enough for
 * `setPublicKey`/`createToken`, the two calls this form makes. Omise.js has no published
 * TypeScript types, so this is hand-declared rather than `any`-typed throughout.
 */
interface OmiseTokenResponse {
  id: string;
}
interface OmiseGlobal {
  setPublicKey: (key: string) => void;
  createToken: (
    type: "card",
    card: { name: string; number: string; expiration_month: number; expiration_year: number; security_code: string },
    callback: (statusCode: number, response: OmiseTokenResponse | { message: string }) => void
  ) => void;
}
declare global {
  interface Window {
    Omise?: OmiseGlobal;
  }
}

/**
 * Card-entry form for a shop's own subscription (SaaS roadmap Phase 3) — the shop's admin
 * enters their own card here, not something the superadmin collects on their behalf. Tokenizes
 * the card entirely client-side via Omise.js (first external client script in this app, loaded
 * with Next's built-in `<Script>`, no new dependency): raw card data never reaches our server,
 * only the resulting `tokn_...` id does, which `/api/billing/card` exchanges for an Omise
 * customer/card server-side.
 */
export function BillingCardForm({ onSaved }: { onSaved: () => void }) {
  const [scriptReady, setScriptReady] = useState(false);
  const [name, setName] = useState("");
  const [number, setNumber] = useState("");
  const [expMonth, setExpMonth] = useState("");
  const [expYear, setExpYear] = useState("");
  const [cvc, setCvc] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!window.Omise) {
      setError("ระบบชำระเงินยังโหลดไม่เสร็จ กรุณาลองใหม่อีกครั้ง");
      return;
    }
    const publicKey = process.env.NEXT_PUBLIC_OMISE_PUBLIC_KEY;
    if (!publicKey) {
      setError("ระบบยังไม่ได้ตั้งค่าการชำระเงิน (NEXT_PUBLIC_OMISE_PUBLIC_KEY)");
      return;
    }

    setSubmitting(true);
    window.Omise.setPublicKey(publicKey);
    window.Omise.createToken(
      "card",
      {
        name,
        number: number.replace(/\s+/g, ""),
        expiration_month: Number(expMonth),
        expiration_year: Number(expYear),
        security_code: cvc,
      },
      async (statusCode, response) => {
        if (statusCode !== 200 || !("id" in response)) {
          setError("message" in response ? response.message : "บัตรไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง");
          setSubmitting(false);
          return;
        }
        try {
          const res = await fetch("/api/billing/card", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ omiseToken: response.id }),
          });
          const data = (await res.json()) as { ok?: boolean; error?: string };
          if (!res.ok || !data.ok) {
            setError(data.error ?? "บันทึกบัตรไม่สำเร็จ กรุณาลองใหม่");
            return;
          }
          onSaved();
        } catch {
          setError("บันทึกบัตรไม่สำเร็จ กรุณาลองใหม่");
        } finally {
          setSubmitting(false);
        }
      }
    );
  }

  return (
    <>
      <Script src="https://cdn.omise.co/omise.js" strategy="afterInteractive" onReady={() => setScriptReady(true)} />
      <Card>
        <CardHeader>
          <CardTitle>ข้อมูลบัตรเครดิต/เดบิต</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4" onSubmit={handleSubmit}>
            <div className="grid gap-1.5">
              <Label htmlFor="cardName">ชื่อบนบัตร</Label>
              <Input id="cardName" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="cardNumber">หมายเลขบัตร</Label>
              <Input
                id="cardNumber"
                required
                inputMode="numeric"
                placeholder="4242 4242 4242 4242"
                value={number}
                onChange={(e) => setNumber(e.target.value)}
              />
            </div>
            <div className="grid grid-cols-3 gap-4">
              <div className="grid gap-1.5">
                <Label htmlFor="expMonth">เดือนหมดอายุ</Label>
                <Input
                  id="expMonth"
                  required
                  inputMode="numeric"
                  placeholder="MM"
                  value={expMonth}
                  onChange={(e) => setExpMonth(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="expYear">ปีหมดอายุ</Label>
                <Input
                  id="expYear"
                  required
                  inputMode="numeric"
                  placeholder="YYYY"
                  value={expYear}
                  onChange={(e) => setExpYear(e.target.value)}
                />
              </div>
              <div className="grid gap-1.5">
                <Label htmlFor="cvc">CVC</Label>
                <Input id="cvc" required inputMode="numeric" value={cvc} onChange={(e) => setCvc(e.target.value)} />
              </div>
            </div>
            {error ? <p className="text-sm text-destructive">{error}</p> : null}
            <Button type="submit" disabled={submitting || !scriptReady}>
              {submitting ? "กำลังบันทึก..." : "บันทึกบัตร"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </>
  );
}
