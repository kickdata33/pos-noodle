import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { getShopBySlug } from "@/lib/shop/shopLookupAdmin";
import { isValidSlug } from "@/lib/shop/slug";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";

/**
 * Registers/changes a shop's subdomain slug directly from `/superadmin/subscriptions` — exists
 * for shops that were never given one through the normal `/signup` → approve flow, most notably
 * the legacy shop `scripts/seed.ts` creates (`shops/{DEFAULT_SHOP_ID}`, no `slug` field at all).
 * Before the `NEXT_PUBLIC_APP_DOMAIN` fix (see `proxy.ts`), every subdomain silently fell back to
 * that shop, so it *looked* reachable at any hostname; now that subdomain routing actually checks
 * `slug`, a shop with none can only be reached via the bare apex domain until one is set here.
 *
 * Deliberately only ever touches `shops/{shopId}.slug` — never creates a `subscriptions` doc as
 * a side effect, so giving the owner's own legacy shop a real slug doesn't also enroll it into
 * trial/billing state it was never meant to have.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId } = await params;
  const body = (await request.json().catch(() => null)) as { slug?: string } | null;
  const slug = (body?.slug ?? "").trim().toLowerCase();

  if (!isValidSlug(slug)) {
    return NextResponse.json({ error: "ชื่อ URL ไม่ถูกต้อง (ตัวเล็ก a-z, 0-9, ขีดกลาง, 3-40 ตัวอักษร)" }, {
      status: 400,
    });
  }

  const db = getAdminDb();
  const shopRef = db.collection(COLLECTIONS.shops).doc(shopId);
  const shopSnap = await shopRef.get();
  if (!shopSnap.exists) {
    return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });
  }

  const existing = await getShopBySlug(db, slug);
  if (existing && existing.id !== shopId) {
    return NextResponse.json({ error: "ชื่อ URL นี้มีร้านอื่นใช้แล้ว กรุณาเลือกชื่ออื่น" }, { status: 409 });
  }

  await shopRef.update({ slug });
  return NextResponse.json({ ok: true, slug });
}
