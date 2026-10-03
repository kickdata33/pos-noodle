import { redirect } from "next/navigation";

import { SubscriptionsConsole } from "@/components/superadmin/SubscriptionsConsole";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { resolveEnabledModules } from "@/lib/shop/modules";
import { hasSuperadminSession } from "@/lib/superadmin/session";
import type { PaymentSlip, Shop, ShopSettings, Subscription } from "@/types";

/** Superadmin's per-shop billing status view (SaaS roadmap Phase 3) — kept as its own page,
 * separate from `/superadmin` (the signup-requests review console), so that list doesn't get
 * cluttered. Also surfaces every `pending` bank-transfer slip (Phase 3 bank-transfer
 * alternative) so the superadmin can approve/reject them from the same place they see the
 * shop's overall billing status. */
export default async function SubscriptionsPage() {
  if (!(await hasSuperadminSession())) redirect("/superadmin/login");

  const db = getAdminDb();
  const [subsSnap, shopsSnap, slipsSnap, shopSettingsSnap] = await Promise.all([
    db.collection(COLLECTIONS.subscriptions).orderBy("createdAt", "desc").get(),
    db.collection(COLLECTIONS.shops).get(),
    // No status filter here (avoids needing a second composite index just for this) — small
    // scale, so filtering to "pending" happens in the component instead.
    db.collection(COLLECTIONS.paymentSlips).orderBy("submittedAt", "desc").get(),
    // Needed for the per-shop module toggles (SaaS roadmap: "ทำให้เป็นกลางสำหรับร้านทั่วไป") —
    // see `lib/shop/modules.ts`.
    db.collection(COLLECTIONS.shopSettings).get(),
  ]);
  const shopById = new Map(shopsSnap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Omit<Shop, "id">) }]));
  const subscriptions = subsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subscription, "id">) }));
  const slips = slipsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PaymentSlip, "id">) }));
  const settingsByShopId = new Map(
    shopSettingsSnap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Omit<ShopSettings, "id">) }])
  );
  const slipsByShopId = new Map<string, PaymentSlip[]>();
  for (const slip of slips) {
    if (slip.status !== "pending") continue;
    slipsByShopId.set(slip.shopId, [...(slipsByShopId.get(slip.shopId) ?? []), slip]);
  }
  const rows = subscriptions.map((sub) => ({
    subscription: sub,
    shop: shopById.get(sub.shopId) ?? null,
    pendingSlips: slipsByShopId.get(sub.shopId) ?? [],
    enabledModules: resolveEnabledModules(settingsByShopId.get(sub.shopId)?.enabledModules),
  }));

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="mb-4 text-lg font-semibold">สถานะการชำระเงินของร้าน</h1>
      <SubscriptionsConsole rows={rows} />
    </main>
  );
}
