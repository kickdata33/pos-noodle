import { where } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { AppUser } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class UserRepository extends FirestoreRepository<AppUser> {
  constructor() {
    super(COLLECTIONS.users);
  }

  /** `id` here is the Firebase Auth UID — same lookup used at login to resolve role/active. */
  getByUid(uid: string): Promise<AppUser | null> {
    return this.getById(uid);
  }

  listForShop(shopId: string): Promise<AppUser[]> {
    return this.list(where("shopId", "==", shopId));
  }
}

export const userRepository = new UserRepository();
