import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { resolveEnabledModules, type ShopModuleKey } from "@/lib/shop/modules";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";

const MODULE_KEYS: ShopModuleKey[] = ["accounting", "cashSafe", "delivery", "payroll"];

/**
 * Turns one of the four shop-specific Admin modules (`lib/shop/modules.ts`) on or off for a
 * shop — the superadmin-side half of "ทำให้เป็นกลางสำหรับร้านทั่วไป": every shop signed up
 * through `/signup` starts with all four off (see the approve route), and a superadmin flips
 * one on here if a particular shop actually wants it (e.g. it also does delivery, or also
 * banks with K SHOP).
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ shopId: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { shopId } = await params;
  const body = (await request.json().catch(() => null)) as Partial<Record<ShopModuleKey, boolean>> | null;
  if (!body) return NextResponse.json({ error: "ไม่มีข้อมูลให้ตั้งค่า" }, { status: 400 });

  const ref = getAdminDb().collection(COLLECTIONS.shopSettings).doc(shopId);
  const snap = await ref.get();
  if (!snap.exists) return NextResponse.json({ error: "ไม่พบร้านนี้" }, { status: 404 });

  // Resolve through the same fallback every reader uses — a shop with no `enabledModules` field
  // yet (every shop created before this shipped) currently has every module ON, so toggling just
  // one of the four here must not silently turn the other three off for it.
  const current = resolveEnabledModules(snap.data()?.enabledModules);
  const next: Record<ShopModuleKey, boolean> = { ...current };
  for (const key of MODULE_KEYS) {
    if (body[key] !== undefined) next[key] = Boolean(body[key]);
  }

  await ref.update({ enabledModules: next, updatedAt: Date.now() });
  return NextResponse.json({ ok: true, enabledModules: next });
}
