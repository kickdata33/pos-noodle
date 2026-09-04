/**
 * Horizontal bar list — used for "สินค้าขายดี", sales by channel, and sales by payment method.
 * One measure per category (not multiple series needing distinct hues), so per dataviz's
 * sequential-encoding rule this stays a single hue throughout — see `references/color-formula.md`.
 * Every bar carries its own visible label + value (never color-only identity), so no legend.
 */
interface BarListRow {
  key: string;
  label: string;
  value: number;
  /** Shown next to the value, e.g. "ชิ้น" or a secondary figure like order count. */
  detail?: string;
}

export function BarList({
  rows,
  formatValue,
  emptyLabel = "ไม่มีข้อมูลในช่วงเวลานี้",
}: {
  rows: BarListRow[];
  formatValue: (value: number) => string;
  emptyLabel?: string;
}) {
  if (rows.length === 0) {
    return <p className="py-6 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }

  const max = Math.max(...rows.map((r) => r.value), 1);

  return (
    <ul className="flex flex-col gap-3">
      {rows.map((row) => (
        <li key={row.key} className="flex flex-col gap-1">
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="min-w-0 truncate font-medium">{row.label}</span>
            <span className="shrink-0 tabular-nums text-muted-foreground">
              {formatValue(row.value)}
              {row.detail ? <span className="ml-1">({row.detail})</span> : null}
            </span>
          </div>
          <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((row.value / max) * 100, row.value > 0 ? 2 : 0)}%`,
                backgroundColor: "var(--report-bar)",
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}
