"use client";

import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

import { usePosCatalog } from "@/components/pos/PosCatalogContext";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { formatTime } from "@/lib/format";
import { notifyServeCall } from "@/lib/pos/pushClient";
import {
  audioReady,
  holdScreenAwake,
  isServeCallsEnabled,
  ringOnce,
  SERVE_CALLS_TOGGLE_EVENT,
  stopVibration,
  unlockAudio,
  vibrateOnce,
} from "@/lib/pos/serveCallAlarm";
import { serveCallRepository } from "@/repositories/serveCallRepository";
import type { ServeCall } from "@/types";

const RING_EVERY_MS = 2500;

/**
 * Staff phone alarm for the kitchen's "เรียกเสิร์ฟ" (mounted once in the /pos layout). On devices
 * that turned on "รับเรียกเสิร์ฟ" (PosHome), any unacknowledged call takes over the screen and
 * rings + vibrates every 2.5 s until someone taps "รับทราบ" — on any phone; then every phone
 * stops. Never on the kitchen screen or the print station page.
 */
export function ServeCallAlert() {
  const { shopId } = usePosCatalog();
  const { appUser } = useAuth();
  const pathname = usePathname() ?? "";
  const [enabled, setEnabled] = useState(false);
  const [calls, setCalls] = useState<ServeCall[]>([]);
  const [soundBlocked, setSoundBlocked] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [ackError, setAckError] = useState<string | null>(null);

  // Device switch lives in localStorage; follow changes made on PosHome.
  useEffect(() => {
    const read = () => setEnabled(isServeCallsEnabled());
    read();
    window.addEventListener(SERVE_CALLS_TOGGLE_EVENT, read);
    // Any tap re-arms sound after a reload (browsers need a gesture before playing audio).
    const onTap = () => unlockAudio();
    window.addEventListener("pointerdown", onTap);
    return () => {
      window.removeEventListener(SERVE_CALLS_TOGGLE_EVENT, read);
      window.removeEventListener("pointerdown", onTap);
    };
  }, []);

  useEffect(() => {
    if (!enabled) return;
    return serveCallRepository.subscribeOpen(shopId, setCalls);
  }, [enabled, shopId]);

  // Keep the screen on while this device is listening, so the POS stays in front and can ring.
  useEffect(() => {
    if (!enabled) return;
    let release: () => void = () => {};
    const acquire = async () => {
      if (document.visibilityState === "visible") {
        release();
        release = await holdScreenAwake();
      }
    };
    void acquire();
    document.addEventListener("visibilitychange", acquire);
    return () => {
      document.removeEventListener("visibilitychange", acquire);
      release();
    };
  }, [enabled]);

  const excludedPage = pathname.startsWith("/pos/kitchen") || pathname.startsWith("/pos/print-station");
  const ringing = enabled && !excludedPage && calls.length > 0;

  useEffect(() => {
    if (!ringing) return;
    const ring = () => {
      ringOnce();
      vibrateOnce();
      setSoundBlocked(!audioReady());
    };
    ring();
    const timer = setInterval(ring, RING_EVERY_MS);
    return () => {
      clearInterval(timer);
      stopVibration();
    };
  }, [ringing]);

  if (!ringing) return null;

  // A failed acknowledge must never fail silently — the alarm would just keep ringing with no
  // explanation (reported on iPhone). Show why, and offer "รับทราบทั้งหมด" when calls pile up.
  async function acknowledge(calls: ServeCall[]) {
    if (!appUser) {
      setAckError("ยังโหลดบัญชีผู้ใช้ไม่เสร็จ รอ 2–3 วินาทีแล้วกดใหม่ ถ้ายังไม่ได้ให้ปิดแล้วเปิดแอปใหม่");
      return;
    }
    setBusyId(calls.length === 1 ? calls[0].id : "all");
    setAckError(null);
    try {
      for (const call of calls) {
        const won = await serveCallRepository.acknowledge(call.id, appUser);
        // Replace the lock-screen alert on every phone with a quiet "มีคนรับแล้ว".
        if (won) notifyServeCall(call.id, "done");
      }
    } catch (err) {
      console.error("acknowledge serve call failed", err);
      setAckError("กดรับทราบไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วกดใหม่");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex flex-col gap-4 overflow-y-auto bg-amber-500 p-5 text-white"
      role="alertdialog"
      aria-live="assertive"
      onPointerDown={() => unlockAudio()}
    >
      <p className="text-center text-2xl font-bold">
        🔔 อาหารพร้อมเสิร์ฟ{calls.length > 1 ? ` (${calls.length} โต๊ะ)` : ""}
      </p>
      {ackError ? <p className="rounded-lg bg-white p-3 text-center text-sm font-semibold text-destructive">{ackError}</p> : null}
      {calls.length > 1 ? (
        <Button
          variant="outline"
          className="h-12 w-full border-white bg-white/15 text-base font-bold text-white hover:bg-white/25"
          disabled={busyId !== null}
          onClick={() => acknowledge(calls)}
        >
          {busyId === "all" ? "กำลังบันทึก..." : `รับทราบทั้งหมด ${calls.length} รายการ`}
        </Button>
      ) : null}
      {soundBlocked ? (
        <p className="rounded-lg bg-white/20 p-2 text-center text-sm">แตะหน้าจอ 1 ครั้งเพื่อเปิดเสียง</p>
      ) : null}
      {calls.map((call) => (
        <div key={call.id} className="rounded-2xl bg-white p-4 text-foreground shadow-lg">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-3xl font-bold">{call.label}</p>
            <p className="text-sm text-muted-foreground">{formatTime(call.createdAt)}</p>
          </div>
          <ul className="mt-2 text-lg">
            {call.items.map((it, i) => (
              <li key={i}>
                {it.quantity}× {it.name}
              </li>
            ))}
          </ul>
          <Button
            className="mt-4 h-14 w-full text-lg font-bold"
            disabled={busyId === call.id}
            onClick={() => acknowledge([call])}
          >
            {busyId === call.id ? "กำลังบันทึก..." : "รับทราบ ไปเสิร์ฟ"}
          </Button>
        </div>
      ))}
    </div>
  );
}
