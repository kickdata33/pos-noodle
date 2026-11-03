import type { EpochMillis, WithId } from "./common";

/**
 * Which printer a job goes to. One PC can run both stations at once (two Chrome windows, each
 * its own Chrome profile with its own remembered printer — see `PrintStationScreen`), or a shop
 * with one printer can run a single station that listens to both.
 */
export type PrintStation = "kitchen" | "cashier";

export type PrintJobKind = "kitchen" | "checkBill";

export type PrintJobStatus = "pending" | "printing" | "printed" | "failed";

/** Same shape as `lib/pos/receipt.ts`'s `ReceiptLine`, redeclared here so `types/` stays free of
 * `lib/` imports. */
export interface PrintJobLine {
  text: string;
  align?: "left" | "center" | "right";
  bold?: boolean;
  size?: 1 | 2;
}

/**
 * One queued thing to print, picked up by a Print Station browser window on the shop's PC
 * (`/pos/print-station`). The content is fully pre-built when the job is created (a snapshot,
 * like `OrderItem`'s snapshotted names/prices) so the station never has to read the order or the
 * catalog, and a later menu edit can never change what an already-queued ticket says.
 *
 * Written by the POS (client SDK, staff/admin) and by the customer QR-order API routes (Admin
 * SDK). `createdAt` is printed by the station itself in *its own* local time — never baked into
 * `lines` — because the API routes run in UTC on Vercel and would print the wrong hour.
 */
export interface PrintJob extends WithId {
  shopId: string;
  station: PrintStation;
  kind: PrintJobKind;
  orderId: string;
  lines: PrintJobLine[];
  /** PromptPay EMVCo payload (with the amount embedded) rendered as a QR under the lines —
   * only on check bills, and only when the shop has a PromptPay ID set. */
  qrPayload: string | null;
  /** Caption printed under the QR, e.g. "สแกนจ่ายพร้อมเพย์ ฿120.00". */
  qrCaption: string | null;
  status: PrintJobStatus;
  /** Random id of the station window that claimed this job — guards against two open station
   * windows for the same printer both printing it. */
  claimedBy: string | null;
  error: string | null;
  createdBy: string;
  createdAt: EpochMillis;
  printedAt: EpochMillis | null;
}
