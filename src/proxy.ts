import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { SESSION_COOKIE_NAME } from "@/lib/auth/session";
import { extractShopSlug } from "@/lib/shop/hostname";
import { SHOP_SLUG_HEADER } from "@/lib/shop/shopLookupAdmin";

/**
 * Runs on every request except static assets (see `config.matcher`). This file is `proxy.ts`,
 * not `middleware.ts` — Next.js 16 renamed the convention (see
 * node_modules/next/dist/docs/.../proxy.md); functionality is the same.
 *
 * Two independent jobs, both cheap/pure (no Firestore access here even though Proxy defaults to
 * the Node.js runtime in this Next version — a shop's actual slug→shopId lookup only needs to
 * happen once, in whichever Server Component/API route actually needs `shopId` for that request,
 * `lib/shop/shopLookupAdmin.ts`):
 *
 * 1. **Session presence gate for `/admin` and `/pos`** (unchanged from before Phase 2): bounce
 *    anyone with no session cookie at all straight to `/login`, before any protected page even
 *    starts rendering. Only checks *presence* — the Admin SDK needed to actually verify the
 *    cookie's signature/expiry/revocation and to resolve role/active can't run here, so that real
 *    check happens in `getServerSession()` inside the `/admin` and `/pos` layouts (item 29:
 *    role-based access, defense in depth — this is only an optimistic check).
 * 2. **Shop-slug header for everything else** (SaaS roadmap Phase 2): sets `x-shop-slug` from the
 *    request's Host when it looks like `{slug}.<app domain>`. Never redirects or blocks on this —
 *    worst case a route sees no header and falls back to the single-shop default, exactly like
 *    before Phase 2, so a bug here can't lock anyone out.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (pathname.startsWith("/admin") || pathname.startsWith("/pos")) {
    const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
    if (!hasSession) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return NextResponse.next();
  }

  const slug = extractShopSlug(request.headers.get("host"), process.env.NEXT_PUBLIC_APP_DOMAIN);
  if (!slug) return NextResponse.next();

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set(SHOP_SLUG_HEADER, slug);
  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|apple-icon.png|manifest.json|sw.js).*)"],
};
