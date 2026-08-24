/**
 * Firestore's client SDK (`firebase/firestore`) and Admin SDK (`firebase-admin/firestore`)
 * expose *different* `Timestamp` classes that aren't interchangeable at the type level, even
 * though the stored data is identical. To keep `types/` usable from both browser code and
 * server code (API routes, the seed script) without importing either SDK here, every
 * date/time field in this app is stored and typed as epoch milliseconds (`number`).
 *
 * Repositories are responsible for converting a Firestore Timestamp to/from this `number`
 * at the read/write boundary — components and services never see a raw Timestamp.
 */
export type EpochMillis = number;

export interface WithId {
  id: string;
}
