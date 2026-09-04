"use client";

import { useState } from "react";

import type { HourlySales } from "@/lib/pos/reports";

/**
 * 24-bar chart, one bar per Bangkok hour of day — answers "ช่วงเวลาไหนคนกินเยอะ". Bar height is
 * bill count ("คนเยอะ" reads as more bills, not necessarily higher-value ones); revenue for that
 * hour is shown on tap, same interaction pattern as `DailyTrendChart`.
 */
export function HourlyChart({ hours }: { hours: HourlySales[] }) {
  const [activeHour, setActiveHour] = useState<number | null>(null);

  const max = Math.max(...hours.map((h) => h.orderCount), 1);
  const active = activeHour !== null ? hours[activeHour] : null;
  const busiest = hours.reduce((best, h) => (h.orderCount > best.orderCount ? h : best), hours[0]);

  return (
    <div>
      <p className="mb-2 min-h-5 text-sm text-muted-foreground">
        {active
          ? `${formatHour(active.hour)} — ${active.orderCount} บิล`
          : busiest.orderCount > 0
            ? `ช่วงคนเยอะที่สุด: ${formatHour(busiest.hour)} (${busiest.orderCount} บิล)`
            : "ไม่มีข้อมูลในช่วงเวลานี้"}
      </p>
      <div className="flex h-32 items-end gap-0.5 border-b border-border">
        {hours.map((h) => {
          const heightPct = Math.max((h.orderCount / max) * 100, h.orderCount > 0 ? 4 : 1);
          return (
            <button
              key={h.hour}
              type="button"
              className="group flex h-full min-w-0 flex-1 flex-col items-center justify-end"
              onClick={() => setActiveHour(h.hour === activeHour ? null : h.hour)}
              aria-label={`${formatHour(h.hour)}: ${h.orderCount} บิล`}
            >
              <div
                className="w-full rounded-t-sm transition-opacity group-hover:opacity-80"
                style={{
                  height: `${heightPct}%`,
                  backgroundColor: "var(--report-bar)",
                  opacity: activeHour === null || activeHour === h.hour ? 1 : 0.4,
                }}
              />
            </button>
          );
        })}
      </div>
      <div className="mt-1 flex gap-0.5 text-[10px] text-muted-foreground">
        {hours.map((h) => (
          <div key={h.hour} className="min-w-0 flex-1 text-center">
            {h.hour % 3 === 0 ? h.hour : ""}
          </div>
        ))}
      </div>
    </div>
  );
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, "0")}:00–${String((hour + 1) % 24).padStart(2, "0")}:00`;
}
