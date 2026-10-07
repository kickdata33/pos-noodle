import type { EpochMillis, WithId } from "./common";

/**
 * One item of money put into the shop before/alongside day-to-day operating costs — ค่าเซ้ง (key
 * money/lease premium), ค่าตกแต่ง/อุปกรณ์ (renovation/equipment), ค่าของเริ่มต้น (opening stock),
 * a deposit, anything the owner thinks of as "เงินลงทุน" rather than a recurring running cost
 * (item: "หน้าสรุปการลงทุน... ระยะเวลาคืนทุน"). Deliberately free-text, no fixed category list
 * like `ExpenseCategory` — unlike รายจ่าย (which recurs and so benefits from a short, reusable
 * dropdown), an investment item is usually one-off and highly specific ("ตู้แช่ 2 บาน มือสอง"),
 * so a category picker would mostly just get in the way.
 *
 * Deliberately a *separate* collection from `Expense`, not a flagged/filtered row inside it: an
 * investment is capital put in once, not an operating cost that repeats and should reduce a
 * day's "กำไร/ขาดทุนสุทธิ" — every existing P&L/report calculation already sums `expenses`
 * directly, and teaching all of them to skip a special row forever (and getting every future one
 * right too) is a much larger, more fragile surface than just never putting investment rows in
 * that collection to begin with. `dateKey` is a plain calendar date, same reasoning as
 * `Expense.dateKey` — no shift/business-day logic applies to money that went in once.
 */
export interface InvestmentItem extends WithId {
  shopId: string;
  dateKey: string;
  description: string;
  amount: number;
  createdBy: string;
  createdByName: string;
  createdAt: EpochMillis;
}
