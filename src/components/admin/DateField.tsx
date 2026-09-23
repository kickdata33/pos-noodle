"use client";

import { useRef } from "react";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/**
 * A date `<Input>` with an explicit "📅" button that opens the native calendar picker
 * (`input.showPicker()`) — added because a bare `type="date"` input reads, on a lot of desktop
 * browsers/screen widths, as "type the date in" rather than "click to pick a date", which is
 * exactly the confusion the user hit. Typing the date is still possible (that's the browser's
 * own native behavior, not something this page can safely block without also blocking the
 * picker on some browsers), but now there's an unmistakable button for the point-and-click path.
 * Shared between `/admin/accounting` (where this was first built) and `/admin/orders`.
 */
export function DateField({
  value,
  onChange,
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = inputRef.current;
    if (!el) return;
    if ("showPicker" in el && typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        // Some browsers throw if the call isn't user-gesture-adjacent enough — fall through to focus().
      }
    }
    el.focus();
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={inputRef}
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        // Android's native date-input calendar icon (`::-webkit-calendar-picker-indicator`) draws
        // itself at the same right-edge spot as our own 📅 button below, regardless of `pr-9` —
        // on some devices (MIUI/Samsung) it even renders its own mini month/day badge, not just a
        // plain icon, so the two visibly overlapped ("วันที่ ยังทับกันอยู่"). We already provide our
        // own trigger (openPicker/showPicker), so hide the native one instead of fighting it.
        className="h-full w-full pr-9 [&::-webkit-calendar-picker-indicator]:hidden"
      />
      <button
        type="button"
        onClick={openPicker}
        aria-label="เลือกวันที่"
        className="absolute inset-y-0 right-1 flex w-8 items-center justify-center text-base text-muted-foreground"
      >
        📅
      </button>
    </div>
  );
}
