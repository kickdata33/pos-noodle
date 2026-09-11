import { redirect } from "next/navigation";

import { SignupRequestsConsole } from "@/components/superadmin/SignupRequestsConsole";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { hasSuperadminSession } from "@/lib/superadmin/session";
import type { ShopSignupRequest } from "@/types";

/**
 * Shop-signup review console (SaaS roadmap Phase 2) — the small, phone-usable web page the user
 * asked for instead of a CLI script. Fetches directly via the Admin SDK (Server Component, same
 * as every other server-only page in this app) rather than adding a separate GET route just for
 * this one initial load.
 */
export default async function SuperadminPage() {
  if (!(await hasSuperadminSession())) redirect("/superadmin/login");

  const snap = await getAdminDb()
    .collection(COLLECTIONS.shopSignupRequests)
    .orderBy("createdAt", "desc")
    .get();
  const requests = snap.docs.map((d) => ({ ...d.data(), id: d.id }) as ShopSignupRequest);

  return (
    <main className="mx-auto max-w-2xl p-4 sm:p-6">
      <h1 className="mb-4 text-lg font-semibold">คำขอสมัครร้านใหม่</h1>
      <SignupRequestsConsole requests={requests} />
    </main>
  );
}
