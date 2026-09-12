import { redirect } from "next/navigation";

import { BillingStatusView } from "@/components/billing/BillingStatusView";
import { getServerSession } from "@/lib/auth/session";
import { getBillingConfig } from "@/lib/billing/billingConfig";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { PaymentSlip } from "@/types";

/**
 * Shop-facing billing page (SaaS roadmap Phase 3) — deliberately a top-level route, NOT nested
 * under `/admin/layout.tsx`, so it stays reachable even when a shop's subscription status is
 * `suspended` (that layout redirects everything else to `/suspended`). This is the only way a
 * suspended shop recovers access on its own, besides a superadmin manual override.
 */
export default async function BillingPage() {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (session.appUser.role !== "admin") redirect("/pos");

  const db = getAdminDb();
  const shopId = session.appUser.shopId;
  const [billingConfig, slipsSnap] = await Promise.all([
    getBillingConfig(db),
    db.collection(COLLECTIONS.paymentSlips).where("shopId", "==", shopId).orderBy("submittedAt", "desc").get(),
  ]);
  const slips = slipsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PaymentSlip, "id">) }));

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-lg font-semibold">การชำระเงิน</h1>
      <BillingStatusView subscription={session.subscription} billingConfig={billingConfig} slips={slips} />
    </main>
  );
}
