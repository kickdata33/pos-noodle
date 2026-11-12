import { collection, doc, runTransaction, where, writeBatch, type Unsubscribe } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { applyServeCall, serveCallLabel } from "@/lib/pos/serveCalls";
import type { AppUser, Order, OrderItem, ServeCall } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class ServeCallRepository extends FirestoreRepository<ServeCall> {
  constructor() {
    super(COLLECTIONS.serveCalls);
  }

  /** Calls nobody has acknowledged yet, oldest first. Equality filters only — no index needed. */
  subscribeOpen(shopId: string, onChange: (calls: ServeCall[]) => void): Unsubscribe {
    return this.subscribe(
      (calls) => onChange(calls.slice().sort((a, b) => a.createdAt - b.createdAt)),
      where("shopId", "==", shopId),
      where("acknowledgedAt", "==", null)
    );
  }

  /** Kitchen "เรียกเสิร์ฟ": marks the lines as called on the order and raises the call, together. */
  async callToServe(order: Order, lines: OrderItem[], by: Pick<AppUser, "name">): Promise<string> {
    const now = Date.now();
    const call: Omit<ServeCall, "id"> = {
      shopId: order.shopId,
      orderId: order.id,
      label: serveCallLabel(order),
      items: lines.map((l) => ({ name: l.productName, quantity: l.quantity })),
      createdAt: now,
      createdByName: by.name,
      acknowledgedAt: null,
      acknowledgedById: null,
      acknowledgedByName: null,
    };
    const batch = writeBatch(db);
    batch.update(doc(db, COLLECTIONS.orders, order.id), { items: applyServeCall(order.items, lines, now), updatedAt: now });
    const ref = doc(collection(db, COLLECTIONS.serveCalls));
    batch.set(ref, call);
    await batch.commit();
    return ref.id;
  }

  /** First tap wins; a second phone acknowledging a moment later changes nothing. */
  /** Returns true only for the tap that actually acknowledged it. */
  async acknowledge(callId: string, by: Pick<AppUser, "id" | "name">): Promise<boolean> {
    const ref = doc(db, COLLECTIONS.serveCalls, callId);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists() || snap.data().acknowledgedAt) return false;
      tx.update(ref, { acknowledgedAt: Date.now(), acknowledgedById: by.id, acknowledgedByName: by.name });
      return true;
    });
  }
}

export const serveCallRepository = new ServeCallRepository();
