import type { EpochMillis, WithId } from "./common";

/**
 * Which printer a job goes to. One PC can run both stations at once (two Chrome windows, each
 * its own Chrome profile with its own remembered printer — see `PrintStationScreen`), or a shop
 * with one printer can run a single station that listens to both.
 */
export type PrintStation = "kitchen" | "cashier";

/** `tableQr` = a slip with a table's self-order QR for the customer to scan; `receipt` = the
 * paid receipt, queued automatically in the same transaction that marks the order paid. */
export type PrintJobKind = "kitchen" | "checkBill" | "tableQr" | "receipt";

/**
 * - `pending` — waiting for a print station (browser page or the background Print Agent).
 * - `printing` — claimed by one station (`claimedBy`), being printed right now.
 * - `sent` — "ส่งเข้าเครื่องพิมพ์แล้ว": Windows accepted the job and finished handing it to the
 *   printer. The driver can't tell us paper actually came out, so this is the best a USB
 *   receipt printer can confirm — never shown as "พิมพ์สำเร็จ".
 * - `printed` — confirmed on paper. Kept for completeness/older jobs; nothing sets it today.
 * - `failed` — definitely not printed (never reached the printer).
 * - `uncertain` — reached the printer (or may have) but then something went wrong, or the
 *   agent stopped mid-job. Staff must look at the printer before reprinting, so the POS shows
 *   these with "พิมพ์ใหม่" / "ออกแล้ว" buttons instead of the system retrying on its own.
 */
export type PrintJobStatus = "pending" | "printing" | "sent" | "printed" | "failed" | "uncertain";

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
  /** When the job reached `sent`/`printed` (name kept from the first version of this type). */
  printedAt: EpochMillis | null;
  /** When `claimedBy` took the job — lets the POS spot a job stuck in `printing`. */
  claimedAt?: EpochMillis | null;
  /** The Windows printer the Print Agent sent it to, for the problem list on the POS. */
  printerName?: string | null;
  /** Staff saw a `failed`/`uncertain` job and dealt with it (reprinted or confirmed it came out)
   * — hides it from the POS problem list. */
  problemAcknowledged?: boolean;
  /** Set on a deliberate reprint: the job it copies. A reprint is always a new job, never a
   * reset of the old one. */
  reprintOf?: string | null;
}

/**
 * A background Print Agent installed on a shop PC (`print-agent/` in the repo) — doc id is the
 * agent id. Created and revoked only by the server (`/api/admin/print-agents`); the agent itself
 * may only refresh its heartbeat fields. Its secret lives in a separate, rules-locked collection
 * (`printAgentSecrets`), never here, since every shop member can read this doc for the status
 * banner.
 */
export interface PrintAgent extends WithId {
  shopId: string;
  name: string;
  /** Which queues this agent prints. Its sign-in token is limited to exactly these. */
  stations: PrintStation[];
  createdAt: EpochMillis;
  createdByName: string;
  revokedAt: EpochMillis | null;
  /** Agent's last heartbeat (agent clock). Older than ~2 minutes = offline on the POS. */
  lastSeenAt: EpochMillis | null;
  /** Per-station printer state from the last heartbeat. */
  printers?: Partial<Record<PrintStation, { name: string; ready: boolean; detail: string }>>;
  hostname?: string | null;
  version?: string | null;
}
