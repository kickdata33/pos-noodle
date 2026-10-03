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
  if (!host) return null;

  const normalizedHost = stripPort(host).toLowerCase();

  if (!appDomain) {
    // `NEXT_PUBLIC_APP_DOMAIN` unset → every host falls back to the single-shop default, which
    // is the correct, documented behavior before the domain exists or on localhost/a Vercel
    // preview (`isKnownSluglessHost` below). But on any OTHER host — e.g. a real shop subdomain
    // like "cake.ranpos.online" — that same silent fallback means the request gets treated as
    // `DEFAULT_SHOP_ID` (the original shop) instead of its own shop: a cross-tenant data leak
    // with no visible symptom except the wrong shop's data quietly showing up, which is exactly
    // what happened in production (the var was missing/stale on the live deployment — note
    // `NEXT_PUBLIC_*` vars are baked in at *build* time, so adding one in Vercel's dashboard
    // needs a fresh build, not just a redeploy, before it takes effect). Logging here changes no
    // behavior (still returns `null`, same as before) — it just gives this failure mode a visible
    // signal instead of none at all.
    if (!isKnownSluglessHost(normalizedHost)) {
      console.error(
        `[shop-slug] NEXT_PUBLIC_APP_DOMAIN is not set — host "${normalizedHost}" cannot be checked ` +
          "for a shop subdomain and is being treated as the single-shop default (DEFAULT_SHOP_ID). " +
          "If this host should resolve to its own shop, set NEXT_PUBLIC_APP_DOMAIN in Vercel and " +
          "trigger a fresh build (NEXT_PUBLIC_* vars are inlined at build time)."
      );
    }
    return null;
  }

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

/** Hosts that are *expected* to have no shop subdomain even once `NEXT_PUBLIC_APP_DOMAIN` is
 * properly set — local dev and Vercel's own preview URLs. Anything else reaching the
 * `!appDomain` branch above is a real host in the wild, worth logging. */
function isKnownSluglessHost(normalizedHost: string): boolean {
  return (
    normalizedHost === "localhost" ||
    normalizedHost === "127.0.0.1" ||
    normalizedHost.endsWith(".localhost") ||
    normalizedHost.endsWith(".vercel.app")
  );
}
