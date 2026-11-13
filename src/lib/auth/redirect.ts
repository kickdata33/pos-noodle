/**
 * Where to send someone right after they finish signing in — shared by `/login` and `/set-pin`
 * (the forced first-PIN-change screen), so both resolve a `?next=` the same, safe way.
 *
 * `next` is the page `src/proxy.ts` bounced them from before they even reached a login/PIN
 * screen (e.g. an admin who opened `/pos` directly while logged out used to always land back on
 * `/admin` afterwards, no matter which page they actually wanted — this is the fix). Deliberately
 * narrow: only ever returns `/admin` or `/pos` (with an optional sub-path), never anything else,
 * so a crafted `?next=` query param can't be used to redirect a freshly-authenticated session to
 * an arbitrary URL. Staff never get sent to `/admin` even if `next` says so — `role === "admin"`
 * (item 17) still applies, and `/admin/layout.tsx`'s own gate would just bounce them right back
 * out anyway.
 */
export function resolveRedirect(next: string | null, role: "admin" | "staff"): string {
  const allowedPrefix = role === "admin" ? ["/admin", "/pos"] : ["/pos"];
  if (next && allowedPrefix.some((prefix) => next === prefix || next.startsWith(`${prefix}/`))) {
    return next;
  }
  return role === "admin" ? "/admin" : "/pos";
}
