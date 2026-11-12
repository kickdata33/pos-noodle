"use client";

import { useEffect, useState } from "react";

import { currentPushState, disablePush, enablePush, type PushState } from "@/lib/pos/pushClient";
import {
  isServeCallsEnabled,
  ringOnce,
  SERVE_CALLS_TOGGLE_EVENT,
  setServeCallsEnabled,
  unlockAudio,
  vibrateOnce,
} from "@/lib/pos/serveCallAlarm";

const PUSH_NOTE: Record<PushState, string> = {
  on: "แจ้งเตือนแม้ล็อกจอ: เปิด",
  off: "แจ้งเตือนแม้ล็อกจอ: ปิด (กดเปิดอีกครั้งเพื่ออนุญาต)",
  denied: "แจ้งเตือนแม้ล็อกจอ: ถูกปิดไว้ — เปิดสิทธิ์การแจ้งเตือนของเว็บนี้ในตั้งค่าเบราว์เซอร์",
  needsHomeScreen: "แจ้งเตือนแม้ล็อกจอบน iPhone/iPad: ต้องเพิ่มไปยังหน้าจอโฮมแล้วเปิดจากไอคอนนั้น",
  unsupported: "เบราว์เซอร์นี้ส่งแจ้งเตือนตอนล็อกจอไม่ได้ (ดังเฉพาะตอนเปิดหน้านี้)",
  notConfigured: "",
};

/**
 * Per-device switch for the kitchen's "เรียกเสิร์ฟ" alarm. On: the in-app full-screen alarm
 * (ServeCallAlert) plus, where the phone supports it, lock-screen notifications (Web Push). Staff
 * turn it on on their own phones; the kitchen tablet and cashier PC leave it off. The tap also
 * unlocks sound and asks for notification permission, then plays one ring as a sample.
 */
export function ServeCallToggle() {
  const [on, setOn] = useState(false);
  const [push, setPush] = useState<PushState>("notConfigured");
  const [busy, setBusy] = useState(false);
  const [testNote, setTestNote] = useState<string | null>(null);

  // Lock-screen test: the server waits ~6 s, so staff can lock the phone and see whether the
  // notification arrives. The answer from Apple/Google is kept for when they unlock.
  async function sendTest() {
    setTestNote("กำลังส่ง... ควรมีแจ้งเตือน “ทดสอบแจ้งเตือน” เด้งภายในไม่กี่วินาที");
    try {
      const res = await fetch("/api/push/test", { method: "POST" });
      const data = (await res.json()) as { results?: { host: string; ok: boolean; status: number | null; detail: string }[]; error?: string };
      if (!res.ok) {
        setTestNote(`ส่งไม่ได้: ${data.error ?? res.status}`);
        return;
      }
      const results = data.results ?? [];
      setTestNote(
        results.length === 0
          ? "ไม่พบการลงทะเบียนของเครื่องนี้ ลองปิดแล้วเปิดปุ่มรับเรียกเสิร์ฟใหม่"
          : results
              .map((r) => (r.ok ? `✓ ${r.host}: ${r.detail}` : `✗ ${r.host} (${r.status ?? "-"}): ${r.detail}`))
              .join(" · ")
      );
    } catch {
      setTestNote("ส่งไม่ได้ ตรวจอินเทอร์เน็ต");
    }
  }

  useEffect(() => {
    const read = () => setOn(isServeCallsEnabled());
    read();
    window.addEventListener(SERVE_CALLS_TOGGLE_EVENT, read);
    currentPushState()
      .then(setPush)
      .catch(() => setPush("unsupported"));
    return () => window.removeEventListener(SERVE_CALLS_TOGGLE_EVENT, read);
  }, []);

  async function toggle() {
    const next = !on;
    setBusy(true);
    try {
      if (next) {
        unlockAudio();
        setTimeout(() => {
          ringOnce();
          vibrateOnce();
        }, 150);
        setServeCallsEnabled(true);
        setPush(await enablePush().catch(() => "unsupported" as PushState));
      } else {
        setServeCallsEnabled(false);
        await disablePush().catch(() => undefined);
        setPush(await currentPushState().catch(() => "unsupported" as PushState));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        className={
          "self-start rounded-full border px-3 py-1 text-sm font-medium " +
          (on
            ? "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100"
            : "border-border text-muted-foreground")
        }
        aria-pressed={on}
      >
        🔔 รับเรียกเสิร์ฟบนเครื่องนี้: {on ? "เปิด" : "ปิด"}
      </button>
      {on && PUSH_NOTE[push] ? <p className="text-xs text-muted-foreground">{PUSH_NOTE[push]}</p> : null}
      {on && push === "on" ? (
        <button
          type="button"
          onClick={sendTest}
          className="self-start text-xs font-medium text-primary underline underline-offset-2"
        >
          ส่งแจ้งเตือนทดสอบ
        </button>
      ) : null}
      {testNote ? <p className="max-w-md break-words text-xs text-muted-foreground">{testNote}</p> : null}
    </div>
  );
}
