import Link from "next/link";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { PosCatalogProvider } from "@/components/pos/PosCatalogContext";
import { PosOrderAlertListener } from "@/components/pos/PosOrderAlertListener";
import { PrintStatusBanner } from "@/components/pos/PrintStatusBanner";
import { ServeCallAlert } from "@/components/pos/ServeCallAlert";
import { Button } from "@/components/ui/button";
import { SignOutButton } from "@/components/shared/SignOutButton";
import { SuspensionBanner } from "@/components/shared/SuspensionBanner";
import { getServerSession } from "@/lib/auth/session";

/**
 * Access gate for /pos — any active, signed-in user (admin or staff) may use the POS (item 17).
 * Also mounts `PosCatalogProvider` once here, so its Firestore subscriptions (products,
 * categories, modifiers, channels, tables, payment methods, settings) survive every `/pos/*`
 * navigation instead of every page re-subscribing to all of it from scratch — see that
 * provider's own comment for why this was worth doing (a real, reported navigation lag).
 */
export default async function PosLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  // Forced first-PIN-change (AppUser.mustChangePin) — belt-and-suspenders alongside /login's own
  // redirect there, so someone can't reach /pos on a still-temporary PIN by hitting Back or a
  // bookmark instead of going through the login screen.
  if (session.appUser.mustChangePin) redirect(`/set-pin?role=${session.appUser.role}`);
  // SaaS Phase 3: same suspension gate as /admin — see that layout's comment.
  if (session.subscription?.status === "suspended") redirect("/suspended");

  // Server Component, see admin/layout.tsx's identical comment.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const graceDaysLeft = session.subscription?.graceEndsAt
    ? Math.max(0, Math.ceil((session.subscription.graceEndsAt - now) / (24 * 60 * 60 * 1000)))
    : null;

  return (
    <PosCatalogProvider shopId={session.appUser.shopId}>
      <PosOrderAlertListener />
      <div className="flex min-h-full flex-col">
        {session.subscription?.status === "past_due" && (
          <SuspensionBanner daysLeft={graceDaysLeft} />
        )}
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <p className="font-medium">{session.appUser.name}</p>
          <div className="flex items-center gap-2">
            {/* Toggle back to Admin — same "สลับไปสลับมาได้เลย" button as admin/layout.tsx's own
             * comment. Admin-only: a locked staff account (see PosHome/OrderScreen's
             * usePosLockRedirect) never gets this far with a choice to make anyway, but hiding
             * it from every non-admin avoids a dead "ไปหน้า Admin" link that just bounces staff
             * straight back here via /admin/layout.tsx's own role gate. */}
            {session.appUser.role === "admin" ? (
              <Button asChild variant="outline" size="sm">
                <Link href="/admin">ไปหน้า Admin</Link>
              </Button>
            ) : null}
            <SignOutButton />
          </div>
        </header>
        <PrintStatusBanner />
        <ServeCallAlert />
        <div className="flex-1">{children}</div>
      </div>
    </PosCatalogProvider>
  );
}
