import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { createOmiseCustomer, updateOmiseCustomerCard } from "@/lib/billing/omiseClient";
import { getServerSession } from "@/lib/auth/session";
import type { Subscription } from "@/types";

/**
 * Saves/replaces a shop's card on file (SaaS roadmap Phase 3). The client (`BillingCardForm`)
 * tokenizes the raw card details via Omise.js before this route ever runs — only the resulting
 * `tokn_...` id reaches our server, never a card number.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (session.appUser.role !== "admin") {
    return NextResponse.json({ error: "เฉพาะผู้ดูแลร้านเท่านั้น" }, { status: 403 });
  }

  const body = (await request.json().catch(() => null)) as { omiseToken?: string } | null;
  const omiseToken = body?.omiseToken;
  if (!omiseToken) {
    return NextResponse.json({ error: "missing omiseToken" }, { status: 400 });
  }

  const db = getAdminDb();
  const shopId = session.appUser.shopId;
  const subRef = db.collection(COLLECTIONS.subscriptions).doc(shopId);
  const subSnap = await subRef.get();
  if (!subSnap.exists) {
    return NextResponse.json({ error: "ไม่พบข้อมูลการชำระเงินของร้านนี้" }, { status: 404 });
  }
  const subscription = { id: subSnap.id, ...(subSnap.data() as Omit<Subscription, "id">) };

  const result = subscription.omiseCustomerId
    ? await updateOmiseCustomerCard(subscription.omiseCustomerId, omiseToken)
    : await createOmiseCustomer(omiseToken);

  if (!result.ok || !result.data) {
    return NextResponse.json({ error: result.error?.message ?? "บันทึกบัตรไม่สำเร็จ" }, { status: 400 });
  }

  const now = Date.now();
  const update: Partial<Subscription> = {
    omiseCustomerId: result.data.id,
    omiseCardId: result.data.default_card,
    updatedAt: now,
  };
  // First card added during trial (or recovering from suspension with no prior card): the
  // first real charge happens exactly when the trial ends, not immediately.
  if (subscription.nextBillingDate === null) {
    update.nextBillingDate = subscription.trialEndsAt;
  }
  // Recovering from a failed-charge grace period or a no-card suspension: clear the error/
  // grace state now that a valid card is on file. If they were suspended for no-card, flip
  // back to trialing/active as appropriate so the layout gate lets them back in immediately.
  if (subscription.status === "suspended" || subscription.status === "past_due") {
    update.status = subscription.trialEndsAt > now ? "trialing" : "active";
    update.graceEndsAt = null;
    update.lastChargeError = null;
    if (update.status === "active" && subscription.nextBillingDate === null) {
      update.nextBillingDate = now; // overdue trial, card just added — charge on next cron run
    }
  }

  await subRef.update(update);
  return NextResponse.json({ ok: true });
}
