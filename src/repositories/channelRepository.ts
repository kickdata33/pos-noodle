import { orderBy, where, type Unsubscribe } from "firebase/firestore";

import { COLLECTIONS } from "@/lib/firebase/collections";
import type { SalesChannel } from "@/types";
import { FirestoreRepository } from "./firestoreRepository";

class ChannelRepository extends FirestoreRepository<SalesChannel> {
  constructor() {
    super(COLLECTIONS.salesChannels);
  }

  listForShop(shopId: string): Promise<SalesChannel[]> {
    return this.list(where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }

  subscribeForShop(shopId: string, onChange: (channels: SalesChannel[]) => void): Unsubscribe {
    return this.subscribe(onChange, where("shopId", "==", shopId), orderBy("sortOrder", "asc"));
  }
}

export const channelRepository = new ChannelRepository();
