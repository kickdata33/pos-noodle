import { redirect } from "next/navigation";
import type { ReactNode } from "react";

import { AdminNav } from "@/components/admin/AdminNav";
import { SignOutButton } from "@/components/shared/SignOutButton";
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

  return (
    <div className="flex min-h-full flex-col">
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
