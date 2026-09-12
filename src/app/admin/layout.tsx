import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AdminNav } from "@/components/admin/AdminNav";
import { SignOutButton } from "@/components/shared/SignOutButton";
import { SuspensionBanner } from "@/components/shared/SuspensionBanner";
import { getServerSession } from "@/lib/auth/session";

/**
 * Real access gate for everything under /admin (item 17: only `role === "admin"` gets in).
 * Staff who somehow reach here (e.g. a stale bookmark) are sent to /pos, not /login, since
 * they *are* validly signed in — just not authorized for this area.
 *
 * Unlike the Staff POS, /admin is NOT touch/tablet-first (item 26's constraints target the
 * staff screens); a denser conventional dashboard with a sidebar is appropriate here.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await getServerSession();
  if (!session) redirect("/login");
  if (session.appUser.role !== "admin") redirect("/pos");
  // SaaS Phase 3: a suspended shop is locked out of everything except /billing (which isn't
  // nested under this layout, so a suspended admin can still reach it to recover access).
  if (session.subscription?.status === "suspended") redirect("/suspended");

  // This is a Server Component: rendered once per request server-side, not re-rendered
  // client-side, so a per-request "now" here can't produce the hydration-mismatch class of bug
  // the purity rule guards against.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const graceDaysLeft = session.subscription?.graceEndsAt
    ? Math.max(0, Math.ceil((session.subscription.graceEndsAt - now) / (24 * 60 * 60 * 1000)))
    : null;

  return (
    <div className="flex min-h-full flex-col">
      {session.subscription?.status === "past_due" && (
        <SuspensionBanner daysLeft={graceDaysLeft} />
      )}
      <header className="flex items-center justify-between border-b border-border bg-card px-4 py-3">
        <div>
          <p className="text-sm text-muted-foreground">Admin</p>
          <p className="font-medium">{session.appUser.name}</p>
        </div>
        <SignOutButton />
      </header>
      <div className="flex flex-1 flex-col sm:flex-row">
        <AdminNav />
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
