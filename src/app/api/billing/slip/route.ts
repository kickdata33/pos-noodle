import { NextResponse, type NextRequest } from "next/server";

import { MAX_DATA_URL_LENGTH } from "@/lib/billing/compressImage";
import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { PaymentSlip } from "@/types";

/**
 * A shop submits a bank-transfer/PromptPay payment slip for manual review (SaaS roadmap
 * Phase 3 — bank-transfer alternative to Omise, confirmed with the user: no OCR/auto-verify,
 * a human — the superadmin — looks at every slip). The image was already compressed client-side
 * (`compressImageFile`) before reaching this route; re-checked here too since a client-side
 * limit is only ever a courtesy, never something the server can trust.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.appUser.role !== "admin") {
    return NextResponse.json({ error: "เฉพาะผู้ดูแลร้านเท่านั้น" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as {
    amountThb?: number;
    slipImage?: string;
    note?: string;
  } | null;
  const amountThb = body?.amountThb;
  const slipImage = body?.slipImage;
  const note = body?.note?.trim() || null;

  if (typeof amountThb !== "number" || !Number.isFinite(amountThb) || amountThb <= 0) {
    return NextResponse.json({ error: "จำนวนเงินไม่ถูกต้อง" }, { status: 400 });
  }
  if (typeof slipImage !== "string" || !slipImage.startsWith("data:image/")) {
    return NextResponse.json({ error: "ไม่พบรูปสลิป" }, { status: 400 });
  }
  if (slipImage.length > MAX_DATA_URL_LENGTH) {
    return NextResponse.json({ error: "ไฟล์รูปภาพใหญ่เกินไป กรุณาถ่ายใหม่หรือเลือกรูปอื่น" }, { status: 400 });
  }

  const db = getAdminDb();
  const shopId = session.appUser.shopId;
  const subSnap = await db.collection(COLLECTIONS.subscriptions).doc(shopId).get();
  if (!subSnap.exists) {
    return NextResponse.json({ error: "ไม่พบข้อมูลการชำระเงินของร้านนี้" }, { status: 404 });
  }

  const now = Date.now();
  const slip: Omit<PaymentSlip, "id"> = {
    shopId,
    amountThb,
    slipImage,
    note,
    status: "pending",
    submittedAt: now,
    reviewedAt: null,
    reviewNote: null,
  };
  const ref = await db.collection(COLLECTIONS.paymentSlips).add(slip);
  return NextResponse.json({ ok: true, id: ref.id });
}
