"use client";

import { useEffect, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { printReceiptViaEpos } from "@/lib/pos/eposPrint";
import { buildOrderReceipt } from "@/lib/pos/receipt";
import { orderRepository } from "@/repositories/orderRepository";
import { shopRepository } from "@/repositories/shopRepository";
import type { Order, OrderStatus, ShopSettings } from "@/types";

import { PosBackLink } from "./PosBackLink";

const STATUS_LABEL: Record<OrderStatus, string> = {
  OPEN: "เปิดอยู่",
  PAID: "ชำระแล้ว",
  CANCELLED: "ยกเลิก",
  VOID: "ยกเลิก (Void)",
};

const STATUS_VARIANT: Record<OrderStatus, "default" | "success" | "muted" | "destructive"> = {
  OPEN: "default",
  PAID: "success",
  CANCELLED: "muted",
  VOID: "destructive",
};

/** Read-only order list (item 19), open to staff and admin alike — no editing here. */
export function OrderHistory() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [selected, setSelected] = useState<Order | null>(null);
  const [reprinting, setReprinting] = useState(false);
  const [reprintResult, setReprintResult] = useState<string | null>(null);
  const currency = settings?.currency ?? "THB";

  useEffect(() => {
    orderRepository.listForShop(DEFAULT_SHOP_ID).then(setOrders);
  }, []);
  useEffect(() => {
    shopRepository.getSettings(DEFAULT_SHOP_ID).then(setSettings);
  }, []);

  /** Reprint (item: the shop's only printing path is auto-print-on-checkout, so this is the
   * fallback when that failed — printer was off, out of paper, briefly unreachable, etc. — or
   * when a copy is wanted after the fact). Only ever offered for a `PAID` order, since an OPEN
   * or CANCELLED one has no completed sale to print a receipt for. */
  async function handleReprint(order: Order) {
    if (!settings?.receiptPrinterIp) return;
    setReprinting(true);
    setReprintResult(null);
    try {
      const result = await printReceiptViaEpos(settings.receiptPrinterIp, buildOrderReceipt(order, settings));
      setReprintResult(result.ok ? "ส่งพิมพ์แล้ว" : result.error ?? "พิมพ์ไม่สำเร็จ");
    } finally {
      setReprinting(false);
    }
  }

  return (
    <main className="mx-auto max-w-4xl p-4 sm:p-6">
      <PosBackLink />
      <h1 className="mb-4 text-lg font-semibold">ประวัติออเดอร์</h1>
      <div className="overflow-x-auto rounded-lg border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>เลขที่ออเดอร์</TableHead>
              <TableHead>ช่องทาง/โต๊ะ</TableHead>
              <TableHead>ยอดสุทธิ</TableHead>
              <TableHead>สถานะ</TableHead>
              <TableHead>เวลา</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orders.map((order) => (
              <TableRow
                key={order.id}
                className="cursor-pointer hover:bg-accent"
                onClick={() => setSelected(order)}
              >
                <TableCell>{order.orderNumber || "—"}</TableCell>
                <TableCell>{order.tableName ? `โต๊ะ ${order.tableName}` : order.channelName}{order.customerLabel ? ` · ${order.customerLabel}` : ""}</TableCell>
                <TableCell>{formatCurrency(order.total, currency)}</TableCell>
                <TableCell>
                  <Badge variant={STATUS_VARIANT[order.status]}>{STATUS_LABEL[order.status]}</Badge>
                </TableCell>
                <TableCell>{new Date(order.createdAt).toLocaleString("th-TH")}</TableCell>
              </TableRow>
            ))}
            {orders.length === 0 ? (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  ยังไม่มีออเดอร์
                </TableCell>
              </TableRow>
            ) : null}
          </TableBody>
        </Table>
      </div>

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setReprintResult(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected?.orderNumber} — {selected?.tableName ? `โต๊ะ ${selected.tableName}` : selected?.channelName}{selected?.customerLabel ? ` · ${selected.customerLabel}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {selected?.items.map((item) => (
              <div key={item.id} className="flex items-start justify-between gap-2 border-b border-border pb-2 text-sm">
                <div>
                  <p className="font-medium">
                    {item.quantity}x {item.productName}
                  </p>
                  {item.modifiers.map((m) => (
                    <p key={m.optionId} className="text-xs text-muted-foreground">
                      {m.optionName}
                    </p>
                  ))}
                  {item.note ? <p className="text-xs text-muted-foreground">หมายเหตุ: {item.note}</p> : null}
                </div>
                <span>{formatCurrency(item.lineTotal, currency)}</span>
              </div>
            ))}
            {selected ? (
              <div className="grid gap-1 text-sm">
                <div className="flex justify-between text-base font-semibold">
                  <span>ยอดสุทธิ</span>
                  <span>{formatCurrency(selected.total, currency)}</span>
                </div>
                {selected.paymentMethodName ? (
                  <p className="text-muted-foreground">ชำระโดย {selected.paymentMethodName}</p>
                ) : null}
              </div>
            ) : null}
            {selected?.status === "PAID" && settings?.receiptPrinterIp ? (
              <div className="flex items-center gap-3">
                <Button variant="outline" size="sm" onClick={() => handleReprint(selected)} disabled={reprinting}>
                  {reprinting ? "กำลังพิมพ์..." : "พิมพ์ใบเสร็จ"}
                </Button>
                {reprintResult ? <span className="text-sm text-muted-foreground">{reprintResult}</span> : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </main>
  );
}
