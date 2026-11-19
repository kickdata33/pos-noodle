import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Order, ShopSettings, Table } from "@/types";

/**
 * Dine-in customer tapping "เช็คบิล" on their own QR ordering screen — asks staff to come collect
 * payment, instead of waiting to be noticed. No auth, same as every other `/api/customer/*`
 * route. Sets `Order.customerCheckBillRequestedAt`, which is deliberately a *different* field
 * from `billRequestedAt` (that one means staff already tapped "คิดเงิน" — see that field's
 * comment in `types/order.ts`): this only drives the POS-side alert
 * (`PosCustomerRequestBanner`), it never locks the customer's own ordering screen.
 *
 * Idempotent against repeated taps for the same reason `call-staff` is — a second tap, tab, or
 * retried request against an order that already has this set just returns success unchanged.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const db = getAdminDb();

  const tableSnap = await db.collection(COLLECTIONS.tables).doc(tableId).get();
  if (!tableSnap.exists) {
    return NextResponse.json({ error: "ไม่พบโต๊ะนี้" }, { status: 404 });
  }
  const table = { ...tableSnap.data(), id: tableSnap.id } as Table;
  if (!table.active) {
    return NextResponse.json({ error: "โต๊ะนี้ปิดใช้งานอยู่" }, { status: 404 });
  }

  const settingsSnap = await db.collection(COLLECTIONS.shopSettings).doc(table.shopId).get();
  const settings = settingsSnap.exists ? (settingsSnap.data() as ShopSettings) : null;
  if (settings?.enableCheckBillButton !== true) {
    return NextResponse.json({ error: "ร้านยังไม่ได้เปิดใช้ปุ่มนี้" }, { status: 403 });
  }

  const openOrderSnap = await db
    .collection(COLLECTIONS.orders)
    .where("shopId", "==", table.shopId)
    .where("tableId", "==", tableId)
    .where("status", "==", "OPEN")
    .limit(1)
    .get();
  if (openOrderSnap.empty) {
    return NextResponse.json({ error: "ยังไม่มีรายการสั่งของโต๊ะนี้" }, { status: 404 });
  }
  const orderDoc = openOrderSnap.docs[0];
  const order = orderDoc.data() as Order;
  if (order.customerCheckBillRequestedAt) {
    return NextResponse.json({ ok: true });
  }

  await orderDoc.ref.update({ customerCheckBillRequestedAt: Date.now() });

  return NextResponse.json({ ok: true });
}
