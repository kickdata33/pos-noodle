import { orderBy, where } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { AuditLog } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class AuditLogRepository extends FirestoreRepository<AuditLog> {
  constructor() {
    super(COLLECTIONS.auditLogs);
  }

  listForShop(shopId: string): Promise<AuditLog[]> {
    return this.list(where("shopId", "==", shopId), orderBy("createdAt", "desc"));
  }
}

export const auditLogRepository = new AuditLogRepository();
