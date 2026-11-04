"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { CancelOrderDialog } from "@/components/pos/CancelOrderDialog";
import { DateField } from "@/components/admin/DateField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/hooks/useAuth";
import { bangkokDateKey } from "@/lib/pos/dateRange";
import { voidPaidOrderAndRestoreStock } from "@/lib/pos/stockService";
import { auditLogRepository } from "@/repositories/auditLogRepository";
import { orderRepository } from "@/repositories/orderRepository";
import { shopRepository } from "@/repositories/shopRepository";
import type { AuditReason, Order, OrderStatus } from "@/types";

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
 * bill quickly far more often than a cook glancing at today's list does on the POS side. The date
 * filter (item: "เลือกวันที่ได้ และยอดรวมของบิลทั้งหมดในวันนั้น") defaults to today rather than
 * showing full history, since "how much did we bill today" is the far more common question than
 * "find this one bill from months ago" — "ทั้งหมด" switches back to the old unfiltered view for
 * that search-by-number case. Grouped by plain calendar date (`bangkokDateKey`), not the
 * 16:00-cutoff business day `/admin/accounting` uses — this list is "bills opened on this
 * calendar day," not a shift reconciliation.
 */
export default function AdminOrdersPage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;
  const [orders, setOrders] = useState<Order[]>([]);
  const [currency, setCurrency] = useState("THB");
  const [selected, setSelected] = useState<Order | null>(null);
  const [voidOpen, setVoidOpen] = useState(false);
  const [voidMessage, setVoidMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<OrderStatus | "all">("all");
  const [dateFilter, setDateFilter] = useState<string>(() => bangkokDateKey(Date.now()));

  useEffect(() => {
    if (!shopId) return;
    orderRepository.listForShop(shopId).then(setOrders);
  }, [shopId]);
  useEffect(() => {
    if (!shopId) return;
    shopRepository.getSettings(shopId).then((s) => {
      if (s) setCurrency(s.currency);
    });
  }, [shopId]);

  /**
   * Void a paid bill (Admin only — this page): bill → VOID (drops out of sales reports, which
   * only count PAID), its piece-sold items go back into stock, an audit entry records who and
   * why, and Telegram gets the usual cancelled-bill message.
   */
  async function confirmVoid(reason: AuditReason, note: string) {
    const target = selected;
    if (!target || !appUser) return;
    setVoidMessage(null);
    try {
      const result = await voidPaidOrderAndRestoreStock(target, appUser);
      if (result === "notPaid") {
        setVoidMessage({ ok: false, text: "บิลนี้ไม่ได้อยู่ในสถานะชำระแล้ว (อาจถูกยกเลิกไปแล้ว)" });
        return;
      }
      const now = Date.now();
      await auditLogRepository.create({
        shopId: target.shopId,
        action: "ORDER_VOID",
        orderId: target.id,
        description: `ยกเลิกบิลที่ชำระแล้ว ${target.orderNumber} ยอด ${formatCurrency(target.total, currency)} (คืนสต๊อกแล้ว)`,
        reason,
        reasonNote: reason === "อื่น ๆ" ? note : null,
        performedBy: appUser.id,
        performedByName: appUser.name,
        createdAt: now,
      });
      void fetch("/api/notify/order-event", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          event: "cancelled",
          orderNumber: target.orderNumber,
          channelName: target.channelName,
          tableName: target.tableName,
        }),
      }).catch(() => undefined);
      const updated: Order = { ...target, status: "VOID", voidedAt: now, voidedByName: appUser.name, updatedAt: now };
      setOrders((list) => list.map((o) => (o.id === target.id ? updated : o)));
      setSelected(updated);
      setVoidMessage({ ok: true, text: "ยกเลิกบิลแล้ว และคืนสต๊อกเรียบร้อย" });
    } catch {
      setVoidMessage({ ok: false, text: "ยกเลิกบิลไม่สำเร็จ ลองอีกครั้ง" });
    }
  }

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return orders.filter((order) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (dateFilter && bangkokDateKey(order.createdAt) !== dateFilter) return false;
      if (q && !order.orderNumber.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [orders, search, statusFilter, dateFilter]);

  // Sum of whatever is currently on screen — every filter (date, status, search) narrows this the
  // same way it narrows the table, so the two can never disagree.
  const filteredTotal = useMemo(() => filtered.reduce((sum, o) => sum + o.total, 0), [filtered]);

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
        <DateField value={dateFilter} onChange={setDateFilter} className="h-12 w-36" />
        {dateFilter ? (
          <Button type="button" variant="outline" className="h-12" onClick={() => setDateFilter("")}>
            ทั้งหมด
          </Button>
        ) : null}
      </div>

      <p className="mb-2 text-sm text-muted-foreground">
        {dateFilter ? `บิลวันที่ ${formatDateKey(dateFilter)}` : "บิลทั้งหมด"} — {filtered.length} บิล ·
        ยอดรวม{" "}
        <span className="font-medium text-foreground">{formatCurrency(filteredTotal, currency)}</span>
      </p>

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

      <Dialog
        open={selected !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null);
            setVoidMessage(null);
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
                {selected.voidedAt ? (
                  <p className="text-destructive">
                    ยกเลิกบิลเมื่อ {new Date(selected.voidedAt).toLocaleString("th-TH")} โดย {selected.voidedByName}
                  </p>
                ) : null}
                {voidMessage ? (
                  <p className={voidMessage.ok ? "text-success" : "text-destructive"}>{voidMessage.text}</p>
                ) : null}
                {selected.status === "PAID" ? (
                  <Button variant="outline" className="mt-2 w-full text-destructive" onClick={() => setVoidOpen(true)}>
                    ยกเลิกบิลนี้ (คืนสต๊อก)
                  </Button>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>

      {selected ? (
        <CancelOrderDialog
          open={voidOpen}
          onOpenChange={setVoidOpen}
          orderNumber={selected.orderNumber}
          onConfirm={confirmVoid}
          title={`ยกเลิกบิลที่ชำระแล้ว ${selected.orderNumber} — เลือกเหตุผล`}
          description="บิลจะไม่ถูกนับในยอดขาย และสินค้าที่นับสต๊อกจะคืนเข้าสต๊อกอัตโนมัติ ถ้าลูกค้าจ่ายเงินแล้ว ต้องคืนเงินเอง"
          confirmLabel="ยืนยันยกเลิกบิล"
        />
      ) : null}
    </AdminSection>
  );
}

function formatDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}
