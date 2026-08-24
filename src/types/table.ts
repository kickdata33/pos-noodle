import type { EpochMillis, WithId } from "./common";

/** A physical table. Count/names are fully Admin-managed — never hardcoded (item 13, 34). */
export interface Table extends WithId {
  shopId: string;
  name: string;
  sortOrder: number;
  /** false = temporarily closed (item 13 "ปิดโต๊ะชั่วคราว") — hidden from the POS table grid. */
  active: boolean;
  createdAt: EpochMillis;
}
