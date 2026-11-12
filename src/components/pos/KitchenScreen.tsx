"use client";

import { useEffect, useRef, useState } from "react";

import { PosBackLink } from "@/components/pos/PosBackLink";
import { usePosCatalog } from "@/components/pos/PosCatalogContext";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { formatTime } from "@/lib/format";
import { detectNewKitchenItems, isNewKitchenItem } from "@/lib/pos/kitchenAlerts";
import { playOrderAlertSound } from "@/lib/pos/notificationSound";
import { notifyServeCall } from "@/lib/pos/pushClient";
import { awaitingServeCall, linesToCall, staysOnKitchenScreen } from "@/lib/pos/serveCalls";
import { orderRepository } from "@/repositories/orderRepository";
import { serveCallRepository } from "@/repositories/serveCallRepository";
import type { Order, OrderItem, ServeCall } from "@/types";

/**
 * Kitchen display (a separate screen/corner from the order-taking POS, per the shop's request):
 * every open order's items, per-line "ยังไม่ทำ"/"ทำแล้ว" toggle in big, unambiguous text/color
 * so a cook can tell status at a glance without reading fine print. Oldest order first (FIFO).
 *
 * An order disappears from this screen the moment every one of its items is marked done — it
 * keeps running its normal lifecycle (still open, still gets paid/checked out) on the regular
 * POS screens; this is purely a display filter for the kitchen's own view. `prepared` is
 * per-item, not per-order, since some shops split prep across a few different menu lines within
 * one order — see the field's doc comment on `OrderItem`.
 */
export function KitchenScreen() {
  const { shopId } = usePosCatalog();
  const { appUser } = useAuth();
  const [openOrders, setOpenOrders] = useState<Order[]>([]);
  // "เรียกเสิร์ฟ" calls nobody has picked up yet — shown at the top so the cook can see the floor
  // hasn't responded.
  const [openCalls, setOpenCalls] = useState<ServeCall[]>([]);
  const [callingId, setCallingId] = useState<string | null>(null);
  useEffect(() => serveCallRepository.subscribeOpen(shopId, setOpenCalls), [shopId]);

  // Item ids already on screen — anything unprepared that isn't in here is new food to cook, so
  // the tablet chimes (for staff-keyed orders too, not only customer QR orders — the layout-wide
  // `PosOrderAlertListener` skips this screen so it never chimes twice).
  const seenItemIdsRef = useRef<Set<string> | null>(null);
  // Drives the "ใหม่" badge expiry; refreshed on every snapshot and every 30 seconds.
  const [now, setNow] = useState(0);

  useEffect(
    () =>
      orderRepository.subscribeOpenForShop(shopId, (orders) => {
        const { seen, hasNew } = detectNewKitchenItems(seenItemIdsRef.current, orders);
        seenItemIdsRef.current = seen;
        if (hasNew) playOrderAlertSound();
        setOpenOrders(orders);
        setNow(Date.now());
      }),
    [shopId]
  );
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  // An order leaves this screen once everything is cooked AND called out ("เรียกเสิร์ฟ").
  const kitchenOrders = openOrders
    .filter(staysOnKitchenScreen)
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);

  async function toggleItemPrepared(order: Order, item: OrderItem) {
    // Event handler only (invoked from the button's onClick below), never during render — the
    // purity rule can't trace that through the inline arrow wrapper, so it's a false positive.
    // eslint-disable-next-line react-hooks/purity
    const updatedAt = Date.now();
    const items = order.items.map((i) => {
      if (i.id !== item.id) return i;
      if (!i.prepared) return { ...i, prepared: true, preparedAt: updatedAt };
      // Un-ticking drops the timestamps entirely (Firestore rejects `undefined` values).
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { preparedAt, serveCalledAt, ...rest } = i;
      return { ...rest, prepared: false };
    });
    await orderRepository.update(order.id, { items, updatedAt });
  }

  async function callToServe(order: Order) {
    if (!appUser) return;
    const lines = linesToCall(order.items);
    if (lines.length === 0) return;
    setCallingId(order.id);
    try {
      const callId = await serveCallRepository.callToServe(order, lines, appUser);
      // Lock-screen notification on every subscribed staff phone (Web Push).
      notifyServeCall(callId, "call");
    } finally {
      setCallingId(null);
    }
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <PosBackLink />
      <h1 className="mb-4 text-lg font-semibold">หน้าจอครัว</h1>

      {openCalls.length > 0 ? (
        <div className="mb-4 grid gap-1 rounded-lg border border-amber-500 bg-amber-100 p-3 text-sm dark:bg-amber-950">
          {openCalls.map((c) => (
            <p key={c.id} className="font-medium">
              🔔 {c.label} — เรียกเสิร์ฟแล้ว รอพนักงานรับ ({Math.max(0, Math.floor((now - c.createdAt) / 60_000))} นาที)
            </p>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4">
        {kitchenOrders.map((order) => (
          <div
            key={order.id}
            className={
              "rounded-lg border bg-card p-4 " +
              (order.items.some((item) => isNewKitchenItem(item, now))
                ? "border-primary ring-2 ring-primary"
                : "border-border")
            }
          >
            <div className="mb-3 flex items-center justify-between">
              <span className="text-lg font-semibold">
                {order.tableName ?? order.customerLabel ?? order.channelName} · {order.orderNumber}
              </span>
              <span className="text-sm text-muted-foreground">เปิดเมื่อ {formatTime(order.createdAt)}</span>
            </div>
            <Button
              className="mb-3 h-12 w-full bg-amber-500 text-base font-bold text-white hover:bg-amber-600"
              disabled={callingId === order.id || linesToCall(order.items).length === 0}
              onClick={() => callToServe(order)}
            >
              {callingId === order.id
                ? "กำลังเรียก..."
                : order.items.some(awaitingServeCall)
                  ? `🔔 เรียกเสิร์ฟ (${order.items.filter(awaitingServeCall).length} รายการที่ทำแล้ว)`
                  : "🔔 เรียกเสิร์ฟทั้งหมด"}
            </Button>

            <div className="grid gap-2">
              {order.items.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => toggleItemPrepared(order, item)}
                  className={
                    "flex w-full items-center justify-between gap-3 rounded-lg border-2 px-4 py-3 text-left " +
                    (item.prepared
                      ? "border-success bg-success/10"
                      : "border-destructive bg-destructive/10")
                  }
                >
                  <span className="flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className={"text-lg font-semibold " + (item.prepared ? "line-through opacity-70" : "")}>
                        {item.quantity}× {item.productName}
                      </span>
                      {isNewKitchenItem(item, now) ? (
                        <span className="rounded-md bg-primary px-2 py-0.5 text-sm font-bold text-primary-foreground">
                          ใหม่
                        </span>
                      ) : null}
                      {item.addedAt ? (
                        <span className="text-sm text-muted-foreground">สั่ง {formatTime(item.addedAt)}</span>
                      ) : null}
                    </span>
                    {item.modifiers.length > 0 ? (
                      <span className="block text-sm text-muted-foreground">
                        {item.modifiers.map((m) => m.optionName).join(", ")}
                      </span>
                    ) : null}
                    {item.note ? (
                      <span className="block text-sm text-muted-foreground">หมายเหตุ: {item.note}</span>
                    ) : null}
                  </span>
                  <span
                    className={
                      "shrink-0 rounded-md px-3 py-2 text-base font-bold " +
                      (item.prepared ? "bg-success text-success-foreground" : "bg-destructive text-destructive-foreground")
                    }
                  >
                    {item.prepared ? "ทำแล้ว" : "ยังไม่ทำ"}
                  </span>
                </button>
              ))}
            </div>
          </div>
        ))}

        {kitchenOrders.length === 0 ? (
          <p className="text-center text-muted-foreground">ไม่มีออเดอร์ที่ต้องทำตอนนี้</p>
        ) : null}
      </div>
    </main>
  );
}
