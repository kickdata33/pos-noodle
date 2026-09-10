import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import type { Order } from "@/types";

/**
 * The customer tapping "แจ้งว่าโอนแล้ว" after scanning their PromptPay QR — just a claim (see
 * `Order.customerClaimedTransfer`'s doc comment), never treated as verified payment. Sets a flag
 * staff see as a "รอตรวจสอบยอดโอน" nudge; the real checkout/PAID status still only ever happens
 * through `CheckoutDialog` once staff has actually checked their own banking app. No auth, same
 * as the rest of the customer surface — worst case of a guessed/leaked order id here is a
 * misleading nudge on one order, never money moving or anything staff wouldn't double-check anyway.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const db = getAdminDb();

  const snap = await db.collection(COLLECTIONS.orders).doc(orderId).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "ไม่พบออเดอร์นี้" }, { status: 404 });
  }
  const order = snap.data() as Order;
  if (order.shopId !== DEFAULT_SHOP_ID) {
    return NextResponse.json({ error: "ไม่พบออเดอร์นี้" }, { status: 404 });
  }

  await snap.ref.update({ customerClaimedTransfer: true });
  return NextResponse.json({ ok: true });
}
