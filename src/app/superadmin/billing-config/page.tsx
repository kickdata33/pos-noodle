import { redirect } from "next/navigation";

import { BillingConfigForm } from "@/components/superadmin/BillingConfigForm";
import { getBillingConfig } from "@/lib/billing/billingConfig";
import { getAdminDb } from "@/lib/firebase/admin";
import { hasSuperadminSession } from "@/lib/superadmin/session";

/** Superadmin page for editing the platform's trial-days/monthly-price config (SaaS roadmap
 * Phase 3) — the reason this lives in Firestore rather than an env var: changeable here, at
 * runtime, no redeploy. */
export default async function BillingConfigPage() {
  if (!(await hasSuperadminSession())) redirect("/superadmin/login");

  const config = await getBillingConfig(getAdminDb());

  return (
    <main className="mx-auto max-w-md p-4 sm:p-6">
      <h1 className="mb-4 text-lg font-semibold">ตั้งค่าราคา</h1>
      <BillingConfigForm config={config} />
    </main>
  );
}
