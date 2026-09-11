import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { getShopBySlug } from "@/lib/shop/shopLookupAdmin";
import { isValidSlug } from "@/lib/shop/slug";

/**
 * Live availability check for the `/signup` form's slug field (SaaS roadmap Phase 2) — best
 * effort only. The authoritative check happens again at approval time in
 * `/api/superadmin/signup-requests/[id]/approve`, since a slug can be claimed by another
 * approval in between a check here and the eventual review.
 */
export async function GET(request: NextRequest) {
  const slug = request.nextUrl.searchParams.get("slug") ?? "";

  if (!isValidSlug(slug)) {
    return NextResponse.json({ available: false, reason: "รูปแบบไม่ถูกต้อง" });
  }

  const existing = await getShopBySlug(getAdminDb(), slug);
  if (existing) {
    return NextResponse.json({ available: false, reason: "ชื่อนี้มีร้านอื่นใช้แล้ว" });
  }

  return NextResponse.json({ available: true });
}
