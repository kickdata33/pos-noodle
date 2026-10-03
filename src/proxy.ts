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
 *
 * These two used to be an if/else — the `/admin`/`/pos` branch returned before job 2 ever ran,
 * so an already-logged-in request to those paths never got `x-shop-slug` set at all. No current
 * `/admin`/`/pos` code reads that header (they key everything off the signed-in user's own
 * `shopId` instead — see `getServerSession()`), so this had no live symptom, but it's exactly the
 * kind of silent gap that caused the real cross-tenant leak (see `hostname.ts`'s own comment):
 * the header is now computed once, up front, and attached to every response this proxy returns.
 */
export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  const slug = extractShopSlug(request.headers.get("host"), process.env.NEXT_PUBLIC_APP_DOMAIN);
  const requestHeaders = slug ? new Headers(request.headers) : null;
  requestHeaders?.set(SHOP_SLUG_HEADER, slug!);
  const next = () => (requestHeaders ? NextResponse.next({ request: { headers: requestHeaders } }) : NextResponse.next());

  if (pathname.startsWith("/admin") || pathname.startsWith("/pos")) {
    const hasSession = request.cookies.has(SESSION_COOKIE_NAME);
    if (!hasSession) {
      const loginUrl = new URL("/login", request.url);
      loginUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(loginUrl);
    }
    return next();
  }

  return next();
}

export const config = {
  // `manifest.webmanifest` (née the static `manifest.json`) is deliberately NOT excluded here —
  // it's now a dynamic route (`app/manifest.ts`) that reads the `x-shop-slug` header this proxy
  // sets, to show each shop's own name on its installed PWA icon (SaaS roadmap: "ทำให้เป็นกลาง
  // สำหรับร้านทั่วไป"). Everything else below is a genuinely static asset that never needs it.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|apple-icon.png|sw.js).*)"],
};
