import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { Table } from "@/types";

/**
 * Clears a table's one-time QR token back to `null` the moment its bill closes — called
 * fire-and-forget from `OrderScreen` right alongside `notifyOrderEvent`, for both checkout
 * (`handleConfirmPayment`) and cancel (`confirmCancelOrder`), for every dine-in order regardless
 * of the table's `qrMode` (a no-op write on a `"static"` table, since nothing ever reads its
 * `sessionToken`). This is what actually closes the "customer photographed the QR, scans it
 * again after the table turned over" gap for `qrMode: "session"` tables — the printed QR staff
 * handed this party stops working the instant the bill is settled, not whenever someone
 * remembers to tap "generate a new one" for the *next* party.
 *
 * Same auth shape as `open-session` — any active staff of the table's own shop, Admin SDK so no
 * `firestore.rules` change is needed.
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

  await ref.update({ sessionToken: null });
  return NextResponse.json({ ok: true });
}
