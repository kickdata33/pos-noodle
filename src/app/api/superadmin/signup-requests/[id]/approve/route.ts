import { NextResponse, type NextRequest } from "next/server";

import { InvalidPinError, PinConflictError, assignPin } from "@/lib/auth/pinAssignment";
import { getBillingConfig } from "@/lib/billing/billingConfig";
import { computeTrialEnd } from "@/lib/billing/subscriptionState";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { getShopBySlug } from "@/lib/shop/shopLookupAdmin";
import { isValidSlug } from "@/lib/shop/slug";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { ShopSignupRequest } from "@/types";

interface RequestBody {
  finalSlug?: string;
  adminName?: string;
  pin?: string;
}

/**
 * Provisions a shop from an approved signup request (SaaS roadmap Phase 2) — mirrors
 * `scripts/seed.ts`'s shop/settings defaults and `/api/admin/staff`'s
 * create-Firebase-Auth-user-then-`assignPin`-then-rollback-on-conflict pattern, just invoked by
 * the superadmin console instead of an existing shop's own admin.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 401 });
  }

  const { id } = await params;
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  const adminName = body?.adminName?.trim();
  const pin = body?.pin;
  const finalSlug = (body?.finalSlug ?? "").trim().toLowerCase();

  if (!adminName || !pin) {
    return NextResponse.json({ error: "กรุณากรอกชื่อแอดมินและ PIN" }, { status: 400 });
  }
  if (!isValidSlug(finalSlug)) {
    return NextResponse.json({ error: "ชื่อ URL ไม่ถูกต้อง" }, { status: 400 });
  }

  const db = getAdminDb();
  const requestRef = db.collection(COLLECTIONS.shopSignupRequests).doc(id);
  const requestSnap = await requestRef.get();
  if (!requestSnap.exists) {
    return NextResponse.json({ error: "ไม่พบคำขอนี้" }, { status: 404 });
  }
  const signupRequest = requestSnap.data() as ShopSignupRequest;
  if (signupRequest.status !== "pending") {
    return NextResponse.json({ error: "คำขอนี้ถูกดำเนินการไปแล้ว" }, { status: 409 });
  }

  // Authoritative re-check — a slug can be claimed by another approval in between the applicant's
  // submission (or the form's best-effort check) and this review.
  const existingShop = await getShopBySlug(db, finalSlug);
  if (existingShop) {
    return NextResponse.json({ error: "ชื่อ URL นี้มีร้านอื่นใช้แล้ว กรุณาเลือกชื่ออื่น" }, { status: 409 });
  }

  const now = Date.now();
  const shopRef = db.collection(COLLECTIONS.shops).doc();
  const shopId = shopRef.id;

  await shopRef.set({ name: signupRequest.shopName, slug: finalSlug, createdAt: now });

  // Defaults mirrored from `scripts/seed.ts`'s `seedShopAndSettings` — same starting point every
  // shop gets today, just created here instead of by a locally-run script.
  await db.collection(COLLECTIONS.shopSettings).doc(shopId).set({
    shopId,
    name: signupRequest.shopName,
    logoUrl: null,
    phone: signupRequest.phone,
    address: "",
    taxId: "",
    receiptFooterText: "ขอบคุณที่ใช้บริการ",
    currency: "THB",
    theme: "light",
    vatEnabled: false,
    vatRate: 7,
    serviceChargeEnabled: false,
    serviceChargeRate: 0,
    promptPayId: null,
    pickupIdentificationMode: "queue",
    updatedAt: now,
  });

  // SaaS Phase 3: every new shop starts on a free trial, no card required yet — the shop's
  // own admin adds one later at `/billing` (or the trial ends with no card and the shop is
  // auto-suspended by the daily cron, see `lib/billing/billingCron.ts`).
  const billingConfig = await getBillingConfig(db);
  await db.collection(COLLECTIONS.subscriptions).doc(shopId).set({
    shopId,
    status: "trialing",
    trialEndsAt: computeTrialEnd(now, billingConfig.trialDays),
    nextBillingDate: null,
    priceThb: billingConfig.monthlyPriceThb,
    omiseCustomerId: null,
    omiseCardId: null,
    lastChargeStatus: "none",
    lastChargeAt: null,
    lastChargeError: null,
    graceEndsAt: null,
    createdAt: now,
    updatedAt: now,
  });

  const created = await getAdminAuth().createUser({ displayName: adminName });
  try {
    await assignPin(db, shopId, created.uid, pin);
  } catch (error) {
    // Same rollback discipline as `/api/admin/staff` — never leave an orphaned Auth user with no
    // way to log in, and never leave a half-provisioned shop with no admin either, so also
    // clean up the shop/settings/subscription docs just created above.
    await getAdminAuth().deleteUser(created.uid);
    await shopRef.delete();
    await db.collection(COLLECTIONS.shopSettings).doc(shopId).delete();
    await db.collection(COLLECTIONS.subscriptions).doc(shopId).delete();
    if (error instanceof PinConflictError || error instanceof InvalidPinError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    throw error;
  }

  await db.collection(COLLECTIONS.users).doc(created.uid).set({
    shopId,
    name: adminName,
    email: null,
    role: "admin",
    active: true,
    createdAt: now,
  });

  await requestRef.update({
    status: "approved",
    reviewedAt: now,
    approvedShopId: shopId,
    finalSlug,
    assignedAdminUid: created.uid,
    assignedAdminName: adminName,
  });

  return NextResponse.json({ ok: true, shopId, slug: finalSlug, adminName, pin });
}
