"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import { bangkokDateKey, bangkokDateKeyWithCutoff, customRange, resolvePreset, type DateRange, type ReportPreset } from "@/lib/pos/dateRange";
import { reconciliationRows } from "@/lib/pos/reconciliation";
import { bankTransferRepository } from "@/repositories/bankTransferRepository";
import { expenseRepository } from "@/repositories/expenseRepository";
import { orderRepository } from "@/repositories/orderRepository";
import { paymentMethodRepository } from "@/repositories/paymentMethodRepository";
import { shopRepository } from "@/repositories/shopRepository";
import { EXPENSE_CATEGORIES, type BankTransfer, type Expense, type ExpenseCategory, type Order, type PaymentMethod } from "@/types";

const PRESETS: { value: ReportPreset; label: string }[] = [
  { value: "today", label: "วันนี้" },
  { value: "last7", label: "7 วันล่าสุด" },
  { value: "thisWeek", label: "สัปดาห์นี้" },
  { value: "thisMonth", label: "เดือนนี้" },
];

/**
 * บัญชีรายรับ-รายจ่าย (item: กระทบยอดขาย QR กับเงินที่โอนเข้าบัญชีจริง, แยกรายจ่าย). Three parts:
 * 1) a reconciliation table per business day (ยอดขายเงินสด/QR, โอนเข้าแล้ว, รอโอน, รายจ่าย, สุทธิ)
 * 2) a รายจ่าย log (categorized, admin-entered)
 * 3) a เงินโอนเข้าบัญชี log (admin-entered by hand from the bank's own app/statement)
 * See `lib/pos/reconciliation.ts`'s file comment for why (1) exists and how it avoids the
 * "980 baht missing" illusion caused by K SHOP's 23:00 cutoff not lining up with the shop's own
 * 16:00-start business day.
 */
export default function AccountingPage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;

  const [preset, setPreset] = useState<ReportPreset | "custom">("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Business-day boundary — same "จาก..ถึง.." picker as the reports page's cutoff toggle, but
  // always on here since this whole page only makes sense in shift terms. Defaults match the
  // shop's real operating hours (16:00-04:00), not K SHOP's settlement cutoff (23:00) — those
  // are two different things now that transfers are matched by an explicit `businessDayKey`
  // instead of guessed from the clock (see `BankTransfer.businessDayKey`'s comment).
  const [fromHour, setFromHour] = useState(16);
  const [toHour, setToHour] = useState(4);

  const [orders, setOrders] = useState<Order[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<BankTransfer[]>([]);
  const [currency, setCurrency] = useState("THB");
  const [loading, setLoading] = useState(true);

  const [expenseDialogOpen, setExpenseDialogOpen] = useState(false);
  const [transferDialogOpen, setTransferDialogOpen] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    shopRepository.getSettings(shopId).then((settings) => {
      if (settings) setCurrency(settings.currency);
    });
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return paymentMethodRepository.subscribeForShop(shopId, setPaymentMethods);
  }, [shopId]);

  // Small collections (a shop logs a handful of rows a day at most) — live subscriptions so a
  // just-added expense/transfer shows up immediately without a manual refresh, same reasoning
  // as every other admin CRUD page in this app. Filtered to the visible range client-side below.
  useEffect(() => {
    if (!shopId) return;
    return expenseRepository.subscribeForShop(shopId, setExpenses);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return bankTransferRepository.subscribeForShop(shopId, setTransfers);
  }, [shopId]);

  const range: DateRange = useMemo(() => {
    if (preset === "custom") {
      if (!customFrom || !customTo) return resolvePreset("last7");
      return customRange(customFrom, customTo);
    }
    return resolvePreset(preset);
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    orderRepository
      .listPaidForShopInRange(shopId, range.startMs, range.endMs)
      .then((result) => {
        if (!cancelled) setOrders(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, range.startMs, range.endMs]);

  const rows = useMemo(
    () => reconciliationRows(orders, paymentMethods, transfers, expenses, range.startKey, range.endKey, fromHour),
    [orders, paymentMethods, transfers, expenses, range.startKey, range.endKey, fromHour]
  );

  const visibleExpenses = useMemo(
    () => expenses.filter((e) => e.dateKey >= range.startKey && e.dateKey <= range.endKey).sort((a, b) => (a.dateKey < b.dateKey ? 1 : -1)),
    [expenses, range.startKey, range.endKey]
  );
  const visibleTransfers = useMemo(
    () =>
      transfers
        .filter((t) => t.businessDayKey >= range.startKey && t.businessDayKey <= range.endKey)
        .sort((a, b) => b.transferredAt - a.transferredAt),
    [transfers, range.startKey, range.endKey]
  );

  const totals = useMemo(
    () =>
      rows.reduce(
        (acc, r) => ({
          totalSales: acc.totalSales + r.totalSales,
          pendingTransfer: acc.pendingTransfer + r.pendingTransfer,
          expenses: acc.expenses + r.expenses,
          net: acc.net + r.net,
        }),
        { totalSales: 0, pendingTransfer: 0, expenses: 0, net: 0 }
      ),
    [rows]
  );

  return (
    <AdminSection
      title="บัญชีรายรับ-รายจ่าย"
      description="กระทบยอดขาย QR กับเงินที่โอนเข้าบัญชีจริง แยกตามวันทำการ พร้อมบันทึกรายจ่าย"
    >
      <div className="mb-4 flex flex-wrap items-end gap-2">
        {PRESETS.map((p) => (
          <Button key={p.value} variant={preset === p.value ? "default" : "outline"} onClick={() => setPreset(p.value)}>
            {p.label}
          </Button>
        ))}
        <Button variant={preset === "custom" ? "default" : "outline"} onClick={() => setPreset("custom")}>
          กำหนดเอง
        </Button>
        {preset === "custom" && (
          <div className="flex flex-wrap items-end gap-2">
            <div>
              <Label htmlFor="from" className="mb-1 block">
                จากวันที่
              </Label>
              <Input id="from" type="date" value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} className="h-12 w-40" />
            </div>
            <div>
              <Label htmlFor="to" className="mb-1 block">
                ถึงวันที่
              </Label>
              <Input id="to" type="date" value={customTo} onChange={(e) => setCustomTo(e.target.value)} className="h-12 w-40" />
            </div>
          </div>
        )}
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Label className="text-sm text-muted-foreground">1 วันทำการ นับตั้งแต่</Label>
        <HourSelect label="จาก" value={fromHour} onChange={setFromHour} />
        <span className="text-sm text-muted-foreground">ถึง</span>
        <HourSelect label="ถึง" value={toHour} onChange={setToHour} />
        <span className="text-sm text-muted-foreground">ของวันถัดไป{loading && " · กำลังโหลด..."}</span>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>ยอดขายเทียบกับเงินโอนเข้าบัญชี</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วันทำการ</TableHead>
                <TableHead className="text-right">เงินสด</TableHead>
                <TableHead className="text-right">QR</TableHead>
                <TableHead className="text-right">โอนเข้าแล้ว</TableHead>
                <TableHead className="text-right">รอโอน</TableHead>
                <TableHead className="text-right">รายจ่าย</TableHead>
                <TableHead className="text-right">สุทธิ</TableHead>
                <TableHead>สถานะ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r) => (
                <TableRow key={r.dateKey}>
                  <TableCell className="font-medium">{formatKey(r.dateKey)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.cashSales, currency)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.qrSales, currency)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.transferred, currency)}</TableCell>
                  <TableCell className="text-right">
                    {r.pendingTransfer > 0 ? formatCurrency(r.pendingTransfer, currency) : "-"}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(r.expenses, currency)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(r.net, currency)}</TableCell>
                  <TableCell>
                    <Badge variant={r.settled ? "success" : "default"}>{r.settled ? "ครบ" : "รอ"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={8} className="text-center text-muted-foreground">
                    ไม่มีข้อมูลในช่วงนี้
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            รวมช่วงนี้ — ยอดขาย {formatCurrency(totals.totalSales, currency)}, รอโอน {formatCurrency(totals.pendingTransfer, currency)},
            รายจ่าย {formatCurrency(totals.expenses, currency)}, สุทธิ {formatCurrency(totals.net, currency)}
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>รายจ่าย</CardTitle>
          <Button size="sm" onClick={() => setExpenseDialogOpen(true)}>
            + บันทึกรายจ่าย
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วันที่</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead>รายการ</TableHead>
                <TableHead>จ่ายด้วย</TableHead>
                <TableHead className="text-right">จำนวนเงิน</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleExpenses.map((e) => (
                <TableRow key={e.id}>
                  <TableCell>{formatKey(e.dateKey)}</TableCell>
                  <TableCell>
                    <Badge variant="muted">{e.category}</Badge>
                  </TableCell>
                  <TableCell>{e.description}</TableCell>
                  <TableCell>{e.paymentMethod === "cash" ? "เงินสด" : "โอน"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(e.amount, currency)}</TableCell>
                </TableRow>
              ))}
              {visibleExpenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    ยังไม่มีรายจ่ายในช่วงนี้
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>เงินโอนเข้าบัญชี</CardTitle>
          <Button size="sm" onClick={() => setTransferDialogOpen(true)}>
            + บันทึกเงินโอน
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วันที่โอนเข้าจริง</TableHead>
                <TableHead>สำหรับวันทำการ</TableHead>
                <TableHead>หมายเหตุ</TableHead>
                <TableHead className="text-right">จำนวนเงิน</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleTransfers.map((t) => (
                <TableRow key={t.id}>
                  <TableCell>{formatKey(bangkokDateKey(t.transferredAt))}</TableCell>
                  <TableCell>{formatKey(t.businessDayKey)}</TableCell>
                  <TableCell className="text-muted-foreground">{t.note || "-"}</TableCell>
                  <TableCell className="text-right">{formatCurrency(t.amount, currency)}</TableCell>
                </TableRow>
              ))}
              {visibleTransfers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    ยังไม่มีรายการโอนในช่วงนี้
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {shopId && appUser ? (
        <ExpenseDialog
          open={expenseDialogOpen}
          onOpenChange={setExpenseDialogOpen}
          shopId={shopId}
          createdBy={appUser.id}
          createdByName={appUser.name}
        />
      ) : null}
      {shopId && appUser ? (
        <TransferDialog
          open={transferDialogOpen}
          onOpenChange={setTransferDialogOpen}
          shopId={shopId}
          fromHour={fromHour}
          createdBy={appUser.id}
          createdByName={appUser.name}
        />
      ) : null}
    </AdminSection>
  );
}

function HourSelect({ label, value, onChange }: { label: string; value: number; onChange: (hour: number) => void }) {
  return (
    <Select value={String(value)} onValueChange={(v) => onChange(Number(v))}>
      <SelectTrigger aria-label={label} className="h-9 w-20 text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {Array.from({ length: 24 }, (_, hour) => (
          <SelectItem key={hour} value={String(hour)}>
            {String(hour).padStart(2, "0")}:00
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

function formatKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("th-TH", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

function todayKey(): string {
  return bangkokDateKey(Date.now());
}

function ExpenseDialog({
  open,
  onOpenChange,
  shopId,
  createdBy,
  createdByName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
  createdBy: string;
  createdByName: string;
}) {
  const [dateKey, setDateKey] = useState(todayKey());
  const [category, setCategory] = useState<ExpenseCategory>(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">("cash");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDateKey(todayKey());
      setCategory(EXPENSE_CATEGORIES[0]);
      setDescription("");
      setAmountText("");
      setPaymentMethod("cash");
    }
  }, [open]);

  const amount = Number(amountText);
  const canSave = dateKey && description.trim() && Number.isFinite(amount) && amount > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await expenseRepository.create({
        shopId,
        dateKey,
        category,
        description: description.trim(),
        amount,
        paymentMethod,
        createdBy,
        createdByName,
        createdAt: Date.now(),
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกรายจ่าย</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="exp-date">วันที่จ่าย</Label>
            <Input id="exp-date" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label>หมวด</Label>
            <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exp-desc">รายการ/รายละเอียด</Label>
            <Input
              id="exp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="เช่น หมู 5 กก."
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="exp-amount">จำนวนเงิน</Label>
            <Input
              id="exp-amount"
              type="number"
              inputMode="decimal"
              min={0}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label>จ่ายด้วย</Label>
            <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as "cash" | "transfer")}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cash">เงินสด</SelectItem>
                <SelectItem value="transfer">โอน</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TransferDialog({
  open,
  onOpenChange,
  shopId,
  fromHour,
  createdBy,
  createdByName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
  fromHour: number;
  createdBy: string;
  createdByName: string;
}) {
  const [transferredDateKey, setTransferredDateKey] = useState(todayKey());
  const [businessDayKey, setBusinessDayKey] = useState(todayKey());
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      const today = todayKey();
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTransferredDateKey(today);
      // Guess which business day is "currently open" right now, given the chosen start hour —
      // just a starting point, not a claim of correctness (see `BankTransfer.businessDayKey`'s
      // comment on why this is always a human decision, not a computed one).
      setBusinessDayKey(bangkokDateKeyWithCutoff(Date.now(), fromHour));
      setAmountText("");
      setNote("");
    }
  }, [open, fromHour]);

  const amount = Number(amountText);
  const canSave = transferredDateKey && businessDayKey && Number.isFinite(amount) && amount > 0;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      await bankTransferRepository.create({
        shopId,
        transferredAt: Date.parse(`${transferredDateKey}T00:00:00+07:00`),
        amount,
        businessDayKey,
        note: note.trim(),
        createdBy,
        createdByName,
        createdAt: Date.now(),
      });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>บันทึกเงินโอนเข้าบัญชี</DialogTitle>
        </DialogHeader>
        <div className="grid gap-3">
          <div className="grid gap-2">
            <Label htmlFor="tf-date">วันที่โอนเข้าจริง (ตาม statement ธนาคาร)</Label>
            <Input
              id="tf-date"
              type="date"
              value={transferredDateKey}
              onChange={(e) => setTransferredDateKey(e.target.value)}
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tf-business-day">สำหรับวันทำการ</Label>
            <Input
              id="tf-business-day"
              type="date"
              value={businessDayKey}
              onChange={(e) => setBusinessDayKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">
              เลือกวันทำการที่ยอดนี้เป็นเงินของยอดขายวันนั้น ไม่ใช่วันที่เงินโอนเข้าจริงเสมอไป — เช่น ยอด QR
              ช่วงหลังเที่ยงคืนมักโอนเข้าอีกทีคืนถัดไป แต่ยังนับเป็นยอดของวันทำการเดิม
            </p>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tf-amount">จำนวนเงิน</Label>
            <Input
              id="tf-amount"
              type="number"
              inputMode="decimal"
              min={0}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="tf-note">หมายเหตุ (ไม่บังคับ)</Label>
            <Input id="tf-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น K SHOP รอบ 23:00" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={!canSave || saving}>
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
