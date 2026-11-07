import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Table } from "@/types";

/**
 * Marks a table "มีลูกค้า · รอสั่ง" (`Table.seatedAt`) — called right after staff print its
 * self-order QR. Server-side because tables are Admin-only in the Firestore rules; any signed-in
 * staff member of the table's shop may seat a party.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });

  const { id } = await params;
  const ref = getAdminDb().collection(COLLECTIONS.tables).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "ไม่พบโต๊ะนี้" }, { status: 404 });
  if ((snap.data() as Omit<Table, "id">).shopId !== session.appUser.shopId) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
  }
  await ref.update({ seatedAt: Date.now() });
  return NextResponse.json({ ok: true });
}
