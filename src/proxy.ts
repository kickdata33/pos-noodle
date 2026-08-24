import { NextResponse, type NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session";

/**
 * Edge-level first pass (Next.js 16 renamed Middleware to "Proxy" — same mechanism): bounce
 * anyone with no session cookie at all straight to /login, before any protected page even
 * starts rendering. This only checks *presence* — the Admin SDK needed to actually verify the
 * cookie's signature/expiry/revocation and to resolve role/active can't run here, so that real
 * check happens in `getServerSession()` inside the `/admin` and `/pos` layouts (item 29:
 * role-based access, defense in depth — this is only an optimistic check).
 */
export function proxy(request: NextRequest) {
  const hasSession = request.cookies.has(SESSION_COOKIE_NAME);

  if (!hasSession) {
    const loginUrl = new URL("/login", request.url);
    loginUrl.searchParams.set("next", request.nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/admin/:path*", "/pos/:path*"],
};
