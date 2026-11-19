import type { AppUser } from "@/types";

/**
 * Who sees a dine-in customer's "เรียกพนักงาน"/"เช็คบิล" request on the POS (the blinking table
 * card, the floating banner, the alert sound) — the shop's confirmed choice when this shipped
 * was "admin หรือ ไอดีที่ตั้งสิทธิ์ไว้เท่านั้น": every `admin` account always sees both kinds,
 * regardless of the per-field flags below, and a `staff` account sees only what an Admin
 * explicitly ticked for them (`AppUser.canReceiveStaffCalls`/`canReceiveBillRequests`). Pure so
 * `PosCustomerRequestBanner` and `PosHome`'s table-card blink can share one source of truth
 * instead of re-deriving "is this an admin, or did someone tick the box" in two places.
 */
export function canReceiveStaffCalls(
  user: Pick<AppUser, "role" | "canReceiveStaffCalls"> | null | undefined
): boolean {
  if (!user) return false;
  return user.role === "admin" || user.canReceiveStaffCalls === true;
}

/** Same reasoning as `canReceiveStaffCalls`, for "เช็คบิล" requests — a separate flag/function
 * since a shop may grant each permission to a different set of people. */
export function canReceiveBillRequests(
  user: Pick<AppUser, "role" | "canReceiveBillRequests"> | null | undefined
): boolean {
  if (!user) return false;
  return user.role === "admin" || user.canReceiveBillRequests === true;
}
