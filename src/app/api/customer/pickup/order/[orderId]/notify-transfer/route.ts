import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { resolveShopIdFromHost } from "@/lib/shop/shopLookupAdmin";
import type { Order } from "@/types";

/**
 * The customer tapping "แจ้งว่าโอนแล้ว" after scanning their PromptPay QR — just a claim (see
 * `Order.customerClaimedTransfer`'s doc comment), never treated as verified payment. Sets a flag
 * staff see as a "รอตรวจสอบยอดโอน" nudge; the real checkout/PAID status still only ever happens
 * through `CheckoutDialog` once staff has actually checked their own banking app. No auth, same
 * as the rest of the customer surface — worst case of a guessed/leaked order id here is a
 * misleading nudge on one order, never money moving or anything staff wouldn't double-check anyway.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = await params;
  const db = getAdminDb();

  const shopId = await resolveShopIdFromHost(db, request.headers);
  if (!shopId) {
    return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });
  }

  const snap = await db.collection(COLLECTIONS.orders).doc(orderId).get();
  if (!snap.exists) {
    return NextResponse.json({ error: "ไม่พบออเดอร์นี้" }, { status: 404 });
  }
  const order = snap.data() as Order;
  // Compared against the shop resolved from this request's own Host header (SaaS roadmap
  // Phase 2), not trusted from the order id alone — a guessed/leaked order id from another
  // shop's pickup flow must not be actionable from here.
  if (order.shopId !== shopId) {
    return NextResponse.json({ error: "ไม่พบออเดอร์นี้" }, { status: 404 });
  }

  await snap.ref.update({ customerClaimedTransfer: true });
  return NextResponse.json({ ok: true });
}
