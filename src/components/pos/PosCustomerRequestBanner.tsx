"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { formatTime } from "@/lib/format";
import { canReceiveBillRequests, canReceiveStaffCalls } from "@/lib/pos/customerRequests";
import { playCustomerRequestTone } from "@/lib/pos/notificationSound";
import { orderRepository } from "@/repositories/orderRepository";
import { staffCallRepository } from "@/repositories/staffCallRepository";
import type { Order, StaffCall } from "@/types";
import { tableLabel } from "@/lib/tableLabel";

import { usePosCatalog } from "./PosCatalogContext";

/**
 * Mounted once in `pos/layout.tsx` (same spot as `PosOrderAlertListener`/`ServeCallAlert`) so a
 * dine-in customer's "เรียกพนักงาน"/"เช็คบิล" request (item: ปุ่มเรียกพนักงาน/เช็คบิล) is seen no
 * matter which `/pos/*` screen staff happen to be on. Unlike `ServeCallAlert`'s full-screen
 * takeover, this is a quiet top banner — the shop's confirmed choice was "กระพริบการ์ดโต๊ะ + แยก
 * แสดงรายการด้านบน", not a lock-screen-style alarm, since these two request kinds are lower-
 * urgency than food sitting ready to serve.
 *
 * Only ever shows anything to an account `canReceiveStaffCalls`/`canReceiveBillRequests` is true
 * for (every admin, plus whichever staff an Admin ticked) — the shop's confirmed choice was
 * "เฉพาะคนที่ตั้งสิทธิ์ไว้เท่านั้น", not a broadcast to every logged-in device like the new-order
 * chime. The two permissions are independent, so this subscribes to each collection only when
 * this account can actually see that kind of request at all — never just to filter it out after
 * the fact.
 */
export function PosCustomerRequestBanner() {
  const { shopId } = usePosCatalog();
  const { appUser } = useAuth();
  const router = useRouter();

  const seesStaffCalls = canReceiveStaffCalls(appUser);
  const seesBillRequests = canReceiveBillRequests(appUser);

  const [staffCalls, setStaffCalls] = useState<StaffCall[]>([]);
  const [billOrders, setBillOrders] = useState<Order[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    if (!seesStaffCalls) {
      // Permission just got revoked (or never applied) — drop whatever the previous subscription
      // left behind rather than show a now-unauthorized account a stale call list.
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing local state with this account's permission, not deriving from props
      setStaffCalls([]);
      return;
    }
    return staffCallRepository.subscribeOpen(shopId, setStaffCalls);
  }, [seesStaffCalls, shopId]);

  useEffect(() => {
    if (!seesBillRequests) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- same reasoning as the staff-call effect above
      setBillOrders([]);
      return;
    }
    // Filtered client-side over the already-needed "open orders for this shop" query, same
    // reasoning as `subscribeOpenNonTableForShop` — a composite index for one more equality
    // filter buys nothing at this scale.
    return orderRepository.subscribeOpenForShop(shopId, (orders) =>
      setBillOrders(orders.filter((o) => Boolean(o.customerCheckBillRequestedAt)))
    );
  }, [seesBillRequests, shopId]);

  // One shared tone for either kind (confirmed: "เสียงเดียวกัน แต่แยกจากออเดอร์พร้อมเสิร์ฟ"), fired
  // only when something genuinely new shows up — same "never alert on first mount, never repeat
  // for something already seen" pattern as `PosOrderAlertListener`'s `seenPendingIdsRef`.
  const seenIdsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const ids = new Set([...staffCalls.map((c) => c.id), ...billOrders.map((o) => o.id)]);
    if (seenIdsRef.current !== null) {
      const isNewlyActive = [...ids].some((id) => !seenIdsRef.current!.has(id));
      if (isNewlyActive) playCustomerRequestTone();
    }
    seenIdsRef.current = ids;
  }, [staffCalls, billOrders]);

  if (staffCalls.length === 0 && billOrders.length === 0) return null;

  async function resolveStaffCall(call: StaffCall) {
    if (!appUser || busyId) return;
    setBusyId(call.id);
    setActionError(null);
    try {
      await staffCallRepository.resolve(call.id, appUser);
    } catch {
      setActionError("รับเรื่องไม่สำเร็จ ลองใหม่อีกครั้ง");
    } finally {
      setBusyId(null);
    }
  }

  /** Clears the request for everyone (confirmed: "เคลียร์ออกทันทีหลังคนแรกกดรับ") then takes
   * whoever tapped it straight into that table's checkout — same as if they'd tapped "คิดเงิน"
   * themselves (confirmed: "พาตรงไปหน้าคิดเงินของโต๊ะนั้นเลย"). A plain update rather than
   * `staffCallRepository.resolve`'s claim transaction: unlike a serve call, two staff racing here
   * both just land on the same checkout screen — harmless, so there's nothing worth the extra
   * complexity of a transaction to prevent. */
  async function resolveBillRequest(order: Order) {
    if (!appUser || busyId) return;
    setBusyId(order.id);
    setActionError(null);
    try {
      await orderRepository.update(order.id, { customerCheckBillRequestedAt: null });
      router.push(`/pos/order/${order.id}?checkout=1`);
    } catch {
      setActionError("รับเรื่องไม่สำเร็จ ลองใหม่อีกครั้ง");
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-2 border-b border-rose-300 bg-rose-50 p-3 text-rose-950 dark:bg-rose-950 dark:text-rose-50">
      {actionError ? <p className="text-sm font-medium text-destructive">{actionError}</p> : null}
      <div className="flex flex-wrap gap-2">
        {staffCalls.map((call) => (
          <div
            key={call.id}
            className="flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm dark:border-rose-700 dark:bg-rose-900"
          >
            <span className="font-semibold">🔔 {tableLabel(call.tableName)} เรียกพนักงาน</span>
            <span className="text-xs opacity-70">{formatTime(call.createdAt)}</span>
            <Button size="sm" disabled={busyId === call.id} onClick={() => resolveStaffCall(call)}>
              {busyId === call.id ? "กำลังบันทึก..." : "รับเรื่อง"}
            </Button>
          </div>
        ))}
        {billOrders.map((order) => (
          <div
            key={order.id}
            className="flex items-center gap-2 rounded-lg border border-rose-300 bg-white px-3 py-2 text-sm dark:border-rose-700 dark:bg-rose-900"
          >
            <span className="font-semibold">🧾 {tableLabel(order.tableName)} ขอเช็คบิล</span>
            <span className="text-xs opacity-70">
              {order.customerCheckBillRequestedAt ? formatTime(order.customerCheckBillRequestedAt) : ""}
            </span>
            <Button size="sm" disabled={busyId === order.id} onClick={() => resolveBillRequest(order)}>
              {busyId === order.id ? "กำลังเปิด..." : "รับเรื่อง"}
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
