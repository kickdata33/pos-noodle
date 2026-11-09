import type { EpochMillis, WithId } from "./common";

/**
 * Kitchen → floor "อาหารพร้อมเสิร์ฟ" call (item: "ครัวกดปุ่ม เรียกเสิร์ฟ แล้วแจ้งเตือนมือถือ
 * พนักงาน ทั้งเสียงทั้งสั่น จนกว่าจะกดรับทราบ"). Created by the kitchen screen; every staff phone
 * that turned on "รับเรียกเสิร์ฟ" alarms until ONE person acknowledges it, then all stop.
 */
export interface ServeCall extends WithId {
  shopId: string;
  orderId: string;
  /** "โต๊ะ 3" / "Grab #12" — what staff need to find the customer. */
  label: string;
  items: { name: string; quantity: number }[];
  createdAt: EpochMillis;
  createdByName: string;
  acknowledgedAt: EpochMillis | null;
  acknowledgedById: string | null;
  acknowledgedByName: string | null;
}
