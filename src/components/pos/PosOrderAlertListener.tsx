"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

import { playOrderAlertSound, unlockOrderAlertAudio } from "@/lib/pos/notificationSound";
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
 *
 * Also unlocks the chime's shared AudioContext (`unlockOrderAlertAudio`) on every tap/keypress
 * anywhere in `/pos/*` — reported bug: the chime fires from this Firestore listener, never from
 * a user gesture, so a context created right at alert time starts "suspended" and plays nothing
 * on a freshly loaded/reloaded page (the common case right after staff open the POS each shift,
 * or after the PIN-login redirect) until something explicitly resumes it. Listener stays attached
 * for the whole session (not "once") so it also re-resumes a context the browser auto-suspended
 * after a long idle stretch between orders.
 */
export function PosOrderAlertListener() {
  const { shopId } = usePosCatalog();
  const seenPendingIdsRef = useRef<Set<string> | null>(null);

  useEffect(() => {
    document.addEventListener("pointerdown", unlockOrderAlertAudio);
    document.addEventListener("keydown", unlockOrderAlertAudio);
    return () => {
      document.removeEventListener("pointerdown", unlockOrderAlertAudio);
      document.removeEventListener("keydown", unlockOrderAlertAudio);
    };
  }, []);
  // The kitchen screen runs its own, broader alert (any new item, not just QR orders awaiting
  // review) — skipping here keeps a kitchen tablet from chiming twice for one customer order.
  const pathname = usePathname();
  const onKitchenScreen = pathname?.startsWith("/pos/kitchen") ?? false;
  const onKitchenScreenRef = useRef(onKitchenScreen);
  useEffect(() => {
    onKitchenScreenRef.current = onKitchenScreen;
  }, [onKitchenScreen]);

  useEffect(
    () =>
      orderRepository.subscribeOpenForShop(shopId, (orders) => {
        const pendingIds = new Set(orders.filter((o) => o.pendingReview).map((o) => o.id));
        if (seenPendingIdsRef.current !== null) {
          const isNewlyPending = [...pendingIds].some((id) => !seenPendingIdsRef.current!.has(id));
          if (isNewlyPending && !onKitchenScreenRef.current) playOrderAlertSound();
        }
        seenPendingIdsRef.current = pendingIds;
      }),
    [shopId]
  );

  return null;
}
