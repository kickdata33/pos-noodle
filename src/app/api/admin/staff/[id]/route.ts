import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { AppUser } from "@/types";

/**
 * Delete a staff/admin account ("หน้าพนักงาน เพิ่ม ลบพนักงานได้ด้วย"). Needs the Admin SDK for two
 * things no plain client write can do: remove the Firebase Auth user itself, and clean up
 * `userSecrets/{id}` — denied to every client by `firestore.rules`, same reasoning as the PIN
 * routes right above this one.
 *
 * Two guardrails beyond the usual admin-only re-check, both permanent mistakes otherwise:
 * - Can't delete your own signed-in account (an accidental self-lockout with no "undo" — the
 *   PIN that got deleted can never be re-derived to sign back in and reverse it).
 * - Can't delete the shop's last active admin, for the same reason: nobody would be left who
 *   can reach `/admin` to fix it afterwards.
 */
export async function DELETE(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession();
  if (!session || session.appUser.role !== "admin") {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });
  }

  const { id } = await params;
  if (id === session.uid) {
    return NextResponse.json({ error: "ลบบัญชีตัวเองไม่ได้" }, { status: 400 });
  }

  const db = getAdminDb();
  const shopId = session.appUser.shopId;
  const userRef = db.collection(COLLECTIONS.users).doc(id);
  const userSnap = await userRef.get();
  const target = userSnap.exists ? ({ id: userSnap.id, ...userSnap.data() } as AppUser) : null;

  // Scoped to the caller's own shop, same as every other `/api/admin/staff*` route — an Admin
  // from shop A passing shop B's uid should see "not found", not accidentally touch it.
  if (!target || target.shopId !== shopId) {
    return NextResponse.json({ error: "ไม่พบพนักงาน" }, { status: 404 });
  }

  if (target.role === "admin") {
    const activeAdmins = await db
      .collection(COLLECTIONS.users)
      .where("shopId", "==", shopId)
      .where("role", "==", "admin")
      .where("active", "==", true)
      .get();
    const otherActiveAdmins = activeAdmins.docs.filter((doc) => doc.id !== id);
    if (otherActiveAdmins.length === 0) {
      return NextResponse.json(
        { error: "ต้องมี Admin เหลืออย่างน้อย 1 คนในร้าน ลบคนนี้ไม่ได้" },
        { status: 400 }
      );
    }
  }

  await Promise.all([
    userRef.delete(),
    db.collection(COLLECTIONS.userSecrets).doc(id).delete(),
    // Best-effort: an already-missing Auth user (e.g. a prior partial failure) shouldn't block
    // cleaning up the two Firestore docs above, which are the parts that actually matter for
    // "can this PIN still log in".
    getAdminAuth()
      .deleteUser(id)
      .catch(() => undefined),
  ]);

  return NextResponse.json({ ok: true });
}
