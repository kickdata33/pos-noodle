"use client";

import { useEffect, useState } from "react";

import { PosBackLink } from "@/components/pos/PosBackLink";
import { usePosCatalog } from "@/components/pos/PosCatalogContext";
import { formatTime } from "@/lib/format";
import { orderRepository } from "@/repositories/orderRepository";
import type { Order, OrderItem } from "@/types";

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
  const [openOrders, setOpenOrders] = useState<Order[]>([]);

  useEffect(() => orderRepository.subscribeOpenForShop(shopId, setOpenOrders), [shopId]);

  const kitchenOrders = openOrders
    .filter((o) => o.items.some((item) => !item.prepared))
    .slice()
    .sort((a, b) => a.createdAt - b.createdAt);

  async function toggleItemPrepared(order: Order, item: OrderItem) {
    // Event handler only (invoked from the button's onClick below), never during render — the
    // purity rule can't trace that through the inline arrow wrapper, so it's a false positive.
    // eslint-disable-next-line react-hooks/purity
    const updatedAt = Date.now();
    const items = order.items.map((i) => (i.id === item.id ? { ...i, prepared: !i.prepared } : i));
    await orderRepository.update(order.id, { items, updatedAt });
  }

  return (
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <PosBackLink />
      <h1 className="mb-4 text-lg font-semibold">หน้าจอครัว</h1>

      <div className="grid gap-4">
        {kitchenOrders.map((order) => (
          <div key={order.id} className="rounded-lg border border-border bg-card p-4">
            <div className="mb-3 flex items-center justify-between">
              <span className="text-lg font-semibold">
                {order.tableName ?? order.customerLabel ?? order.channelName} · {order.orderNumber}
              </span>
              <span className="text-sm text-muted-foreground">เปิดเมื่อ {formatTime(order.createdAt)}</span>
            </div>

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
                    <span className={"text-lg font-semibold " + (item.prepared ? "line-through opacity-70" : "")}>
                      {item.quantity}× {item.productName}
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
