import { NextResponse, type NextRequest } from "next/server";

import { BILLING_CONFIG_DOC_ID } from "@/lib/billing/billingConfig";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";

/** Edits the platform's trial-days/monthly-price config (SaaS roadmap Phase 3) — the whole
 * point of storing this in Firestore instead of an env var: the superadmin changes it here,
 * at runtime, no redeploy. */
export async function POST(request: NextRequest) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as { trialDays?: number; monthlyPriceThb?: number } | null;
  const trialDays = body?.trialDays;
  const monthlyPriceThb = body?.monthlyPriceThb;
  if (
    typeof trialDays !== "number" ||
    !Number.isFinite(trialDays) ||
    trialDays < 0 ||
    typeof monthlyPriceThb !== "number" ||
    !Number.isFinite(monthlyPriceThb) ||
    monthlyPriceThb < 0
  ) {
    return NextResponse.json({ error: "ค่าไม่ถูกต้อง" }, { status: 400 });
  }

  await getAdminDb()
    .collection(COLLECTIONS.billingConfig)
    .doc(BILLING_CONFIG_DOC_ID)
    .set({ trialDays, monthlyPriceThb, updatedAt: Date.now() }, { merge: true });

  return NextResponse.json({ ok: true });
}
