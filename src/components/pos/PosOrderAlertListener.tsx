"use client";

import { useEffect, useRef } from "react";

import { playOrderAlertSound } from "@/lib/pos/notificationSound";
import { orderRepository } from "@/repositories/orderRepository";

import { usePosCatalog } from "./PosCatalogContext";

/**
 * Mounted once in `pos/layout.tsx` (not inside `PosHome`) so the new-order chime fires no matter
 * which `/pos/*` screen staff happen to be on — reported gap: a staff member standing at
 * `/pos/order/[orderId]` building someone else's order, or anywhere other than the table-grid
 * home screen, never heard the alert before this, because the subscription used to live only in
 * `PosHome`. Invisible — this renders nothing, it only listens and plays the sound.
 *
 * Same "newly pending, not already-pending" logic `PosHome` used to own: never fires on first
 * mount (a table already awaiting review when a page loads shouldn't make every device chime at
 * once), and never repeats for an order staff hasn't acknowledged yet.
 */
export function PosOrderAlertListener() {
  const { shopId } = usePosCatalog();
  const seenPendingIdsRef = useRef<Set<string> | null>(null);

  useEffect(
    () =>
      orderRepository.subscribeOpenForShop(shopId, (orders) => {
        const pendingIds = new Set(orders.filter((o) => o.pendingReview).map((o) => o.id));
        if (seenPendingIdsRef.current !== null) {
          const isNewlyPending = [...pendingIds].some((id) => !seenPendingIdsRef.current!.has(id));
          if (isNewlyPending) playOrderAlertSound();
        }
        seenPendingIdsRef.current = pendingIds;
      }),
    [shopId]
  );

  return null;
}
