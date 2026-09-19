"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import {
  addDaysToKey,
  bangkokDateKey,
  bangkokDateKeyWithCutoff,
  bangkokDayBounds,
  customRange,
  resolvePreset,
  type DateRange,
  type ReportPreset,
} from "@/lib/pos/dateRange";
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

  // The รายจ่าย table has its own single-day filter, independent of the range picker above —
  // that picker can span a week/month for the reconciliation table, but for รายจ่าย the user
  // wants exactly one day's entries on screen at a time, nothing else mixed in.
  const [expenseDay, setExpenseDay] = useState(() => todayKey());

  const [orders, setOrders] = useState<Order[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<BankTransfer[]>([]);
  const [currency, setCurrency] = useState("THB");
  const [loading, setLoading] = useState(true);

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

  // Business-day grouping means an order physically paid on one calendar day can belong to the
  // *previous* day's label (see `bangkokDateKeyWithCutoff`'s comment) — a plain calendar-day
  // fetch for "just today" would silently miss that order (it falls outside `range.startMs`),
  // undercounting a business day's own total. Padding the fetch by a full calendar day on each
  // side guarantees every order that could possibly land in a requested business day gets
  // fetched; `businessDaySales`'s own day-map still only counts the labels actually requested
  // (`range.startKey`..`range.endKey`), so the padding never leaks a neighboring day's numbers in.
  const fetchRange = useMemo(
    () => ({
      startMs: bangkokDayBounds(addDaysToKey(range.startKey, -1)).startMs,
      endMs: bangkokDayBounds(addDaysToKey(range.endKey, 1)).endMs,
    }),
    [range.startKey, range.endKey]
  );

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    orderRepository
      .listPaidForShopInRange(shopId, fetchRange.startMs, fetchRange.endMs)
      .then((result) => {
        if (!cancelled) setOrders(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, fetchRange.startMs, fetchRange.endMs]);

  const rows = useMemo(
    () => reconciliationRows(orders, paymentMethods, transfers, expenses, range.startKey, range.endKey, fromHour),
    [orders, paymentMethods, transfers, expenses, range.startKey, range.endKey, fromHour]
  );

  // เลือกวันไหน โชว์แค่วันนั้น — filtered by `expenseDay` alone, not the range picker above, so
  // switching the day never mixes in another day's rows.
  const visibleExpenses = useMemo(
    () =>
      expenses
        .filter((e) => e.dateKey === expenseDay)
        // Newest first, so a just-added entry appears at the top instead of the bottom.
        .sort((a, b) => b.createdAt - a.createdAt),
    [expenses, expenseDay]
  );
  const expenseDayTotal = useMemo(() => visibleExpenses.reduce((sum, e) => sum + e.amount, 0), [visibleExpenses]);
  const visibleTransfers = useMemo(
    () =>
      transfers
        .filter((t) => t.businessDayKey >= range.startKey && t.businessDayKey <= range.endKey)
        // Group by business day first (newest first) so the two settlement batches of the same
        // day always sit together, then by transferredAt (newest first) within that day.
        .sort((a, b) =>
          a.businessDayKey === b.businessDayKey ? b.transferredAt - a.transferredAt : a.businessDayKey < b.businessDayKey ? 1 : -1
        ),
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
              <DateField id="from" value={customFrom} onChange={setCustomFrom} className="h-12 w-40" />
            </div>
            <div>
              <Label htmlFor="to" className="mb-1 block">
                ถึงวันที่
              </Label>
              <DateField id="to" value={customTo} onChange={setCustomTo} className="h-12 w-40" />
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
        <CardHeader>
          <CardTitle>รายจ่าย</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Its own single-day filter, separate from the range picker above — เลือกวันไหน โชว์
              แค่วันนั้น, never mixed with any other day. The quick-add row's own date field below
              doubles as this filter (`dateKey`/`onDateKeyChange`), so picking a day to view and
              picking which day a new entry belongs to are the same action. */}
          <div className="mb-3 flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">วันที่</Label>
            <DateField value={expenseDay} onChange={setExpenseDay} className="h-9 w-36" />
            <span className="text-sm font-medium">{formatKey(expenseDay)}</span>
          </div>
          <Table className="table-fixed">
            {/* Fixed, percentage-based column widths (sum to 100%) so the row never needs to
                grow past the card's own width and force a horizontal scrollbar — every cell's
                Input/Select below fills its column with `w-full` instead of a fixed px width. */}
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[15%]" />
              <col className="w-[27%]" />
              <col className="w-[12%]" />
              <col className="w-[15%]" />
              <col className="w-[15%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>วันที่</TableHead>
                <TableHead>หมวด</TableHead>
                <TableHead>รายการ</TableHead>
                <TableHead>จ่ายด้วย</TableHead>
                <TableHead className="text-right">จำนวนเงิน</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shopId && appUser ? (
                <ExpenseQuickAddRow
                  shopId={shopId}
                  createdBy={appUser.id}
                  createdByName={appUser.name}
                  dateKey={expenseDay}
                  onDateKeyChange={setExpenseDay}
                />
              ) : null}
              {visibleExpenses.map((e) => (
                <ExpenseRow key={e.id} expense={e} currency={currency} />
              ))}
              {visibleExpenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    ยังไม่มีรายจ่ายวันนี้
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <p className="mt-3 text-right text-sm font-medium">
            ยอดรวมวันที่ {formatKey(expenseDay)} {formatCurrency(expenseDayTotal, currency)}
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>เงินโอนเข้าบัญชี</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>สำหรับวันทำการ</TableHead>
                <TableHead className="text-right">ยอด 16:00-23:00</TableHead>
                <TableHead className="text-right">ยอด 23:00-04:00</TableHead>
                <TableHead>หมายเหตุ</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shopId && appUser ? (
                <TransferQuickAddRow
                  shopId={shopId}
                  fromHour={fromHour}
                  createdBy={appUser.id}
                  createdByName={appUser.name}
                />
              ) : null}
              {visibleTransfers.map((t) => (
                <TransferRow key={t.id} transfer={t} currency={currency} />
              ))}
              {visibleTransfers.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    ยังไม่มีรายการโอนในช่วงนี้
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
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

/**
 * A date `<Input>` with an explicit "📅" button that opens the native calendar picker
 * (`input.showPicker()`) — added because a bare `type="date"` input reads, on a lot of desktop
 * browsers/screen widths, as "type the date in" rather than "click to pick a date", which is
 * exactly the confusion the user hit. Typing the date is still possible (that's the browser's
 * own native behavior, not something this page can safely block without also blocking the
 * picker on some browsers), but now there's an unmistakable button for the point-and-click path.
 */
function DateField({
  value,
  onChange,
  className,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  className?: string;
  id?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  function openPicker() {
    const el = inputRef.current;
    if (!el) return;
    if ("showPicker" in el && typeof el.showPicker === "function") {
      try {
        el.showPicker();
        return;
      } catch {
        // Some browsers throw if the call isn't user-gesture-adjacent enough — fall through to focus().
      }
    }
    el.focus();
  }

  return (
    <div className={cn("relative", className)}>
      <Input
        ref={inputRef}
        id={id}
        type="date"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-full w-full pr-9"
      />
      <button
        type="button"
        onClick={openPicker}
        aria-label="เลือกวันที่"
        className="absolute inset-y-0 right-1 flex w-8 items-center justify-center text-base text-muted-foreground"
      >
        📅
      </button>
    </div>
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

/**
 * One always-visible editable row at the top of the รายจ่าย table — added after the user found
 * the earlier "+ บันทึกรายจ่าย" popup dialog too slow for entering several expenses in a row
 * ("คลิกแบบนี้เสียเวลา"). Typing an amount and pressing Enter (or the ✓ button) saves and clears
 * only the fields that change every time (รายการ, จำนวนเงิน) — วันที่/หมวด/จ่ายด้วย stay as last
 * set, since consecutive entries are usually the same day and often the same category.
 */
function ExpenseQuickAddRow({
  shopId,
  createdBy,
  createdByName,
  dateKey,
  onDateKeyChange,
}: {
  shopId: string;
  createdBy: string;
  createdByName: string;
  // Controlled from the parent, not local state — this date field IS the "which day am I
  // looking at" filter for the table below it, so changing it here also changes what's shown.
  dateKey: string;
  onDateKeyChange: (dateKey: string) => void;
}) {
  const [category, setCategory] = useState<ExpenseCategory>(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">("cash");
  const [saving, setSaving] = useState(false);

  const amount = Number(amountText);
  // รายการ (description) is optional now — some expenses (e.g. a flat "ค่าเช่าที่" line) don't
  // need a separate detail, and requiring one just slows down quick entry for no real benefit.
  const canSave = Boolean(dateKey) && Number.isFinite(amount) && amount > 0;

  async function handleAdd() {
    if (!canSave || saving) return;
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
      setDescription("");
      setAmountText("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow className="bg-muted/30">
      <TableCell>
        <DateField value={dateKey} onChange={onDateKeyChange} className="h-9 w-full" />
      </TableCell>
      <TableCell>
        <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
          <SelectTrigger className="h-9 w-full text-sm">
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
      </TableCell>
      <TableCell>
        <Input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="เช่น หมู 5 กก. (ไม่บังคับ)"
          className="h-9 w-full"
        />
      </TableCell>
      <TableCell>
        <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as "cash" | "transfer")}>
          <SelectTrigger className="h-9 w-full text-sm">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">เงินสด</SelectItem>
            <SelectItem value="transfer">โอน</SelectItem>
          </SelectContent>
        </Select>
      </TableCell>
      <TableCell>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="0.00"
          className="h-9 w-full text-right"
        />
      </TableCell>
      <TableCell>
        <Button size="sm" onClick={handleAdd} disabled={!canSave || saving} className="w-full">
          +
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * One row of the รายจ่าย table — a plain read row by default, or (after "แก้ไข") the same fields
 * as `ExpenseQuickAddRow` inline for correcting a typo or amount, plus "ลบ" for a mistaken entry
 * entirely. Both dateKey inputs (here and in the quick-add row) use `DateField`, which has no
 * `min`, so backdating a missed entry has always worked — this just adds the ability to
 * fix one after the fact.
 */
function ExpenseRow({ expense, currency }: { expense: Expense; currency: string }) {
  const [editing, setEditing] = useState(false);
  const [dateKey, setDateKey] = useState(expense.dateKey);
  const [category, setCategory] = useState<ExpenseCategory>(expense.category);
  const [description, setDescription] = useState(expense.description);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">(expense.paymentMethod);
  const [amountText, setAmountText] = useState(String(expense.amount));
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDateKey(expense.dateKey);
    setCategory(expense.category);
    setDescription(expense.description);
    setPaymentMethod(expense.paymentMethod);
    setAmountText(String(expense.amount));
    setEditing(true);
  }

  const amount = Number(amountText);
  const canSave = Boolean(dateKey) && Number.isFinite(amount) && amount > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await expenseRepository.update(expense.id, { dateKey, category, description: description.trim(), paymentMethod, amount });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const label = expense.description || expense.category;
    if (!window.confirm(`ลบรายจ่าย "${label}" ${formatCurrency(expense.amount, currency)}?`)) return;
    await expenseRepository.remove(expense.id);
  }

  if (editing) {
    return (
      <TableRow className="bg-muted/20">
        <TableCell>
          <DateField value={dateKey} onChange={setDateKey} className="h-9 w-full" />
        </TableCell>
        <TableCell>
          <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
            <SelectTrigger className="h-9 w-full text-sm">
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
        </TableCell>
        <TableCell>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            placeholder="(ไม่บังคับ)"
            className="h-9 w-full"
          />
        </TableCell>
        <TableCell>
          <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as "cash" | "transfer")}>
            <SelectTrigger className="h-9 w-full text-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cash">เงินสด</SelectItem>
              <SelectItem value="transfer">โอน</SelectItem>
            </SelectContent>
          </Select>
        </TableCell>
        <TableCell>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="h-9 w-full text-right"
          />
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-1">
            <Button size="sm" className="px-2" onClick={handleSave} disabled={!canSave || saving}>
              บันทึก
            </Button>
            <Button size="sm" variant="ghost" className="px-2" onClick={() => setEditing(false)}>
              ยกเลิก
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell className="truncate">{formatKey(expense.dateKey)}</TableCell>
      <TableCell className="truncate">
        <Badge variant="muted">{expense.category}</Badge>
      </TableCell>
      <TableCell className="truncate text-muted-foreground">{expense.description || "-"}</TableCell>
      <TableCell className="truncate">{expense.paymentMethod === "cash" ? "เงินสด" : "โอน"}</TableCell>
      <TableCell className="text-right">{formatCurrency(expense.amount, currency)}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" className="px-2" onClick={startEdit}>
            แก้ไข
          </Button>
          <Button size="sm" variant="ghost" className="px-2 text-destructive" onClick={handleDelete}>
            ลบ
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}

/** Same quick-add pattern as `ExpenseQuickAddRow`, for the เงินโอนเข้าบัญชี table. */
function TransferQuickAddRow({
  shopId,
  fromHour,
  createdBy,
  createdByName,
}: {
  shopId: string;
  fromHour: number;
  createdBy: string;
  createdByName: string;
}) {
  // Guess which business day is "currently open" right now, given the chosen start hour — just
  // a starting point the person can change, not a claim of correctness (see
  // `BankTransfer.businessDayKey`'s comment on why this is always a human decision).
  const [businessDayKey, setBusinessDayKey] = useState(() => bangkokDateKeyWithCutoff(Date.now(), fromHour));
  // Split into the two real K SHOP settlement batches a single business day actually receives
  // (see `lib/pos/reconciliation.ts`'s file comment) — the 16:00-23:00 portion transfers that
  // same night, the 23:00-04:00 portion transfers the *next* night. Either can be left blank if
  // only one has landed so far; each filled-in amount becomes its own `BankTransfer` doc, both
  // tagged with the same `businessDayKey` so the reconciliation table sums them together.
  const [amount1Text, setAmount1Text] = useState("");
  const [amount2Text, setAmount2Text] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const amount1 = Number(amount1Text);
  const amount2 = Number(amount2Text);
  const hasAmount1 = amount1Text.trim() !== "" && Number.isFinite(amount1) && amount1 > 0;
  const hasAmount2 = amount2Text.trim() !== "" && Number.isFinite(amount2) && amount2 > 0;
  const canSave = Boolean(businessDayKey) && (hasAmount1 || hasAmount2);

  async function handleAdd() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      // Batch 1 (16:00-23:00) settles at 23:00 on the business-day label date itself (a shift
      // labeled "18" starts 16:00 on the 18th); batch 2 (23:00-04:00) settles at 23:00 the
      // *next* calendar day — see `bangkokDateKeyWithCutoff`'s comment for why a business day is
      // labeled by the date it starts on, not the date it ends on.
      const batch1At = bangkokDayBounds(businessDayKey).startMs + 23 * 60 * 60 * 1000;
      const batch2At = bangkokDayBounds(addDaysToKey(businessDayKey, 1)).startMs + 23 * 60 * 60 * 1000;
      const trimmedNote = note.trim();
      await Promise.all([
        hasAmount1
          ? bankTransferRepository.create({
              shopId,
              transferredAt: batch1At,
              amount: amount1,
              businessDayKey,
              note: trimmedNote ? `${trimmedNote} (16:00-23:00)` : "รอบ 16:00-23:00",
              createdBy,
              createdByName,
              createdAt: Date.now(),
            })
          : Promise.resolve(),
        hasAmount2
          ? bankTransferRepository.create({
              shopId,
              transferredAt: batch2At,
              amount: amount2,
              businessDayKey,
              note: trimmedNote ? `${trimmedNote} (23:00-04:00)` : "รอบ 23:00-04:00",
              createdBy,
              createdByName,
              createdAt: Date.now(),
            })
          : Promise.resolve(),
      ]);
      setAmount1Text("");
      setAmount2Text("");
      setNote("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow className="bg-muted/30">
      <TableCell>
        <DateField value={businessDayKey} onChange={setBusinessDayKey} className="h-9 w-36" />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={amount1Text}
          onChange={(e) => setAmount1Text(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="ยอด 16:00-23:00"
          className="h-9 min-w-24 text-right"
        />
      </TableCell>
      <TableCell>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={amount2Text}
          onChange={(e) => setAmount2Text(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="ยอด 23:00-04:00"
          className="h-9 min-w-24 text-right"
        />
      </TableCell>
      <TableCell>
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="หมายเหตุ (ไม่บังคับ)"
          className="h-9"
        />
      </TableCell>
      <TableCell>
        <Button size="sm" onClick={handleAdd} disabled={!canSave || saving}>
          +
        </Button>
      </TableCell>
    </TableRow>
  );
}


/**
 * One row of the เงินโอนเข้าบัญชี table — a plain read row by default, or (after "แก้ไข") lets
 * correcting the business day, this one batch's amount, or the note; "ลบ" removes a mistaken or
 * duplicate entry entirely. Each logged transfer is always exactly one settlement batch, so
 * editing only ever touches one amount, not two — same `isBatch1` classification used for display.
 */
function TransferRow({ transfer, currency }: { transfer: BankTransfer; currency: string }) {
  // Batch 1 (16:00-23:00) is transferred on the business-day label date itself; batch 2
  // (23:00-04:00) the next calendar day — see `TransferQuickAddRow`'s batch-timestamp comment.
  const isBatch1 = bangkokDateKey(transfer.transferredAt) === transfer.businessDayKey;

  const [editing, setEditing] = useState(false);
  const [businessDayKey, setBusinessDayKey] = useState(transfer.businessDayKey);
  const [amountText, setAmountText] = useState(String(transfer.amount));
  const [note, setNote] = useState(transfer.note);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setBusinessDayKey(transfer.businessDayKey);
    setAmountText(String(transfer.amount));
    setNote(transfer.note);
    setEditing(true);
  }

  const amount = Number(amountText);
  const canSave = Boolean(businessDayKey) && Number.isFinite(amount) && amount > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      // Editing the business day alone doesn't move `transferredAt` (which real-world date the
      // transfer landed on) — only which shift it's credited against, same as the quick-add row
      // logging it there in the first place.
      await bankTransferRepository.update(transfer.id, { businessDayKey, amount, note: note.trim() });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`ลบรายการโอน ${formatCurrency(transfer.amount, currency)} (${formatKey(transfer.businessDayKey)})?`)) return;
    await bankTransferRepository.remove(transfer.id);
  }

  if (editing) {
    return (
      <TableRow className="bg-muted/20">
        <TableCell>
          <DateField value={businessDayKey} onChange={setBusinessDayKey} className="h-9 w-36" />
        </TableCell>
        <TableCell colSpan={2}>
          <div className="flex items-center justify-end gap-2">
            <span className="text-xs text-muted-foreground">{isBatch1 ? "16:00-23:00" : "23:00-04:00"}</span>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              className="h-9 w-28 text-right"
            />
          </div>
        </TableCell>
        <TableCell>
          <Input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSave()} className="h-9" />
        </TableCell>
        <TableCell>
          <div className="flex justify-end gap-1">
            <Button size="sm" onClick={handleSave} disabled={!canSave || saving}>
              บันทึก
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              ยกเลิก
            </Button>
          </div>
        </TableCell>
      </TableRow>
    );
  }

  return (
    <TableRow>
      <TableCell>{formatKey(transfer.businessDayKey)}</TableCell>
      <TableCell className="text-right">{isBatch1 ? formatCurrency(transfer.amount, currency) : "-"}</TableCell>
      <TableCell className="text-right">{isBatch1 ? "-" : formatCurrency(transfer.amount, currency)}</TableCell>
      <TableCell className="text-muted-foreground">{transfer.note || "-"}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          <Button size="sm" variant="ghost" onClick={startEdit}>
            แก้ไข
          </Button>
          <Button size="sm" variant="ghost" className="text-destructive" onClick={handleDelete}>
            ลบ
          </Button>
        </div>
      </TableCell>
    </TableRow>
  );
}
