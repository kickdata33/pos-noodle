"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ServeCallToggle } from "@/components/pos/ServeCallToggle";
import { TableQrDialog } from "@/components/shared/TableQrDialog";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { usePosLockRedirect } from "@/hooks/usePosLockRedirect";
import { formatCurrency, formatTime } from "@/lib/format";
import { canSeePosPage, POS_SECONDARY_PAGES } from "@/lib/pos/posPages";
import { isLowStock } from "@/lib/pos/stock";
import { printQrForTable } from "@/lib/pos/tableQrPrint";
import { orderRepository } from "@/repositories/orderRepository";
import { stockLevelRepository } from "@/repositories/stockRepository";
import type { Order, StockLevel, Table as PosTable } from "@/types";

import { usePosCatalog } from "./PosCatalogContext";
import { tableLabel } from "@/lib/tableLabel";

/**
 * POS home (item 5): the table grid plus the big non-table channel buttons. A table's
 * occupied/free state and running total are derived by joining the live open-orders list
 * against tables/channels client-side — `Table` itself carries no status field (see
 * Milestone 3 plan: "table occupancy is derived, not stored").
 */
/** A "รอสั่ง" mark older than this is treated as forgotten (customer left, nobody cleared it). */
const SEATED_MAX_MS = 3 * 60 * 60 * 1000;

export function PosHome() {
  const { shopId, tables, channels, settings } = usePosCatalog();
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  // Item: "ลูกค้าแอบถ่ายรูป QR แล้วสั่งทีหลังได้ไหม" — lets staff (re)print a `qrMode: "session"`
  // table's one-time QR right from the floor grid, not just `/admin/tables`, since seating a new
  // party is a staff task that happens constantly, not an admin config chore. See
  // `TableQrDialog`'s own comment for how it branches on `qrMode`.
  const [qrTable, setQrTable] = useState<PosTable | null>(null);
  const { appUser } = useAuth();
  // A staff account locked to exactly one secondary page (see `usePosLockRedirect`'s comment —
  // e.g. a dedicated kitchen tablet) never actually sees this table grid; it's bounced to its
  // one page instead. Hook call stays unconditional up here with the others; the actual bail-out
  // happens below, after every other hook in this component has run.
  const lockedPage = usePosLockRedirect();
  // One-tap "พิมพ์ QR" on each table card (item: "ต้องสร้างแล้วปริ้นให้ลูกค้าได้ก่อน") — works on an
  // empty table, so staff can seat a party and hand them the QR before anything is ordered; the
  // customer's first order opens the bill. Only in shops that switched it on.
  const qrPrintEnabled = Boolean(settings?.printStation?.tableQrEnabled);
  const [qrPrintState, setQrPrintState] = useState<Record<string, "sending" | "sent" | "error">>({});
  // Clock for "รอสั่ง X นาที" and for ignoring stale seated marks — ticks every 30 s.
  const [now, setNow] = useState(0);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);
  /** Minutes since the QR was printed for an empty table, or null when it isn't "รอสั่ง". */
  function seatedMinutes(table: PosTable): number | null {
    if (!table.seatedAt || now === 0 || now - table.seatedAt > SEATED_MAX_MS) return null;
    return Math.max(0, Math.floor((now - table.seatedAt) / 60_000));
  }
  async function clearSeated(table: PosTable) {
    // Customer left without ordering — same as closing the visit (also retires its session QR).
    await fetch(`/api/pos/tables/${table.id}/close-session`, { method: "POST" }).catch(() => undefined);
  }
  async function handlePrintQr(table: PosTable) {
    if (!settings || !appUser || qrPrintState[table.id] === "sending") return;
    setQrPrintState((s) => ({ ...s, [table.id]: "sending" }));
    try {
      await printQrForTable(table, settings, appUser);
      setQrPrintState((s) => ({ ...s, [table.id]: "sent" }));
    } catch {
      setQrPrintState((s) => ({ ...s, [table.id]: "error" }));
    }
    setTimeout(
      () =>
        setQrPrintState((s) => {
          const next = { ...s };
          delete next[table.id];
          return next;
        }),
      3000
    );
  }
  const currency = settings?.currency ?? "THB";

  // The new-order chime itself is handled by `PosOrderAlertListener`, mounted once in
  // `pos/layout.tsx` so it fires on every `/pos/*` screen, not only this one — this subscription
  // is just for the table grid's own live list.
  useEffect(() => orderRepository.subscribeOpenForShop(shopId, setOpenOrders), [shopId]);
  // "ใกล้หมด" strip above the tables — staff see it every time they come back to this screen.
  const [stockLevels, setStockLevels] = useState<StockLevel[]>([]);
  useEffect(() => stockLevelRepository.subscribeForShop(shopId, setStockLevels), [shopId]);
  const lowStock = stockLevels.filter(isLowStock);

  if (lockedPage) return null;

  const activeTables = tables.filter((t) => t.active);
  const otherChannels = channels.filter((c) => c.active && !c.requiresTable);
  const pendingOtherOrders = openOrders.filter((o) => o.tableId === null);
  const orderForTable = (tableId: string) => openOrders.find((o) => o.tableId === tableId);

  return (
    <main className="mx-auto max-w-6xl p-4 sm:p-6">
      {lowStock.length > 0 ? (
        <Link
          href="/pos/inventory"
          className="mb-4 block rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm"
        >
          <span className="font-semibold text-destructive">ของใกล้หมด: </span>
          {lowStock.map((l) => `${l.productName} (${l.qty})`).join(", ")}
        </Link>
      ) : null}
      <section>
        <h1 className="mb-3 text-lg font-semibold">โต๊ะ</h1>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {activeTables.map((table) => {
            const order = orderForTable(table.id);
            const waitingMinutes = order ? null : seatedMinutes(table);
            // Card look by state (approved design "1 · หน้าโต๊ะ"): white = ว่าง, amber = รอสั่ง,
            // filled accent = มีบิล, deep blue = กำลังคิดเงิน; a customer's new QR order blinks green.
            const look = order?.pendingReview
              ? "border-success bg-card text-foreground"
              : order?.billRequestedAt
                ? "border-[#23407A] bg-[#23407A] text-white"
                : order
                  ? "border-primary bg-primary text-primary-foreground"
                  : waitingMinutes !== null
                    ? "border-amber-400 bg-amber-200 text-amber-950 dark:bg-amber-900 dark:text-amber-50"
                    : "border-border bg-card text-foreground hover:bg-accent";
            const itemCount = order ? order.items.reduce((sum, i) => sum + i.quantity, 0) : 0;
            const statusText = order?.pendingReview
              ? "ออเดอร์ใหม่จาก QR"
              : order?.billRequestedAt
                ? "กำลังคิดเงิน"
                : order
                  ? `มีบิล · ${itemCount} รายการ`
                  : waitingMinutes !== null
                    ? "รอสั่ง"
                    : "ว่าง";
            return (
              <Link
                key={table.id}
                href={order ? `/pos/order/${order.id}` : `/pos/order/new?tableId=${table.id}`}
                className={
                  "relative isolate flex h-32 flex-col justify-between overflow-hidden rounded-xl border p-3.5 text-left " +
                  look
                }
              >
                {order?.pendingReview ? (
                  // The whole card blinks green until staff opens this order (see globals.css)
                  // — a full-card background layer, so it reads across the room. Behind the
                  // content (`-z-10`) so text stays legible.
                  <span className="animate-order-alert absolute inset-0 -z-10 bg-success" aria-hidden />
                ) : null}
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="block truncate text-2xl font-bold leading-tight">{tableLabel(table.name)}</span>
                    <span className="block text-sm font-medium opacity-90">{statusText}</span>
                  </div>
                  {table.qrMode === "session" ? (
                    <button
                      type="button"
                      aria-label={`QR ของ${tableLabel(table.name)}`}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setQrTable(table);
                      }}
                      className="z-10 shrink-0 rounded-md border border-current/30 bg-white/80 px-1.5 py-0.5 text-[11px] font-semibold text-foreground hover:bg-white"
                    >
                      QR
                    </button>
                  ) : null}
                </div>
                <div className="flex items-end justify-between gap-2">
                  <div className="min-w-0">
                    {order && !order.pendingReview ? (
                      <span className="block text-lg font-bold">{formatCurrency(order.total, currency)}</span>
                    ) : null}
                    <span className="block text-xs opacity-85">
                      {order
                        ? `เปิด ${formatTime(order.createdAt)}`
                        : waitingMinutes !== null
                          ? `รอ ${waitingMinutes} นาที`
                          : ""}
                    </span>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    {waitingMinutes !== null && !order ? (
                      <button
                        type="button"
                        aria-label={`${tableLabel(table.name)} ลูกค้าออกแล้ว ล้างสถานะรอสั่ง`}
                        title="ลูกค้าออกแล้ว"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          const note = table.qrMode === "session" ? " QR ที่พิมพ์ไว้จะใช้ไม่ได้" : "";
                          if (window.confirm(`${tableLabel(table.name)}: ลูกค้าออกไปแล้วโดยไม่สั่ง?${note}`)) {
                            void clearSeated(table);
                          }
                        }}
                        className="z-10 h-9 rounded-md px-2 text-base font-bold hover:bg-black/10"
                      >
                        ×
                      </button>
                    ) : null}
                    {qrPrintEnabled ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          void handlePrintQr(table);
                        }}
                        disabled={qrPrintState[table.id] === "sending"}
                        className={
                          "z-10 h-9 rounded-md border px-2 text-xs font-semibold " +
                          (qrPrintState[table.id] === "error"
                            ? "border-destructive bg-destructive/10 text-destructive"
                            : qrPrintState[table.id] === "sent"
                              ? "border-success bg-success/15 text-success"
                              : "border-current/40 bg-white/80 text-foreground hover:bg-white")
                        }
                      >
                        {qrPrintState[table.id] === "sending"
                          ? "กำลังส่ง..."
                          : qrPrintState[table.id] === "sent"
                            ? "ส่งแล้ว ✓"
                            : qrPrintState[table.id] === "error"
                              ? "ไม่สำเร็จ"
                              : "พิมพ์ QR"}
                      </button>
                    ) : null}
                  </div>
                </div>
              </Link>
            );
          })}
          {activeTables.length === 0 ? (
            <p className="col-span-full text-sm text-muted-foreground">
              ยังไม่มีโต๊ะ — ไปเพิ่มที่หน้า Admin ก่อน
            </p>
          ) : null}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded border border-border bg-card" />ว่าง</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-amber-300" />รอสั่ง</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-primary" />มีบิล</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-[#23407A]" />กำลังคิดเงิน</span>
          <span className="flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-success" />ออเดอร์ใหม่จาก QR</span>
        </div>
      </section>

      <section className="mt-6">
        <h1 className="mb-3 text-lg font-semibold">ช่องทางอื่น</h1>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {otherChannels.map((channel) => (
            <Link
              key={channel.id}
              href={`/pos/order/new?channelId=${channel.id}`}
              className="flex h-24 items-center justify-center rounded-lg border border-border bg-card p-4 text-center text-lg font-semibold hover:bg-accent"
              style={{ borderColor: channel.color }}
            >
              {channel.name}
            </Link>
          ))}
        </div>
      </section>

      {pendingOtherOrders.length > 0 ? (
        <section className="mt-6">
          <h1 className="mb-3 text-lg font-semibold">ออเดอร์ค้างอยู่</h1>
          <div className="grid gap-2">
            {pendingOtherOrders.map((order) => (
              <Link
                key={order.id}
                href={`/pos/order/${order.id}`}
                className={
                  "relative isolate flex items-center justify-between overflow-hidden rounded-lg border p-3 " +
                  (order.pendingReview ? "border-success" : "border-border bg-card hover:bg-accent")
                }
              >
                {order.pendingReview ? (
                  // Same full-card blink as a table's pendingReview card above — this list is
                  // "orders staff need to notice", so a self-order takeaway/Grab/etc. order
                  // arriving deserves exactly the same treatment as a QR order on a table.
                  <span className="animate-order-alert absolute inset-0 -z-10 bg-success" aria-hidden />
                ) : null}
                <span>
                  {order.channelName}
                  {order.customerLabel ? ` · ${order.customerLabel}` : ` — ${order.orderNumber}`}
                  {order.customerClaimedTransfer ? (
                    <span className="ml-2 text-xs font-medium text-destructive">รอตรวจสอบยอดโอน</span>
                  ) : null}
                </span>
                <Badge variant={order.pendingReview ? "success" : "default"}>
                  {order.pendingReview ? "ออเดอร์ใหม่" : formatCurrency(order.total, currency)}
                </Badge>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <div className="mt-6">
        <ServeCallToggle />
      </div>
      <div className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
        {/* Hides a link an Admin has restricted this account from — same "don't show it then
         * bounce back" courtesy AdminNav gives the Admin-only modules. PosPageGate (on each
         * page itself) is the actual enforcement; this is just so a restricted staff member
         * doesn't see a dead-end link at all. */}
        {POS_SECONDARY_PAGES.filter((p) => canSeePosPage(appUser?.allowedPosPages, p.path)).map((p) => (
          <Link key={p.path} href={p.path} className="text-sm text-muted-foreground underline">
            {p.label}
          </Link>
        ))}
      </div>

      <TableQrDialog table={qrTable} onOpenChange={(open) => !open && setQrTable(null)} />
    </main>
  );
}
