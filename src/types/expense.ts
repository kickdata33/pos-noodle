import type { EpochMillis, WithId } from "./common";

/** Fixed presets for the "รายจ่าย" (expense) log's category field — exactly the list the shop
 * owner actually pays today, so the dropdown never makes them guess a bucket. "อื่นๆ" is the
 * catch-all for anything not listed (irregular buys like น้ำเปล่า/น้ำโค้ก). Kept as a plain string
 * union (not a separate admin-editable collection like `PaymentMethod`) since this list changes
 * rarely and a hardcoded set is one less thing to manage — add here if the shop's real
 * categories change. */
export const EXPENSE_CATEGORIES = [
  "เช่าที่",
  "พนักงาน",
  "กลุ่มสั่งหมู",
  "กลุ่มร้านชำ",
  "กลุ่ม VC MEAT",
  "กลุ่มจ่ายตลาด",
  "ค่าน้ำ",
  "ค่าไฟ",
  "ค่าเน็ต",
  "อื่นๆ",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

/**
 * One recorded expense (item: บัญชีรายรับ-รายจ่าย). `dateKey` is the plain "YYYY-MM-DD" the
 * expense was actually paid on (not a business-day key — an expense doesn't need the 16:00–04:00
 * shift logic that sales do), so it lines up with whatever day the owner is looking at on a
 * calendar/receipt. A monthly cost (rent, staff wages, utilities) is just one row on the day it
 * was actually paid — never split/prorated across the days it "covers".
 */
export interface Expense extends WithId {
  shopId: string;
  dateKey: string;
  category: ExpenseCategory;
  /** Free-text detail, e.g. "หมู 5 กก." or "ค่าน้ำเดือนกันยายน" — required so a bare category
   * isn't the only record of what was actually bought. */
  description: string;
  amount: number;
  paymentMethod: "cash" | "transfer";
  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
}
