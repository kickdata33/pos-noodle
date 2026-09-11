/**
 * Pure hostname parsing for SaaS roadmap Phase 2's per-shop subdomains. Deliberately has zero
 * Firestore/Admin-SDK access — this is the piece that runs in `src/proxy.ts` on every request,
 * and keeping it pure means it's trivially unit-testable and never adds a database round-trip
 * just to serve a static asset. The actual slug→shopId lookup happens separately, in Node-runtime
 * code, via `lib/shop/shopLookupAdmin.ts`.
 *
 * `appDomain` is the platform's own custom domain once the user registers and connects one (env
 * var `NEXT_PUBLIC_APP_DOMAIN`, blank until then). Until it's set, this always returns `null` —
 * every request is treated as the apex/root domain, i.e. today's single-shop behavior, so this
 * feature is safe to ship before the domain exists.
 */
export function extractShopSlug(host: string | null | undefined, appDomain: string | null | undefined): string | null {
  if (!host || !appDomain) return null;

  const normalizedHost = stripPort(host).toLowerCase();
  const normalizedAppDomain = stripPort(appDomain).toLowerCase().replace(/^www\./, "");

  if (!normalizedAppDomain) return null;

  // The apex domain itself (with or without "www.") — no shop, this is the marketing/signup/
  // superadmin surface and the current single-shop fallback.
  if (normalizedHost === normalizedAppDomain || normalizedHost === `www.${normalizedAppDomain}`) {
    return null;
  }

  const suffix = `.${normalizedAppDomain}`;
  if (!normalizedHost.endsWith(suffix)) {
    // localhost, *.vercel.app previews, or any other host that isn't this app's own domain at
    // all — none of these carry a shop subdomain, so fall back to the apex/single-shop behavior
    // rather than guessing.
    return null;
  }

  const subdomain = normalizedHost.slice(0, -suffix.length);
  // Only a single label is a shop slug — `a.b.appdomain.com` isn't a shape this app issues, so
  // treat it the same as "no slug" rather than silently taking the first label and masking a
  // misconfiguration.
  if (subdomain === "" || subdomain.includes(".")) return null;

  return subdomain;
}

function stripPort(host: string): string {
  return host.split(":")[0];
}
