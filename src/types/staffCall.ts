import type { EpochMillis, WithId } from "./common";

/**
 * A dine-in customer tapping "เรียกพนักงาน" on their own QR ordering screen (item: ปุ่มเรียก
 * พนักงาน/เช็คบิล, เปิดได้แยกจาก "เช็คบิล") — created by `/api/customer/table/[tableId]/call-staff`
 * (Admin SDK; customers aren't signed in, so this never goes through `firestore.rules`'s normal
 * client-write path) the moment nothing is already active for that table. Read live by every
 * staff/admin account permitted to see it (`AppUser.canReceiveStaffCalls`, or any `admin` —
 * see `lib/pos/customerRequests.ts`) via `PosCustomerRequestBanner`, which also blinks that
 * table's card on `PosHome`.
 *
 * Deliberately tied to the *table*, not an order — a customer can want staff's attention before
 * ordering anything at all (confirmed: "ผูกกับโต๊ะ"), unlike "เช็คบิล" which only makes sense once
 * a bill exists (see `Order.customerCheckBillRequestedAt` instead, a field on the order itself).
 *
 * Resolution mirrors `ServeCall`: first staff member to tap "รับเรื่อง" wins (`resolvedAt` set in
 * a transaction — `staffCallRepository.resolve`), which clears it off every other screen at once
 * (confirmed: "เคลียร์ออกทันทีหลังคนแรกกดรับ").
 */
export interface StaffCall extends WithId {
  shopId: string;
  tableId: string;
  /** Snapshot of the table's name at the moment of the call — same reasoning as every other
   * "name at creation time" snapshot in this codebase (e.g. `Order.tableName`). */
  tableName: string;
  createdAt: EpochMillis;
  resolvedAt: EpochMillis | null;
  resolvedById: string | null;
  resolvedByName: string | null;
}
