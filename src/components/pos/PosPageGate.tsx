"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/hooks/useAuth";
import { canSeePosPage, resolveLockedPosPage, type PosPagePath } from "@/lib/pos/posPages";

/**
 * Page-level guard for the secondary `/pos/*` screens an Admin can restrict per staff member
 * (`AppUser.allowedPosPages`) — same defense-in-depth role `ModuleGate` plays for the Admin-only
 * modules: `PosHome`'s own nav already hides a link the signed-in user can't use, so this is
 * only reached by someone typing the URL directly (a bookmark, a shared link) or a stale link
 * from before an Admin narrowed their access.
 *
 * Bounces to the account's locked page (`resolveLockedPosPage`) when it has one — a kitchen-only
 * account hitting `/pos/stock` lands back on `/pos/kitchen`, never on the table grid it's barred
 * from — and to `/pos` otherwise, same as before this existed.
 *
 * Renders nothing while `appUser` is still loading or once a redirect is underway, so a page the
 * account isn't allowed to see never flashes its content before bouncing away.
 */
export function PosPageGate({ page, children }: { page: PosPagePath; children: React.ReactNode }) {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const allowed = appUser ? canSeePosPage(appUser.allowedPosPages, page) : false;
  const fallback = resolveLockedPosPage(appUser?.allowedPosPages) ?? "/pos";

  useEffect(() => {
    if (!loading && appUser && !allowed) router.replace(fallback);
  }, [loading, appUser, allowed, fallback, router]);

  if (loading || !appUser || !allowed) return null;
  return <>{children}</>;
}
