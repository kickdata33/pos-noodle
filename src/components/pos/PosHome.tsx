"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ServeCallToggle } from "@/components/pos/ServeCallToggle";
import { TableQrDialog } from "@/components/shared/TableQrDialog";
import { Badge } from "@/components/ui/badge";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { isLowStock } from "@/lib/pos/stock";
import { printQrForTable } from "@/lib/pos/tableQrPrint";
import { orderRepository } from "@/repositories/orderRepository";
import { stockLevelRepository } from "@/repositories/stockRepository";
import type { Order, StockLevel, Table as PosTable } from "@/types";

import { usePosCatalog } from "./PosCatalogContext";

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

  const activeTables = tables.filter((t) => t.active);
  const otherChannels = channels.filter((c) => c.active && !c.requiresTable);
  const pendingOtherOrders = openOrders.filter((o) => o.tableId === null);
  const orderForTable = (tableId: string) => openOrders.find((o) => o.tableId === tableId);

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {activeTables.map((table) => {
            const order = orderForTable(table.id);
            const waitingMinutes = order ? null : seatedMinutes(table);
            return (
              <Link
                key={table.id}
                href={
                  order
                    ? `/pos/order/${order.id}`
                    : `/pos/order/new?tableId=${table.id}`
                }
                className={
                  "relative isolate flex flex-col items-center justify-center gap-1 overflow-hidden rounded-lg border p-4 " +
                  // Taller with the "พิมพ์ QR" button so it never sits on top of the table name.
                  (qrPrintEnabled ? "h-28 pt-8 " : "h-24 ") +
                  (order?.pendingReview
                    ? "border-success"
                    : order
                      ? "border-primary bg-primary/10"
                      : waitingMinutes !== null
                        ? "border-amber-500 bg-amber-100 hover:bg-amber-200 dark:bg-amber-950 dark:hover:bg-amber-900"
                        : "border-border bg-card hover:bg-accent")
                }
              >
                {order?.pendingReview ? (
                  // The whole card blinks green until staff opens this order (see globals.css)
                  // — a full-card background layer, not just a corner dot, so it reads across
                  // the room. Sits behind the content below (`-z-10`) so text stays fully legible.
                  <span className="animate-order-alert absolute inset-0 -z-10 bg-success" aria-hidden />
                ) : null}
                {table.qrMode === "session" ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setQrTable(table);
                    }}
                    className="absolute right-1 top-1 z-10 rounded border border-border bg-card/90 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground hover:bg-accent"
                  >
                    QR
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
                      "absolute left-1 top-1 z-10 rounded-md border px-2 py-1 text-xs font-semibold " +
                      (qrPrintState[table.id] === "error"
                        ? "border-destructive bg-destructive/10 text-destructive"
                        : qrPrintState[table.id] === "sent"
                          ? "border-success bg-success/10 text-success"
                          : "border-primary/40 bg-card text-primary hover:bg-primary/10")
                    }
                  >
                    {qrPrintState[table.id] === "sending"
                      ? "กำลังส่ง..."
                      : qrPrintState[table.id] === "sent"
                        ? "ส่งพิมพ์แล้ว ✓"
                        : qrPrintState[table.id] === "error"
                          ? "พิมพ์ไม่สำเร็จ"
                          : "พิมพ์ QR"}
                  </button>
                ) : null}
                <span className="text-lg font-semibold">{table.name}</span>
                {order ? (
                  <Badge variant={order.pendingReview ? "success" : "default"}>
                    {order.pendingReview ? "ออเดอร์ใหม่จาก QR" : formatCurrency(order.total, currency)}
                  </Badge>
                ) : waitingMinutes !== null ? (
                  <span className="flex items-center gap-1">
                    <span className="rounded-md bg-amber-500 px-2 py-0.5 text-xs font-semibold text-white">
                      รอสั่ง {waitingMinutes} นาที
                    </span>
                    <button
                      type="button"
                      aria-label={`โต๊ะ ${table.name} ลูกค้าออกแล้ว ล้างสถานะรอสั่ง`}
                      title="ลูกค้าออกแล้ว"
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        const note = table.qrMode === "session" ? " QR ที่พิมพ์ไว้จะใช้ไม่ได้" : "";
                        if (window.confirm(`โต๊ะ ${table.name}: ลูกค้าออกไปแล้วโดยไม่สั่ง?${note}`)) {
                          void clearSeated(table);
                        }
                      }}
                      className="z-10 rounded px-1.5 text-sm font-bold text-amber-800 hover:bg-amber-200 dark:text-amber-200"
                    >
                      ×
                    </button>
                  </span>
                ) : (
                  <Badge variant="muted">ว่าง</Badge>
                )}
              </Link>
            );
          })}
          {activeTables.length === 0 ? (
            <p className="col-span-full text-sm text-muted-foreground">
              ยังไม่มีโต๊ะ — ไปเพิ่มที่หน้า Admin ก่อน
            </p>
          ) : null}
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
        <Link href="/pos/kitchen" className="text-sm text-muted-foreground underline">
          หน้าจอครัว
        </Link>
        <Link href="/pos/history" className="text-sm text-muted-foreground underline">
          ประวัติออเดอร์
        </Link>
        <Link href="/pos/stock" className="text-sm text-muted-foreground underline">
          ของหมด
        </Link>
        <Link href="/pos/inventory" className="text-sm text-muted-foreground underline">
          สต๊อก
        </Link>
        <Link href="/pos/alert-voice" className="text-sm text-muted-foreground underline">
          เสียงแจ้งเตือน
        </Link>
        <Link href="/pos/print-station" className="text-sm text-muted-foreground underline">
          สถานีพิมพ์
        </Link>
      </div>

      <TableQrDialog table={qrTable} onOpenChange={(open) => !open && setQrTable(null)} />
    </main>
  );
}
