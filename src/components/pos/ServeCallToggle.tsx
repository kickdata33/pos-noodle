"use client";

import { useEffect, useState } from "react";

import {
  isServeCallsEnabled,
  ringOnce,
  SERVE_CALLS_TOGGLE_EVENT,
  setServeCallsEnabled,
  unlockAudio,
  vibrateOnce,
} from "@/lib/pos/serveCallAlarm";

/**
 * Per-device switch for the kitchen's "เรียกเสิร์ฟ" alarm (ServeCallAlert). Staff turn it on on
 * their own phones; the kitchen tablet and the cashier PC leave it off. Turning it on is also the
 * tap that unlocks sound on iPhone, and it plays one ring so staff hear what to listen for.
 */
export function ServeCallToggle() {
  const [on, setOn] = useState(false);
  useEffect(() => {
    const read = () => setOn(isServeCallsEnabled());
    read();
    window.addEventListener(SERVE_CALLS_TOGGLE_EVENT, read);
    return () => window.removeEventListener(SERVE_CALLS_TOGGLE_EVENT, read);
  }, []);

  function toggle() {
    const next = !on;
    if (next) {
      unlockAudio();
      // give the AudioContext a moment to start after resume()
      setTimeout(() => {
        ringOnce();
        vibrateOnce();
      }, 150);
    }
    setServeCallsEnabled(next);
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={
        "rounded-full border px-3 py-1 text-sm font-medium " +
        (on ? "border-amber-500 bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-100" : "border-border text-muted-foreground")
      }
      aria-pressed={on}
    >
      🔔 รับเรียกเสิร์ฟบนเครื่องนี้: {on ? "เปิด" : "ปิด"}
    </button>
  );
}
