import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { PosCatalogProvider } from "@/components/pos/PosCatalogContext";
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
      <div className="flex min-h-full flex-col">
        {session.subscription?.status === "past_due" && (
          <SuspensionBanner daysLeft={graceDaysLeft} />
        )}
        <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
          <p className="font-medium">{session.appUser.name}</p>
          <SignOutButton />
        </header>
        <div className="flex-1">{children}</div>
      </div>
    </PosCatalogProvider>
  );
}
