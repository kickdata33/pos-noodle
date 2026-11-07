import { doc, runTransaction, where, type Unsubscribe } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import type { PrintAgent, PrintJob, PrintStation } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class PrintJobRepository extends FirestoreRepository<PrintJob> {
  constructor() {
    super(COLLECTIONS.printJobs);
  }

  /**
   * Pending jobs for one station, oldest first. Equality filters only (no `orderBy`) so this
   * runs on Firestore's automatic single-field indexes — no composite index to deploy. The
   * pending set is tiny (it drains as fast as the printer prints), so sorting it here is free.
   */
  subscribePending(shopId: string, station: PrintStation, onChange: (jobs: PrintJob[]) => void): Unsubscribe {
    return this.subscribe(
      (jobs) => onChange(jobs.slice().sort((a, b) => a.createdAt - b.createdAt)),
      where("shopId", "==", shopId),
      where("station", "==", station),
      where("status", "==", "pending")
    );
  }

  /**
   * Moves a job from `pending` to `printing` for this station window, atomically — returns
   * `false` if another window got it first (two station windows left open for the same
   * printer must never both print the same ticket).
   */
  /**
   * Every job that isn't settled yet or needs attention, for the POS status banner. Settled jobs
   * (`sent`/`printed`) drop out, so this stays small. Needs the `shopId+status` index.
   */
  subscribeUnsettledForShop(shopId: string, onChange: (jobs: PrintJob[]) => void): Unsubscribe {
    return this.subscribe(
      onChange,
      where("shopId", "==", shopId),
      where("status", "in", ["pending", "printing", "failed", "uncertain"])
    );
  }

  async claim(jobId: string, claimedBy: string): Promise<boolean> {
    const ref = doc(db, this.collectionName, jobId);
    return runTransaction(db, async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists() || snap.data().status !== "pending") return false;
      tx.update(ref, { status: "printing", claimedBy, claimedAt: Date.now() });
      return true;
    });
  }
}

export const printJobRepository = new PrintJobRepository();

class PrintAgentRepository extends FirestoreRepository<PrintAgent> {
  constructor() {
    super(COLLECTIONS.printAgents);
  }

  subscribeForShop(shopId: string, onChange: (agents: PrintAgent[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId));
  }
}

export const printAgentRepository = new PrintAgentRepository();
