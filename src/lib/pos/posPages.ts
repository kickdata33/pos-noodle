/**
 * The secondary `/pos/*` screens an Admin can restrict per staff member
 * (`AppUser.allowedPosPages`, item: "สิทธิ์การเข้าหน้า" requested so a kitchen-only staff member
 * doesn't also see stock counts, print-station setup, etc). The table-grid home (`/pos`) and the
 * order screen (`/pos/order/[orderId]`) are NOT in this list — ordinarily every signed-in staff
 * member can always reach them, restriction or not. The exception is a *locked* account (see
 * `resolveLockedPosPage` below): a staff account restricted to exactly one page here is sent
 * straight to it and barred from both of those too — see that function's comment.
 *
 * `path` doubles as the stable key stored in `AppUser.allowedPosPages` (no separate id needed,
 * and it reads directly as the thing it gates when you're looking at a staff doc in Firestore).
 */
export const POS_SECONDARY_PAGES = [
  { path: "/pos/kitchen", label: "หน้าจอครัว" },
  { path: "/pos/history", label: "ประวัติออเดอร์" },
  { path: "/pos/stock", label: "ของหมด" },
  { path: "/pos/inventory", label: "สต๊อก" },
  { path: "/pos/alert-voice", label: "เสียงแจ้งเตือน" },
  { path: "/pos/print-station", label: "สถานีพิมพ์" },
] as const;

export type PosPagePath = (typeof POS_SECONDARY_PAGES)[number]["path"];

/**
 * `allowedPosPages` is stored as a plain `string[]` on `AppUser` (same looseness as
 * `Product.modifierGroupIds`, not a typed union) so a future removed/renamed page here never
 * makes an old stored value a type error — it just stops matching anything, harmlessly.
 *
 * `null`/`undefined` means unrestricted: every secondary page is visible. This is the default
 * for every account created before this feature existed and for any account an Admin hasn't
 * deliberately narrowed, so shipping this never silently locks an existing staff member out of
 * a page they already use.
 */
export function canSeePosPage(allowedPosPages: string[] | null | undefined, path: PosPagePath): boolean {
  if (!allowedPosPages) return true;
  return allowedPosPages.includes(path);
}

/**
 * A staff account restricted to exactly one secondary page (ticked via the single-page case of
 * the "สิทธิ์การเข้าหน้า" dialog) is treated as *locked* to it — e.g. a dedicated kitchen tablet
 * that has no business ever showing the table grid. A locked account is sent straight to this
 * page on login and barred from everywhere else under `/pos/*`, including the table grid home
 * and the order screen, with no way back short of signing out (confirmed explicitly: "เด้งตรงไป
 * หน้านั้น + ล็อกไว้เลย" — direct landing *and* a hard lock, not just a default).
 *
 * Returns `null` — "not locked, use the table grid as normal" — for every other case: no
 * restriction, or restricted to two or more pages (there's a real choice to make, so the table
 * grid with its filtered links still makes sense). Also `null` if the one stored page no longer
 * matches anything in `POS_SECONDARY_PAGES` (e.g. a page removed/renamed after being set) —
 * otherwise a stale value here would lock someone to a dead end with no escape.
 */
export function resolveLockedPosPage(allowedPosPages: string[] | null | undefined): PosPagePath | null {
  if (!allowedPosPages || allowedPosPages.length !== 1) return null;
  const [only] = allowedPosPages;
  const known = POS_SECONDARY_PAGES.some((p) => p.path === only);
  return known ? (only as PosPagePath) : null;
}
