import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { ShopSettings, Table } from "@/types";
import { tableLabel } from "@/lib/tableLabel";

/**
 * Dine-in customer tapping "เรียกพนักงาน" on their own QR ordering screen (item: ปุ่มเรียกพนักงาน/
 * เช็คบิล) — no auth, same reasoning as every other `/api/customer/*` route (a diner shouldn't
 * need an account). Creates a `StaffCall` the POS side alerts on (`PosCustomerRequestBanner`),
 * tied to the table rather than an order (confirmed: "ผูกกับโต๊ะ" — a customer can want attention
 * before ordering anything at all).
 *
 * Idempotent against repeated taps: if this table already has an unresolved call, this is a
 * no-op that still returns success — the frontend already disables the button once tapped, but a
 * second tab/device, or a retried request, must never pile up duplicate alerts for one table.
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
  if (settings?.enableStaffCallButton !== true) {
    return NextResponse.json({ error: "ร้านยังไม่ได้เปิดใช้ปุ่มนี้" }, { status: 403 });
  }

  const staffCallsRef = db.collection(COLLECTIONS.staffCalls);
  const existingSnap = await staffCallsRef
    .where("shopId", "==", table.shopId)
    .where("tableId", "==", tableId)
    .where("resolvedAt", "==", null)
    .limit(1)
    .get();
  if (!existingSnap.empty) {
    return NextResponse.json({ ok: true });
  }

  await staffCallsRef.add({
    shopId: table.shopId,
    tableId: table.id,
    tableName: tableLabel(table.name),
    createdAt: Date.now(),
    resolvedAt: null,
    resolvedById: null,
    resolvedByName: null,
  });

  return NextResponse.json({ ok: true });
}
