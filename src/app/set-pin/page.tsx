"use client";

import { Delete } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Button } from "@/components/ui/button";
import { PIN_LENGTH } from "@/lib/auth/pinConstants";
import { resolveRedirect } from "@/lib/auth/redirect";
import { cn } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

/**
 * Forced first step after logging in with a temporary PIN (`AppUser.mustChangePin` — see that
 * field's comment, and `/api/auth/set-pin`). Same big-keypad shape as `/login` on purpose, for
 * staff who just came straight from that screen, but asks for the new PIN twice: typing a
 * 6-digit PIN once with no way to see it again is an easy typo to make permanent.
 *
 * Reached only by someone who already has a valid session from the temporary PIN — this page
 * itself has no gate, but a `useAuth()`-less direct hit from a signed-out browser just gets a
 * 401 from `/api/auth/set-pin` and an error message, never a crash.
 */
function SetPinPageInner() {
  const router = useRouter();
  const params = useSearchParams();
  const role = params.get("role") === "admin" ? "admin" : "staff";
  const next = params.get("next");

  const [step, setStep] = useState<"enter" | "confirm">("enter");
  const [pin, setPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = step === "enter" ? pin : confirmPin;

  async function finish(firstPin: string, secondPin: string) {
    if (firstPin !== secondPin) {
      setError("รหัส PIN ที่ยืนยันไม่ตรงกัน ลองใหม่อีกครั้ง");
      setStep("enter");
      setPin("");
      setConfirmPin("");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/set-pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: firstPin }),
      });
      const data = (await response.json()) as { error?: string; allowedPosPages?: string[] | null };
      if (!response.ok) {
        setError(data.error ?? "ตั้ง PIN ไม่สำเร็จ");
        setStep("enter");
        setPin("");
        setConfirmPin("");
        return;
      }
      router.push(resolveRedirect(next, role, data.allowedPosPages));
      router.refresh();
    } catch {
      setError("เชื่อมต่อไม่ได้ กรุณาลองใหม่");
      setStep("enter");
      setPin("");
      setConfirmPin("");
    } finally {
      setSubmitting(false);
    }
  }

  function press(digit: string) {
    if (submitting || current.length >= PIN_LENGTH) return;
    setError(null);
    const value = current + digit;

    if (step === "enter") {
      setPin(value);
      if (value.length === PIN_LENGTH) setStep("confirm");
    } else {
      setConfirmPin(value);
      if (value.length === PIN_LENGTH) void finish(pin, value);
    }
  }

  function backspace() {
    if (submitting) return;
    setError(null);
    if (step === "enter") setPin((p) => p.slice(0, -1));
    else setConfirmPin((p) => p.slice(0, -1));
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-muted p-4">
      <div className="w-full max-w-xs">
        <h1 className="text-center text-2xl font-semibold">
          {step === "enter" ? "ตั้งรหัส PIN ของตัวเอง" : "ยืนยันรหัส PIN อีกครั้ง"}
        </h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          {step === "enter"
            ? "PIN ที่แอดมินให้มาเป็นแค่ PIN ชั่วคราว — ตั้งรหัสใหม่ 6 หลักที่เฉพาะคุณรู้"
            : "พิมพ์ PIN เดิมอีกครั้งเพื่อยืนยัน"}
        </p>

        <div className="mt-8 flex justify-center gap-3" aria-live="polite">
          {Array.from({ length: PIN_LENGTH }).map((_, index) => (
            <span
              key={index}
              className={cn(
                "h-4 w-4 rounded-full border-2 transition-colors",
                index < current.length ? "border-primary bg-primary" : "border-border bg-transparent"
              )}
            />
          ))}
        </div>

        <p
          className={cn(
            "mt-4 min-h-10 text-center text-sm",
            error ? "text-destructive" : "text-muted-foreground"
          )}
        >
          {error ?? (submitting ? "กำลังบันทึก..." : "")}
        </p>

        <div className="mt-2 grid grid-cols-3 gap-3">
          {KEYS.map((key) => (
            <Button
              key={key}
              variant="outline"
              size="lg"
              className="h-20 text-2xl font-semibold"
              onClick={() => press(key)}
              disabled={submitting}
            >
              {key}
            </Button>
          ))}

          <div aria-hidden />

          <Button
            variant="outline"
            size="lg"
            className="h-20 text-2xl font-semibold"
            onClick={() => press("0")}
            disabled={submitting}
          >
            0
          </Button>

          <Button
            variant="ghost"
            size="lg"
            className="h-20"
            onClick={backspace}
            disabled={submitting || current.length === 0}
            aria-label="ลบ"
          >
            <Delete className="size-7" />
          </Button>
        </div>
      </div>
    </main>
  );
}

// `useSearchParams` requires a Suspense boundary, same as `/login`.
export default function SetPinPage() {
  return (
    <Suspense fallback={null}>
      <SetPinPageInner />
    </Suspense>
  );
}
