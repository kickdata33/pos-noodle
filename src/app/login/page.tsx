"use client";

import { signInWithCustomToken, signOut } from "firebase/auth";
import { Delete } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { auth } from "@/lib/firebase/client";
import { PIN_LENGTH } from "@/lib/auth/pinConstants";
import { cn } from "@/lib/utils";

/**
 * PIN keypad login (item 26: big buttons, minimal typing, usable by staff who aren't
 * comfortable with technology). The PIN alone identifies the user — there's no name to pick
 * first — so the whole sign-in is: tap 6 digits.
 *
 * Verification happens server-side in /api/auth/pin; this component never sees a hash and
 * never decides whether a PIN is valid.
 */
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9"];

export default function LoginPage() {
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(candidate: string) {
    setSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/auth/pin", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: candidate }),
      });

      const data = (await response.json()) as {
        customToken?: string;
        role?: "admin" | "staff";
        error?: string;
      };

      if (!response.ok || !data.customToken) {
        setError(data.error ?? "เข้าสู่ระบบไม่สำเร็จ");
        setPin("");
        return;
      }

      const credential = await signInWithCustomToken(auth, data.customToken);
      const idToken = await credential.user.getIdToken();

      const sessionResponse = await fetch("/api/auth/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      });

      if (!sessionResponse.ok) {
        await signOut(auth);
        setError("เข้าสู่ระบบไม่สำเร็จ กรุณาลองใหม่");
        setPin("");
        return;
      }

      router.push(data.role === "admin" ? "/admin" : "/pos");
      router.refresh();
    } catch {
      setError("เชื่อมต่อไม่ได้ กรุณาลองใหม่");
      setPin("");
    } finally {
      setSubmitting(false);
    }
  }

  function press(digit: string) {
    if (submitting || pin.length >= PIN_LENGTH) return;
    setError(null);

    const next = pin + digit;
    setPin(next);

    // Submit as soon as the last digit lands — one less button for staff to find. Done here
    // rather than in an effect so the submit is a direct consequence of the tap.
    if (next.length === PIN_LENGTH) void handleSubmit(next);
  }

  function backspace() {
    if (submitting) return;
    setError(null);
    setPin((current) => current.slice(0, -1));
  }

  return (
    <main className="flex flex-1 items-center justify-center bg-muted p-4">
      <div className="w-full max-w-xs">
        <h1 className="text-center text-2xl font-semibold">ใส่รหัส PIN</h1>

        <div className="mt-8 flex justify-center gap-3" aria-live="polite">
          {Array.from({ length: PIN_LENGTH }).map((_, index) => (
            <span
              key={index}
              className={cn(
                "h-4 w-4 rounded-full border-2 transition-colors",
                index < pin.length ? "border-primary bg-primary" : "border-border bg-transparent"
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
          {error ?? (submitting ? "กำลังเข้าสู่ระบบ..." : "")}
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
            disabled={submitting || pin.length === 0}
            aria-label="ลบ"
          >
            <Delete className="size-7" />
          </Button>
        </div>
      </div>
    </main>
  );
}
