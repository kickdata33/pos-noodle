import { collection, doc, runTransaction } from "firebase/firestore";

import { db } from "@/lib/firebase/client";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { autoReceiptJobId, receiptJobFields } from "@/lib/pos/printTickets";
import type { Order, Payment, PrintJob, ShopSettings } from "@/types";

export { autoReceiptJobId };

export interface ConfirmPaymentInput {
  order: Order;
  payment: Pick<Payment, "paymentMethodId" | "paymentMethodName" | "cashReceived" | "changeDue" | "amount">;
  settings: ShopSettings | null;
  createdBy: string;
}

/**
 * Marks an order paid, records its payment and — when the shop prints receipts through the
 * print queue — queues the receipt, all in ONE transaction that only goes ahead while the order
 * is still OPEN (item: "งานใบเสร็จอัตโนมัติต้องสร้างหลังยืนยันว่าจ่ายเงินสำเร็จ และสร้างได้
 * ครั้งเดียวต่อรายการจ่าย แม้คำขอถูกส่งซ้ำ").
 *
 * So the receipt job exists if and only if this payment committed, and a double-tapped
 * "ยืนยันชำระเงิน", a retry after a timeout, or two devices confirming the same bill all end in
 * exactly one payment and one receipt: the second attempt finds the order already PAID and
 * changes nothing (`alreadyPaid: true`). The job id is fixed per order as a second guard.
 * Deliberate reprints are separate, new jobs (`printQueue.reprintJob`).
 */
export async function confirmPaymentOnce(input: ConfirmPaymentInput): Promise<{ alreadyPaid: boolean; paidAt: number }> {
  const orderRef = doc(db, COLLECTIONS.orders, input.order.id);
  const paymentRef = doc(collection(db, COLLECTIONS.payments));
  const receiptRef = doc(db, COLLECTIONS.printJobs, autoReceiptJobId(input.order.id));
  const queueReceipt = Boolean(input.settings?.printStation?.receiptEnabled);

  return runTransaction(db, async (tx) => {
    const snap = await tx.get(orderRef);
    if (!snap.exists()) throw new Error("ไม่พบออเดอร์");
    const current = snap.data() as Omit<Order, "id">;
    if (current.status === "PAID") return { alreadyPaid: true, paidAt: current.paidAt ?? Date.now() };
    if (current.status !== "OPEN") throw new Error("ออเดอร์นี้ถูกยกเลิกแล้ว");

    const paidAt = Date.now();
    const paidFields = {
      status: "PAID" as const,
      paymentStatus: "PAID" as const,
      paymentMethodId: input.payment.paymentMethodId,
      paymentMethodName: input.payment.paymentMethodName,
      cashReceived: input.payment.cashReceived,
      changeDue: input.payment.changeDue,
      paidAt,
      updatedAt: paidAt,
    };
    tx.update(orderRef, paidFields);
    const payment: Omit<Payment, "id"> = {
      orderId: input.order.id,
      shopId: input.order.shopId,
      ...input.payment,
      createdBy: input.createdBy,
      createdAt: paidAt,
    };
    tx.set(paymentRef, payment);
    if (queueReceipt && input.settings) {
      // Built from the server's copy of the order (what was actually paid for), with the
      // payment just recorded — same receipt layout as before.
      const paidOrder: Order = { ...current, ...paidFields, id: input.order.id };
      const job: Omit<PrintJob, "id"> = {
        ...receiptJobFields(paidOrder, input.settings),
        shopId: input.order.shopId,
        createdBy: input.createdBy,
        createdAt: paidAt,
      };
      tx.set(receiptRef, job);
    }
    return { alreadyPaid: false, paidAt };
  });
}
