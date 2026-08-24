import "server-only";

import type { Firestore } from "firebase-admin/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import { computePinLookup, isValidPinFormat } from "./pin";

export class PinConflictError extends Error {
  constructor() {
    super("PIN นี้ถูกใช้โดยพนักงานคนอื่นแล้ว");
    this.name = "PinConflictError";
  }
}

export class InvalidPinError extends Error {
  constructor() {
    super("รหัส PIN ต้องเป็นตัวเลข 6 หลัก");
    this.name = "InvalidPinError";
  }
}

/**
 * Shared by `/api/admin/staff` (create) and `/api/admin/staff/[id]/pin` (reset) — and mirrors
 * the same logic `scripts/seed.ts` uses for the first admin account, so there is exactly one
 * place PIN uniqueness is decided.
 *
 * Throws `PinConflictError` if another user already holds this PIN (a PIN is the only thing
 * that identifies a user at login, so two people sharing one would make login ambiguous), or
 * `InvalidPinError` for a malformed PIN. Both are safe to surface to an Admin caller — unlike
 * the login route, this endpoint is already behind an authenticated-admin check, so there's no
 * enumeration concern in saying exactly what went wrong.
 */
export async function assignPin(
  db: Firestore,
  shopId: string,
  uid: string,
  pin: string
): Promise<void> {
  if (!isValidPinFormat(pin)) throw new InvalidPinError();

  const lookup = computePinLookup(pin, shopId);
  const clash = await db
    .collection(COLLECTIONS.userSecrets)
    .where("shopId", "==", shopId)
    .where("pinLookup", "==", lookup)
    .limit(1)
    .get();

  if (!clash.empty && clash.docs[0].id !== uid) throw new PinConflictError();

  await db.collection(COLLECTIONS.userSecrets).doc(uid).set({
    shopId,
    pinLookup: lookup,
    updatedAt: Date.now(),
  });
}
