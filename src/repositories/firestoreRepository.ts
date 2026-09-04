import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  type CollectionReference,
  type QueryConstraint,
  type Unsubscribe,
} from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import type { WithId } from "@/types";

/**
 * Thin Firestore data-access layer (item 28: keep Firestore queries out of components).
 * One subclass per collection. Components/hooks never import `firebase/firestore` directly —
 * they go through a repository (or a service, for anything with business logic on top).
 *
 * Timestamps are stored as plain epoch-ms numbers (see `types/common.ts`), so no
 * Timestamp<->Date conversion is needed here.
 */
export abstract class FirestoreRepository<T extends WithId> {
  protected constructor(protected readonly collectionName: string) {}

  protected get collectionRef(): CollectionReference {
    return collection(db, this.collectionName);
  }

  async getById(id: string): Promise<T | null> {
    const snap = await getDoc(doc(db, this.collectionName, id));
    // `id` spreads in *after* the document data so the real, authoritative Firestore document
    // id always wins over any (accidental or otherwise) `id` field stored inside the data
    // itself — see the OrderScreen `ensureSaved` fix for how such a stray field could get
    // written in the first place. Never reorder this.
    return snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null;
  }

  async list(...constraints: QueryConstraint[]): Promise<T[]> {
    const q = constraints.length
      ? query(this.collectionRef, ...constraints)
      : this.collectionRef;
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T);
  }

  /** Creates with an auto-generated id (default) or a caller-supplied id (e.g. Auth UID). */
  async create(data: Omit<T, "id">, id?: string): Promise<string> {
    if (id) {
      await setDoc(doc(db, this.collectionName, id), data);
      return id;
    }
    const ref = await addDoc(this.collectionRef, data);
    return ref.id;
  }

  async update(id: string, data: Partial<Omit<T, "id">>): Promise<void> {
    await updateDoc(doc(db, this.collectionName, id), data as Record<string, unknown>);
  }

  async remove(id: string): Promise<void> {
    await deleteDoc(doc(db, this.collectionName, id));
  }

  /**
   * Live subscription to one document by id — for a screen that's actively viewing/editing an
   * already-persisted record and must never silently drift out of sync with a write that came
   * from somewhere else (e.g. `OrderScreen` reopening a table order that a customer's QR
   * self-order can add items to concurrently — see that screen's loading effect for why a
   * one-time `getById` there was a real overwrite risk, not just a staleness inconvenience).
   * Calls `onChange(null)` if the document doesn't exist (including if it's deleted mid-session).
   */
  subscribeById(id: string, onChange: (item: T | null) => void): Unsubscribe {
    return onSnapshot(
      doc(db, this.collectionName, id),
      (snap) => {
        onChange(snap.exists() ? ({ ...snap.data(), id: snap.id } as T) : null);
      },
      (err) => {
        console.error(`[${this.collectionName}] subscribeById(${id}) failed`, err);
      }
    );
  }

  /** Live subscription for POS/Admin screens that need to reflect changes in real time. */
  subscribe(onChange: (items: T[]) => void, ...constraints: QueryConstraint[]): Unsubscribe {
    const q = constraints.length
      ? query(this.collectionRef, ...constraints)
      : this.collectionRef;
    return onSnapshot(
      q,
      (snap) => {
        onChange(snap.docs.map((d) => ({ ...d.data(), id: d.id }) as T));
      },
      // Without this, a listener error (most commonly: a composite index this query needs
      // hasn't been deployed yet — `firebase deploy --only firestore:indexes`) fails silently
      // from the screen's point of view: `onChange` is just never called again, so the list
      // quietly stays empty/stale forever with nothing in the UI to explain why. This has bitten
      // real usage before (missing indexes read as "the feature doesn't work"), so at minimum
      // surface it loudly in the console with the collection name, instead of swallowing it.
      (err) => {
        console.error(`[${this.collectionName}] subscribe() failed — is a Firestore index missing? See firestore.indexes.json / "firebase deploy --only firestore:indexes".`, err);
      }
    );
  }
}
