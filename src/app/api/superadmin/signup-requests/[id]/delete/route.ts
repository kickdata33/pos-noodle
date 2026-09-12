import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { ShopSignupRequest } from "@/types";

/**
 * Removes a signup request from the console's list — for tidying up spam/test/duplicate
 * applications. Refuses to delete an `approved` request that still has a live shop (use
 * `/api/superadmin/subscriptions/[shopId]/delete` for that — deleting the shop itself already
 * un-links and updates this request, see that route's step 4) so this never silently orphans a
 * shop with no record of where it came from.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { id } = await params;
  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.shopSignupRequests).doc(id);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "ไม่พบคำขอนี้" }, { status: 404 });

  const req = snap.data() as ShopSignupRequest;
  if (req.status === "approved" && req.approvedShopId) {
    return NextResponse.json(
      { error: "คำขอนี้มีร้านที่ยังใช้งานอยู่ ต้องลบร้านก่อน (ปุ่ม \"ลบร้านถาวร\" ที่หน้าสถานะบิล)" },
      { status: 409 }
    );
  }

  await ref.delete();
  return NextResponse.json({ ok: true });
}
