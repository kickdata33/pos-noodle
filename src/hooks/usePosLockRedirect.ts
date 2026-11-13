"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useAuth } from "@/hooks/useAuth";
import { resolveLockedPosPage, type PosPagePath } from "@/lib/pos/posPages";

/**
 * Shared by the two `/pos/*` screens every signed-in staff member could *always* reach before
 * the "locked" account concept existed (`resolveLockedPosPage`): the table grid home (`PosHome`)
 * and the order screen (`OrderScreen`). A locked account — restricted to exactly one secondary
 * page — gets redirected away from both, straight to that one page, with the redirect re-firing
 * on every render until the navigation actually lands (same `router.replace` pattern as
 * `PosPageGate`).
 *
 * Deliberately does not consider `appUser` still loading — `PosHome`/`OrderScreen` already
 * render before `appUser` resolves today (their table/order data comes from
 * `PosCatalogProvider`, not from auth), and gating this on loading too would add a new blank
 * flash to every login, not just a locked one. The cost is a locked account's device may show
 * real content for an instant on first paint before this fires; acceptable since nothing here
 * exposes data a plain `firestore.rules` read wouldn't already allow that account anyway.
 */
export function usePosLockRedirect(): PosPagePath | null {
  const { appUser } = useAuth();
  const router = useRouter();
  const locked = appUser && appUser.role === "staff" ? resolveLockedPosPage(appUser.allowedPosPages) : null;

  useEffect(() => {
    if (locked) router.replace(locked);
  }, [locked, router]);

  return locked;
}
