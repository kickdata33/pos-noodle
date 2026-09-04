import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import type { Order, Table } from "@/types";

/**
 * Table identity + "what's already been ordered for this table" for the QR self-order screen —
 * shown before the customer adds anything, so they don't double-order (per the shop's choice).
 * A table that's inactive (closed, item 13) or doesn't exist reads as a 404 rather than an empty
 * menu, since scanning a QR for a closed table is a real "you shouldn't be ordering here" state,
 * not just "nothing to show yet".
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ tableId: string }> }) {
  const { tableId } = await params;
  const db = getAdminDb();

  const tableSnap = await db.collection(COLLECTIONS.tables).doc(tableId).get();
  if (!tableSnap.exists) {
    return NextResponse.json({ error: "ไม่พบโต๊ะนี้" }, { status: 404 });
  }
  const table = { ...tableSnap.data(), id: tableSnap.id } as Table;
  if (table.shopId !== DEFAULT_SHOP_ID || !table.active) {
    return NextResponse.json({ error: "โต๊ะนี้ปิดใช้งานอยู่" }, { status: 404 });
  }

  const openOrderSnap = await db
    .collection(COLLECTIONS.orders)
    .where("shopId", "==", DEFAULT_SHOP_ID)
    .where("tableId", "==", tableId)
    .where("status", "==", "OPEN")
    .limit(1)
    .get();

  const existingOrder = openOrderSnap.empty
    ? null
    : ({ ...openOrderSnap.docs[0].data(), id: openOrderSnap.docs[0].id } as Order);

  return NextResponse.json({
    table: { id: table.id, name: table.name },
    // Only what the customer needs to see their own running tab — never the whole Order doc
    // (payment fields, staff who opened it, etc. stay server-side).
    existingItems: existingOrder?.items ?? [],
    orderNumber: existingOrder?.orderNumber ?? null,
  });
}
