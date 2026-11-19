import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Order, ShopSettings, StaffCall, Table } from "@/types";

/**
 * Table identity + "what's already been ordered for this table" for the QR self-order screen —
 * shown before the customer adds anything, so they don't double-order (per the shop's choice).
 * A table that's inactive (closed, item 13) or doesn't exist reads as a 404 rather than an empty
 * menu, since scanning a QR for a closed table is a real "you shouldn't be ordering here" state,
 * not just "nothing to show yet".
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ tableId: string }> }) {
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
  // `qrMode: "session"` tables (item: "ลูกค้าแอบถ่ายรูป QR แล้วสั่งทีหลังได้ไหม") only accept a
  // request carrying the table's *current* one-time token — see `Table.sessionToken`'s own
  // comment. A `"static"` table (or any table from before this field existed) skips this check
  // entirely, same permanent-link behavior as always.
  if (table.qrMode === "session") {
    const token = request.nextUrl.searchParams.get("s");
    if (!table.sessionToken || token !== table.sessionToken) {
      return NextResponse.json({ error: "QR นี้หมดอายุหรือยังไม่เปิดใช้งาน กรุณาขอ QR ใหม่จากพนักงาน" }, { status: 404 });
    }
  }

  const [openOrderSnap, settingsSnap, activeStaffCallSnap] = await Promise.all([
    db
      .collection(COLLECTIONS.orders)
      .where("shopId", "==", table.shopId)
      .where("tableId", "==", tableId)
      .where("status", "==", "OPEN")
      .limit(1)
      .get(),
    db.collection(COLLECTIONS.shopSettings).doc(table.shopId).get(),
    // Equality filters only — no composite index needed, same reasoning as every other
    // "is there already one of these open" check in this codebase (e.g. `listOpenForTable`).
    db
      .collection(COLLECTIONS.staffCalls)
      .where("shopId", "==", table.shopId)
      .where("tableId", "==", tableId)
      .where("resolvedAt", "==", null)
      .limit(1)
      .get(),
  ]);

  const existingOrder = openOrderSnap.empty
    ? null
    : ({ ...openOrderSnap.docs[0].data(), id: openOrderSnap.docs[0].id } as Order);
  const settings = settingsSnap.exists ? (settingsSnap.data() as ShopSettings) : null;
  const activeStaffCall = activeStaffCallSnap.empty ? null : (activeStaffCallSnap.docs[0].data() as StaffCall);

  return NextResponse.json({
    table: { id: table.id, name: table.name },
    // Only what the customer needs to see their own running tab — never the whole Order doc
    // (payment fields, staff who opened it, etc. stay server-side).
    existingItems: existingOrder?.items ?? [],
    orderNumber: existingOrder?.orderNumber ?? null,
    // Staff tapped "คิดเงิน" → the customer page shows the check-your-bill view (Order.billRequestedAt).
    billRequested: Boolean(existingOrder?.billRequestedAt),
    // The amount actually due (after promotions/service charge/VAT), not just the sum of lines.
    total: existingOrder?.total ?? null,
    // Whether the shop turned on each self-order request button at all (item: ปุ่มเรียกพนักงาน/
    // เช็คบิล) — both default off, same opt-in pattern as everything else on `/admin/settings`.
    callStaffEnabled: settings?.enableStaffCallButton === true,
    checkBillEnabled: settings?.enableCheckBillButton === true,
    // Whether *this* table already has a pending request — read back fresh on every poll so the
    // button's "เรียกแล้ว/ขอแล้ว รอพนักงาน..." state survives a reload, not just this tab's memory.
    staffCallActive: activeStaffCall !== null,
    checkBillRequested: Boolean(existingOrder?.customerCheckBillRequestedAt),
  });
}
