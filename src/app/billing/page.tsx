import { redirect } from "next/navigation";

import { BillingStatusView } from "@/components/billing/BillingStatusView";
import { getServerSession } from "@/lib/auth/session";

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

  return (
    <main className="mx-auto max-w-md p-6">
      <h1 className="mb-4 text-lg font-semibold">การชำระเงิน</h1>
      <BillingStatusView subscription={session.subscription} />
    </main>
  );
}
