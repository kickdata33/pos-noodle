import { randomUUID } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Table } from "@/types";

/**
 * (Re)generates the one-time QR token for a table in `qrMode: "session"` — called from
 * `/admin/tables` and the POS floor view (`PosHome`) whenever staff seats a new party and wants
 * to hand them a fresh, scan-to-order QR (item: "ลูกค้าแอบถ่ายรูป QR แล้วสั่งทีหลังได้ไหม").
 *
 * Any active staff member can call this, not just Admin — seating guests is a day-to-day POS
 * task, not an admin config change (that's the separate `qrMode` toggle on the table itself,
 * which *is* Admin-only, same as every other table field). Goes through the Admin SDK rather
 * than a direct client Firestore write specifically so this doesn't need a `firestore.rules`
 * change (and the deploy step that goes with it) just to let non-admin staff touch one field on
 * an otherwise Admin-only-writable collection.
 *
 * Overwriting the previous token here is itself how an old printed QR gets invalidated — no
 * separate "revoke" step needed, since the old token simply stops matching.
 */
export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });

  const { id } = await params;
  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.tables).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "ไม่พบโต๊ะนี้" }, { status: 404 });

  const table = { ...(snap.data() as Omit<Table, "id">), id: snap.id };
  if (table.shopId !== session.appUser.shopId) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
  }
  if (table.qrMode !== "session") {
    return NextResponse.json({ error: "โต๊ะนี้ไม่ได้เปิดใช้โหมด QR แบบเปลี่ยนใหม่" }, { status: 400 });
  }

  const token = randomUUID();
  await ref.update({ sessionToken: token });
  return NextResponse.json({ ok: true, token });
}
