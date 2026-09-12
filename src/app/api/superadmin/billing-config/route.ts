import { NextResponse, type NextRequest } from "next/server";

import { BILLING_CONFIG_DOC_ID } from "@/lib/billing/billingConfig";
import { MAX_DATA_URL_LENGTH } from "@/lib/billing/compressImage";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { SUPERADMIN_COOKIE_NAME, verifySessionToken } from "@/lib/superadmin/session";
import type { BillingConfig } from "@/types";

/** Edits the platform's trial-days/monthly-price/bank-transfer config (SaaS roadmap Phase 3) —
 * the whole point of storing this in Firestore instead of an env var: the superadmin changes it
 * here, at runtime, no redeploy. The bank fields (SaaS roadmap Phase 3 bank-transfer
 * alternative) are optional — an empty `bankAccountNumber` just hides the transfer option on
 * `/billing`, it's not a validation error. */
export async function POST(request: NextRequest) {
  if (!verifySessionToken(request.cookies.get(SUPERADMIN_COOKIE_NAME)?.value)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await request.json().catch(() => null)) as {
    trialDays?: number;
    monthlyPriceThb?: number;
    bankAccountName?: string;
    bankName?: string;
    bankAccountNumber?: string;
    qrCodeImage?: string | null;
  } | null;
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

  const qrCodeImage = body?.qrCodeImage ?? null;
  if (qrCodeImage !== null) {
    if (typeof qrCodeImage !== "string" || !qrCodeImage.startsWith("data:image/")) {
      return NextResponse.json({ error: "รูป QR ไม่ถูกต้อง" }, { status: 400 });
    }
    if (qrCodeImage.length > MAX_DATA_URL_LENGTH) {
      return NextResponse.json({ error: "ไฟล์รูป QR ใหญ่เกินไป" }, { status: 400 });
    }
  }

  const update: Omit<BillingConfig, "id"> = {
    trialDays,
    monthlyPriceThb,
    bankAccountName: (body?.bankAccountName ?? "").trim(),
    bankName: (body?.bankName ?? "").trim(),
    bankAccountNumber: (body?.bankAccountNumber ?? "").trim(),
    qrCodeImage,
    updatedAt: Date.now(),
  };

  await getAdminDb().collection(COLLECTIONS.billingConfig).doc(BILLING_CONFIG_DOC_ID).set(update, { merge: true });

  return NextResponse.json({ ok: true });
}
