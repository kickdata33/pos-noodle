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
    return snap.exists() ? ({ id: snap.id, ...snap.data() } as T) : null;
  }

  async list(...constraints: QueryConstraint[]): Promise<T[]> {
    const q = constraints.length
      ? query(this.collectionRef, ...constraints)
      : this.collectionRef;
    const snap = await getDocs(q);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T);
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

  /** Live subscription for POS/Admin screens that need to reflect changes in real time. */
  subscribe(onChange: (items: T[]) => void, ...constraints: QueryConstraint[]): Unsubscribe {
    const q = constraints.length
      ? query(this.collectionRef, ...constraints)
      : this.collectionRef;
    return onSnapshot(q, (snap) => {
      onChange(snap.docs.map((d) => ({ id: d.id, ...d.data() }) as T));
    });
  }
}
