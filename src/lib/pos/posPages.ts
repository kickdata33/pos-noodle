/**
 * The secondary `/pos/*` screens an Admin can restrict per staff member
 * (`AppUser.allowedPosPages`, item: "สิทธิ์การเข้าหน้า" requested so a kitchen-only staff member
 * doesn't also see stock counts, print-station setup, etc). The table-grid home (`/pos`) and the
 * order screen (`/pos/order/[orderId]`) are deliberately NOT in this list — taking and building
 * an order is the one thing every signed-in staff member must always be able to do, restriction
 * or not.
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
