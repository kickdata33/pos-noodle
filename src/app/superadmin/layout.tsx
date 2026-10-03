import type { ReactNode } from "react";

import { SuperadminNav } from "@/components/superadmin/SuperadminNav";
import { hasSuperadminSession } from "@/lib/superadmin/session";

/**
 * Shared layout for the whole /superadmin console. Until now, the three authenticated pages
 * here (signup requests at /superadmin, billing status + admin-PIN reset at /superadmin/
 * subscriptions, pricing at /superadmin/billing-config) had no link between them at all — the
 * only way from one to another was typing/remembering its URL directly (feedback: "หน้า super
 * admin ควรจะมีครบหมดสำหรับผู้ดูแล ไม่ควรแยกหลายลิงก์ จำไม่ได้"). `SuperadminNav` is now a
 * shared tab bar across all three.
 *
 * Deliberately checks the session here instead of using a route group to exclude
 * `/superadmin/login` from the nav: every one of those three pages already redirects to
 * `/superadmin/login` itself (server-side) when there's no valid session, so by the time any of
 * them actually renders, a session is guaranteed — this check only ever meaningfully resolves to
 * "no nav" for the login page itself (the one page under /superadmin with no session check of
 * its own, since there's nothing to protect there yet).
 */
export default async function SuperadminLayout({ children }: { children: ReactNode }) {
  const authed = await hasSuperadminSession();
  if (!authed) return <>{children}</>;

  return (
    <>
      <SuperadminNav />
      {children}
    </>
  );
}
