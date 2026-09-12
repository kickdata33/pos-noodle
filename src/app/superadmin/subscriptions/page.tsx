import { redirect } from "next/navigation";

import { SubscriptionsConsole } from "@/components/superadmin/SubscriptionsConsole";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { hasSuperadminSession } from "@/lib/superadmin/session";
import type { Shop, Subscription } from "@/types";

/** Superadmin's per-shop billing status view (SaaS roadmap Phase 3) — kept as its own page,
 * separate from `/superadmin` (the signup-requests review console), so that list doesn't get
 * cluttered. */
export default async function SubscriptionsPage() {
  if (!(await hasSuperadminSession())) redirect("/superadmin/login");

  const db = getAdminDb();
  const [subsSnap, shopsSnap] = await Promise.all([
    db.collection(COLLECTIONS.subscriptions).orderBy("createdAt", "desc").get(),
    db.collection(COLLECTIONS.shops).get(),
  ]);
  const shopById = new Map(shopsSnap.docs.map((d) => [d.id, { id: d.id, ...(d.data() as Omit<Shop, "id">) }]));
  const subscriptions = subsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Subscription, "id">) }));
  const rows = subscriptions.map((sub) => ({ subscription: sub, shop: shopById.get(sub.shopId) ?? null }));

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="mb-4 text-lg font-semibold">สถานะการชำระเงินของร้าน</h1>
      <SubscriptionsConsole rows={rows} />
    </main>
  );
}
