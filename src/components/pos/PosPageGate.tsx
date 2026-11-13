"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/hooks/useAuth";
import { canSeePosPage, type PosPagePath } from "@/lib/pos/posPages";

/**
 * Page-level guard for the secondary `/pos/*` screens an Admin can restrict per staff member
 * (`AppUser.allowedPosPages`) — same defense-in-depth role `ModuleGate` plays for the Admin-only
 * modules: `PosHome`'s own nav already hides a link the signed-in user can't use, so this is
 * only reached by someone typing the URL directly (a bookmark, a shared link) or a stale link
 * from before an Admin narrowed their access.
 *
 * Renders nothing while `appUser` is still loading or once a redirect is underway, so a page the
 * account isn't allowed to see never flashes its content before bouncing back to `/pos`.
 */
export function PosPageGate({ page, children }: { page: PosPagePath; children: React.ReactNode }) {
  const { appUser, loading } = useAuth();
  const router = useRouter();
  const allowed = appUser ? canSeePosPage(appUser.allowedPosPages, page) : false;

  useEffect(() => {
    if (!loading && appUser && !allowed) router.replace("/pos");
  }, [loading, appUser, allowed, router]);

  if (loading || !appUser || !allowed) return null;
  return <>{children}</>;
}
