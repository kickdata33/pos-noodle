"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { orderRepository } from "@/repositories/orderRepository";
import { shopRepository } from "@/repositories/shopRepository";
import type { Order, OrderStatus } from "@/types";

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

/**
 * Every bill the shop has ever opened, admin-side (item 19's "ดูรายละเอียดบิลย้อนหลัง" but from
 * `/admin` rather than the staff `/pos/history` — same underlying data, same read-only detail
 * dialog, just reachable from the Admin nav for whoever manages the shop day to day). Search by
 * order number and filter by status, since an admin scrolling months of orders needs to find one
 * bill quickly far more often than a cook glancing at today's list does on the POS side.
 */
export default function AdminOrdersPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [currency, setCurrency] = useState("THB");
  const [selected, setSelected] = useState<Order | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");

  useEffect(() => {
    orderRepository.listForShop(DEFAULT_SHOP_ID).then(setOrders);
  }, []);
  useEffect(() => {
    shopRepository.getSettings(DEFAULT_SHOP_ID).then((s) => {
      if (s) setCurrency(s.currency);
    });
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (q && !order.orderNumber.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [orders, search, statusFilter]);

  return (
    <AdminSection title="รายการบิล" description="ดูบิลย้อนหลังทั้งหมด — ค้นหาเลขที่บิลหรือกรองตามสถานะ แล้วกดแถวเพื่อดูรายละเอียด">
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="ค้นหาเลขที่บิล"
          className="h-12 w-56"
        />
        <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as OrderStatus | "all")}>
          <SelectTrigger className="w-44">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">ทุกสถานะ</SelectItem>
            <SelectItem value="OPEN">เปิดอยู่</SelectItem>
            <SelectItem value="PAID">ชำระแล้ว</SelectItem>
            <SelectItem value="CANCELLED">ยกเลิก</SelectItem>
            <SelectItem value="VOID">ยกเลิก (Void)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>เลขที่บิล</TableHead>
            <TableHead>ช่องทาง/โต๊ะ</TableHead>
            <TableHead>ยอดสุทธิ</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead>เวลา</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {filtered.map((order) => (
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
          {filtered.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
                ไม่พบบิลที่ตรงกับเงื่อนไข
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <Dialog open={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selected?.orderNumber} — {selected?.tableName ? `โต๊ะ ${selected.tableName}` : selected?.channelName}{selected?.customerLabel ? ` · ${selected.customerLabel}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {selected ? (
              <p className="text-sm text-muted-foreground">
                เปิดเมื่อ {new Date(selected.createdAt).toLocaleString("th-TH")} · โดย {selected.createdByName}
              </p>
            ) : null}
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
                <div className="flex justify-between">
                  <span>ยอดรวม</span>
                  <span>{formatCurrency(selected.subtotal, currency)}</span>
                </div>
                {selected.discount > 0 ? (
                  <div className="flex justify-between">
                    <span>ส่วนลด</span>
                    <span>-{formatCurrency(selected.discount, currency)}</span>
                  </div>
                ) : null}
                {selected.serviceCharge > 0 ? (
                  <div className="flex justify-between">
                    <span>ค่าบริการ</span>
                    <span>{formatCurrency(selected.serviceCharge, currency)}</span>
                  </div>
                ) : null}
                {selected.tax > 0 ? (
                  <div className="flex justify-between">
                    <span>ภาษี</span>
                    <span>{formatCurrency(selected.tax, currency)}</span>
                  </div>
                ) : null}
                <div className="flex justify-between text-base font-semibold">
                  <span>ยอดสุทธิ</span>
                  <span>{formatCurrency(selected.total, currency)}</span>
                </div>
                {selected.paymentMethodName ? (
                  <p className="text-muted-foreground">ชำระโดย {selected.paymentMethodName}</p>
                ) : null}
                {selected.cashReceived !== null ? (
                  <p className="text-muted-foreground">
                    รับเงิน {formatCurrency(selected.cashReceived, currency)} · ทอน{" "}
                    {formatCurrency(selected.changeDue ?? 0, currency)}
                  </p>
                ) : null}
                {selected.paidAt ? (
                  <p className="text-muted-foreground">ชำระเมื่อ {new Date(selected.paidAt).toLocaleString("th-TH")}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </AdminSection>
  );
}
