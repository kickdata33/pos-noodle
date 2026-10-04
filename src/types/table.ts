import type { EpochMillis, WithId } from "./common";

/** A physical table. Count/names are fully Admin-managed — never hardcoded (item 13, 34). */
export interface Table extends WithId {
  shopId: string;
  name: string;
  sortOrder: number;
  /** false = temporarily closed (item 13 "ปิดโต๊ะชั่วคราว") — hidden from the POS table grid. */
  active: boolean;
  createdAt: EpochMillis;
  /**
   * How this table's self-order QR behaves (item: "ลูกค้าแอบถ่ายรูป QR แล้วสั่งทีหลังได้ไหม").
   * `"static"` (or unset — every table before this field existed reads as static, no migration
   * needed) is today's original behavior: the QR printed on the table encodes a permanent link
   * that works forever, no matter who scans it or when.
   *
   * `"session"` closes that gap: ordering requires a `sessionToken` matching the table's current
   * one (see `sessionToken` below), which staff (re)generate from `/admin/tables` or the POS
   * floor view (`PosHome`) each time they seat a party, and which `OrderScreen`'s checkout/cancel
   * handlers clear back to `null` the moment the bill closes (`/api/pos/tables/[id]/close-
   * session`) — so a photo of this table's QR stops working the moment the table turns over,
   * even if the photo was taken mid-visit.
   */
  qrMode?: "static" | "session";
  /**
   * The one-time token currently valid for this table's self-order link — only meaningful when
   * `qrMode` is `"session"`. `null` means "not currently open for QR ordering" (never opened
   * yet, or the last bill already closed) — see `/api/pos/tables/[id]/open-session` and
   * `/api/customer/table/[tableId]`'s own validation for how this is checked.
   */
  sessionToken?: string | null;
}
