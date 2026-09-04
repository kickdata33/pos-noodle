"use client";

import { useState } from "react";

import type { DailySales } from "@/lib/pos/reports";
import { formatCurrency } from "@/lib/format";

/**
 * Vertical bar chart, one bar per calendar day in the selected range — the "รายวันไหนถึงวันไหน"
 * trend. Single hue (magnitude, not identity — see BarList). A tap/hover on a bar shows its
 * exact value directly rather than a floating tooltip layer, which keeps this usable on the
 * tablet-sized screens Admin is sometimes opened on without extra positioning logic.
 */
export function DailyTrendChart({ days, currency }: { days: DailySales[]; currency: string }) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  if (days.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">ไม่มีข้อมูลในช่วงเวลานี้</p>;
  }

  const max = Math.max(...days.map((d) => d.revenue), 1);
  const active = activeIndex !== null ? days[activeIndex] : null;
  const showEveryLabel = days.length <= 9;

  return (
    <div>
      <p className="mb-2 min-h-5 text-sm text-muted-foreground">
        {active
          ? `${formatDayLabel(active.dateKey, true)} — ${formatCurrency(active.revenue, currency)} (${active.orderCount} บิล)`
          : "แตะแท่งกราฟเพื่อดูยอดของวันนั้น"}
      </p>
      <div className="flex h-40 items-end gap-1 border-b border-border">
        {days.map((day, index) => {
          const heightPct = Math.max((day.revenue / max) * 100, day.revenue > 0 ? 3 : 1);
          return (
            <button
              key={day.dateKey}
              type="button"
              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1"
              onClick={() => setActiveIndex(index === activeIndex ? null : index)}
              aria-label={`${formatDayLabel(day.dateKey, true)}: ${formatCurrency(day.revenue, currency)}`}
            >
              <div
                className="w-full rounded-t-sm transition-opacity group-hover:opacity-80"
                style={{
                  height: `${heightPct}%`,
                  backgroundColor: "var(--report-bar)",
                  opacity: activeIndex === null || activeIndex === index ? 1 : 0.4,
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-1 text-[10px] text-muted-foreground">
        {days.map((day, index) => (
          <div key={day.dateKey} className="min-w-0 flex-1 truncate text-center">
            {showEveryLabel || index === 0 || index === days.length - 1 || index % Math.ceil(days.length / 6) === 0
              ? formatDayLabel(day.dateKey, false)
              : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatDayLabel(dateKey: string, long: boolean): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  // Constructed as a UTC instant matching the Bangkok calendar date — only the date fields are
  // used for display, so no timezone conversion is needed here (unlike lib/pos/dateRange.ts,
  // which does real epoch-ms math).
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: long ? "numeric" : undefined,
    timeZone: "UTC",
  });
}
