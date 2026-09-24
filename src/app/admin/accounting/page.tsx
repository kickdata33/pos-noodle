"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { DateField } from "@/components/admin/DateField";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
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
  bangkokHour,
  bangkokWallTimeToEpoch,
  customRange,
  resolvePreset,
  type DateRange,
  type ReportPreset,
} from "@/lib/pos/dateRange";
import { reconciliationRows } from "@/lib/pos/reconciliation";
import { computeMissingRecurringExpenses, recurringExpenseDayKey } from "@/lib/pos/recurringExpenses";
import { bankTransferRepository } from "@/repositories/bankTransferRepository";
import { dailyFloatRepository } from "@/repositories/dailyFloatRepository";
import { expenseRepository } from "@/repositories/expenseRepository";
import { orderRepository } from "@/repositories/orderRepository";
import { paymentMethodRepository } from "@/repositories/paymentMethodRepository";
import { recurringExpenseRepository } from "@/repositories/recurringExpenseRepository";
import { recurringExpenseSkipRepository } from "@/repositories/recurringExpenseSkipRepository";
import { shopRepository } from "@/repositories/shopRepository";
import {
  EXPENSE_CATEGORIES,
  type BankTransfer,
  type DailyFloat,
  type Expense,
  type ExpenseCategory,
  type Order,
  type PaymentMethod,
  type RecurringExpense,
  type RecurringExpenseSkip,
} from "@/types";

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
  // 06:00, not 04:00 — some nights a table sits until closer to 6am ("มีลูกค้านั่งยาว"). The
  // actual business-day math never depended on this value (a business day already spans a full
  // 24h from `fromHour`, covering any close time up to 16:00 the next day) — `toHour` only
  // controls what the shift-hours label reads on screen.
  const [toHour, setToHour] = useState(6);

  // The รายจ่าย table has its own single-day filter, independent of the range picker above —
  // that picker can span a week/month for the reconciliation table, but for รายจ่าย the user
  // wants exactly one day's entries on screen at a time, nothing else mixed in.
  const [expenseDay, setExpenseDay] = useState(() => todayKey());

  // Clicking a row in the reconciliation table opens a detail dialog for that business day —
  // the transfer amounts already logged for it (item: "ไม่ต้องเลื่อนลงไปดู" — no scrolling down to
  // the เงินโอนเข้าบัญชี card), plus every bill (order) that fell inside that day's shift window,
  // so a discrepancy can be chased down without leaving this one popup.
  const [selectedDay, setSelectedDay] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const [orders, setOrders] = useState<Order[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<BankTransfer[]>([]);
  const [floats, setFloats] = useState<DailyFloat[]>([]);
  const [recurringExpenses, setRecurringExpenses] = useState<RecurringExpense[]>([]);
  const [recurringSkips, setRecurringSkips] = useState<RecurringExpenseSkip[]>([]);
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

  useEffect(() => {
    if (!shopId) return;
    return dailyFloatRepository.subscribeForShop(shopId, setFloats);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return recurringExpenseRepository.subscribeForShop(shopId, setRecurringExpenses);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return recurringExpenseSkipRepository.subscribeForShop(shopId, setRecurringSkips);
  }, [shopId]);

  // Auto-fills today's (and, catching up after a few days offline, the recent past's) row for
  // every active รายจ่ายประจำ template — item: "ต้องการให้รายจ่ายประจำ ขึ้นอัตโนมัติเลยหากวันไหน
  // ไม่มีจะออกเอง". Runs on every mount/data change but is a no-op once everything's already
  // generated (`computeMissingRecurringExpenses` only ever returns what's actually missing), so
  // this is safe to leave running passively rather than gating it behind a button. 30 days is an
  // arbitrary but generous catch-up window — far enough to cover the shop being unattended for a
  // while, not so far that a brand-new template silently backfills months of history (it also
  // never backfills earlier than its own `createdDateKey` regardless of this window).
  const generatingRecurringRef = useRef(false);
  useEffect(() => {
    if (!shopId || generatingRecurringRef.current || recurringExpenses.length === 0) return;
    const today = todayKey();
    const dateKeys = Array.from({ length: 30 }, (_, i) => addDaysToKey(today, -i));
    const existingKeys = new Set(
      expenses
        .filter((e): e is Expense & { recurringExpenseId: string } => Boolean(e.recurringExpenseId))
        .map((e) => recurringExpenseDayKey(e.recurringExpenseId, e.dateKey))
    );
    const skippedKeys = new Set(recurringSkips.map((s) => recurringExpenseDayKey(s.recurringExpenseId, s.dateKey)));
    const missing = computeMissingRecurringExpenses(recurringExpenses, existingKeys, skippedKeys, dateKeys);
    if (missing.length === 0) return;

    generatingRecurringRef.current = true;
    Promise.all(
      missing.map((m) =>
        expenseRepository.create({
          ...m,
          createdBy: "system-recurring",
          createdByName: "รายจ่ายประจำ (อัตโนมัติ)",
          createdAt: Date.now(),
        })
      )
    ).finally(() => {
      generatingRecurringRef.current = false;
    });
  }, [shopId, recurringExpenses, recurringSkips, expenses]);

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

  const selectedDayRow = useMemo(() => rows.find((r) => r.dateKey === selectedDay) ?? null, [rows, selectedDay]);

  const selectedDayFloat = useMemo(() => floats.find((f) => f.businessDayKey === selectedDay) ?? null, [floats, selectedDay]);

  const selectedDayTransfers = useMemo(
    () =>
      selectedDay
        ? transfers
            .filter((t) => t.businessDayKey === selectedDay)
            .sort((a, b) => b.transferredAt - a.transferredAt)
        : [],
    [transfers, selectedDay]
  );

  // Same business-day grouping as `businessDaySales` (`bangkokDateKeyWithCutoff`,
  // paidAt-or-createdAt) so "บิลวันนี้" shows exactly the orders this row's QR/เงินสด figures were
  // computed from — the shift runs from `fromHour` (16:00) through the small hours of the next
  // calendar day, not plain midnight-to-midnight.
  const selectedDayOrders = useMemo(
    () =>
      selectedDay
        ? orders
            .filter((o) => bangkokDateKeyWithCutoff(o.paidAt ?? o.createdAt, fromHour) === selectedDay)
            .sort((a, b) => (a.paidAt ?? a.createdAt) - (b.paidAt ?? b.createdAt))
        : [],
    [orders, selectedDay, fromHour]
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
  // เฉลี่ยรายจ่าย/วัน (item request) — over every business day actually shown, not just the ones
  // with a nonzero expense, so a run of "day off, no expense" days pulls the average down same as
  // it would pull down a real bookkeeper's mental average.
  const avgExpensePerDay = rows.length > 0 ? totals.expenses / rows.length : 0;

  // Marks a day's outstanding QR-not-yet-transferred amount as settled without requiring the
  // owner to re-type it into the เงินโอนเข้าบัญชี form below — item request: "ยอดรอโอน ทำให้กดติ๊ก
  // ได้แล้วหายไป เท่ากับว่าโอนแล้ว". Writes a real `BankTransfer` for exactly today's outstanding
  // amount (so it sums correctly with anything logged normally), tagged so it's obviously a
  // manual confirmation rather than a real bank-line entry if anyone reviews the โอนเข้าบัญชี list
  // later. `confirmingDays` just disables the checkbox mid-write — no undo here, same as every
  // other "log a transfer" action; fixing a mistaken confirmation means deleting that transfer row
  // from the เงินโอนเข้าบัญชี table below, same as any other logged transfer.
  const [confirmingDays, setConfirmingDays] = useState<Set<string>>(new Set());
  async function confirmPendingTransfer(row: (typeof rows)[number]) {
    if (!shopId || !appUser || row.pendingTransfer <= 0 || confirmingDays.has(row.dateKey)) return;
    setConfirmingDays((prev) => new Set(prev).add(row.dateKey));
    try {
      await bankTransferRepository.create({
        shopId,
        transferredAt: Date.now(),
        amount: row.pendingTransfer,
        businessDayKey: row.dateKey,
        note: "ยืนยันด้วยตนเองว่าโอนเข้าแล้ว (ติ๊กจากตารางกระทบยอด)",
        createdBy: appUser.id,
        createdByName: appUser.name,
        createdAt: Date.now(),
      });
    } finally {
      setConfirmingDays((prev) => {
        const next = new Set(prev);
        next.delete(row.dateKey);
        return next;
      });
    }
  }

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
                <TableHead className="text-right">ยอดทั้งหมด</TableHead>
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
                <TableRow key={r.dateKey} className="cursor-pointer hover:bg-accent/50" onClick={() => setSelectedDay(r.dateKey)}>
                  <TableCell className="font-medium">{formatKey(r.dateKey)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(r.totalSales, currency)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.cashSales, currency)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.qrSales, currency)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.transferred, currency)}</TableCell>
                  <TableCell className="text-right">
                    {r.pendingTransfer > 0 ? (
                      <span className="inline-flex items-center justify-end gap-2">
                        {formatCurrency(r.pendingTransfer, currency)}
                        <input
                          type="checkbox"
                          className="h-4 w-4 cursor-pointer accent-primary"
                          title="ติ๊กถ้าโอนเข้าบัญชีแล้ว (ยืนยันด้วยตนเอง ไม่ต้องกรอกฟอร์มด้านล่าง)"
                          disabled={confirmingDays.has(r.dateKey)}
                          onClick={(e) => e.stopPropagation()}
                          onChange={(e) => e.target.checked && confirmPendingTransfer(r)}
                        />
                      </span>
                    ) : r.overTransferred > 0 ? (
                      <span
                        className="inline-flex items-center justify-end gap-1 text-destructive"
                        title="ยอดที่กรอกไว้ในตาราง &quot;เงินโอนเข้าบัญชี&quot; ของวันนี้ มากกว่ายอด QR ที่ระบบคำนวณ — เช็คว่ามีแถวกรอกผิด/กรอกซ้ำ หรือมี QR ที่ขายจริงแต่ระบบไม่ได้บันทึกไว้"
                      >
                        เกิน {formatCurrency(r.overTransferred, currency)}
                      </span>
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell className="text-right">{formatCurrency(r.expenses, currency)}</TableCell>
                  <TableCell className={cn("whitespace-nowrap text-right font-medium", netClassName(r.net))}>
                    {formatCurrency(r.net, currency)}
                  </TableCell>
                  <TableCell>
                    <Badge variant={r.settled ? "success" : "default"}>{r.settled ? "ครบ" : "รอ"}</Badge>
                  </TableCell>
                </TableRow>
              ))}
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    ไม่มีข้อมูลในช่วงนี้
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            รวมช่วงนี้ — ยอดขาย {formatCurrency(totals.totalSales, currency)}, รอโอน {formatCurrency(totals.pendingTransfer, currency)},
            รายจ่าย {formatCurrency(totals.expenses, currency)} (เฉลี่ย {formatCurrency(avgExpensePerDay, currency)}/วัน), สุทธิ{" "}
            <span className={cn("font-medium", netClassName(totals.net))}>{formatCurrency(totals.net, currency)}</span>
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>รายจ่าย</CardTitle>
        </CardHeader>
        <CardContent>
          {/* Its own single-day filter, separate from the range picker above — เลือกวันไหน โชว์
              แค่วันนั้น, never mixed with any other day. Every row in the table below (including
              new ones from the quick-add row) belongs to this same day — there's no per-row date
              field/column, since that would just repeat this picker. */}
          <div className="mb-3 flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">วันที่</Label>
            <DateField value={expenseDay} onChange={setExpenseDay} className="h-9 w-36" />
            <span className="text-sm font-medium">{formatKey(expenseDay)}</span>
          </div>
          <Table className="table-fixed min-w-[560px]">
            {/* Fixed, percentage-based column widths (sum to 100%) so every cell's Input/Select
                below can fill its column with `w-full` instead of a fixed px width. `min-w-[560px]`
                is what actually matters on a phone: without it, `table-fixed` + `w-full` shrinks
                the table down to the screen's own width, squeezing every Select/Input/Badge below
                the space they need and making them visually overlap. With a minimum width, the
                table instead stays usable-sized and the surrounding `Table` component's own
                `overflow-x-auto` wrapper (see `components/ui/table.tsx`) scrolls it horizontally —
                the same "ซ้อนกันทั้งช่องกรอกข้อมูล" bug report this fixes. No วันที่ column here —
                the "วันที่" field above the table already picks the one day every row in it
                belongs to, so repeating it per-row (and in the quick-add row) was a pure
                duplicate of that same picker ("วันที่มีเลือกด้านบนแล้วไม่จำเป็นต้องมีซ้ำ") and, being the
                narrowest column, the first thing to visibly overlap on a phone. */}
            <colgroup>
              <col className="w-[18%]" />
              <col className="w-[32%]" />
              <col className="w-[16%]" />
              <col className="w-[18%]" />
              <col className="w-[16%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>หมวด</TableHead>
                <TableHead>รายการ</TableHead>
                <TableHead>จ่ายด้วย</TableHead>
                <TableHead className="text-right">จำนวนเงิน</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shopId && appUser ? (
                <ExpenseQuickAddRow shopId={shopId} createdBy={appUser.id} createdByName={appUser.name} dateKey={expenseDay} />
              ) : null}
              {visibleExpenses.map((e) => (
                <ExpenseRow key={e.id} expense={e} currency={currency} />
              ))}
              {visibleExpenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    ยังไม่มีรายจ่ายวันนี้
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <p className="mt-3 text-right text-sm font-medium">
            ยอดรวมวันที่ {formatKey(expenseDay)}{" "}
            <span className={expenseDayTotal < 0 ? "text-destructive" : undefined}>
              {formatCurrency(expenseDayTotal, currency)}
            </span>
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>รายจ่ายประจำ</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            รายการที่ตั้งไว้ที่นี่จะถูกสร้างเป็นแถวในตาราง &quot;รายจ่าย&quot; ด้านบนให้อัตโนมัติทุกวัน
            (เช่น ค่าเช่าที่ ค่าพนักงาน ค่าเน็ต) — ถ้าวันไหนหยุด ให้ไปลบแถวของวันนั้นในตาราง
            &quot;รายจ่าย&quot; ได้เลย ระบบจะไม่สร้างซ้ำให้วันนั้นอีก
          </p>
          <Table className="table-fixed min-w-[640px]">
            {/* Same `min-w-[640px]` fix as the รายจ่าย table above — without it this table's Select
                (จ่ายด้วย), and the สถานะ/ลบ buttons collapse into overlapping slivers on a phone. */}
            <colgroup>
              <col className="w-[16%]" />
              <col className="w-[32%]" />
              <col className="w-[16%]" />
              <col className="w-[14%]" />
              <col className="w-[10%]" />
              <col className="w-[12%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>หมวด</TableHead>
                <TableHead>รายการ</TableHead>
                <TableHead className="text-right">จำนวนเงิน/วัน</TableHead>
                <TableHead>จ่ายด้วย</TableHead>
                <TableHead>สถานะ</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shopId ? <RecurringExpenseQuickAddRow shopId={shopId} /> : null}
              {recurringExpenses.map((t) => (
                <RecurringExpenseRow key={t.id} template={t} currency={currency} />
              ))}
              {recurringExpenses.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground">
                    ยังไม่มีรายจ่ายประจำ
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
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
                <TableHead>เวลาโอน (จากการ์ดแจ้งเตือน)</TableHead>
                <TableHead>วันทำการ</TableHead>
                <TableHead className="text-right">จำนวนเงิน</TableHead>
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
                <TransferRow key={t.id} transfer={t} currency={currency} fromHour={fromHour} />
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

      <Dialog open={selectedDay !== null} onOpenChange={(open) => !open && setSelectedDay(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>รายละเอียดวันที่ {selectedDay ? formatKey(selectedDay) : ""}</DialogTitle>
          </DialogHeader>
          {selectedDayRow ? (
            <p className="-mt-2 text-sm text-muted-foreground">
              QR {formatCurrency(selectedDayRow.qrSales, currency)} · โอนเข้าแล้ว {formatCurrency(selectedDayRow.transferred, currency)} · รอโอน{" "}
              {selectedDayRow.pendingTransfer > 0 ? formatCurrency(selectedDayRow.pendingTransfer, currency) : "-"} ·{" "}
              <Badge variant={selectedDayRow.settled ? "success" : "default"}>{selectedDayRow.settled ? "ครบ" : "รอ"}</Badge>
            </p>
          ) : null}

          {shopId && appUser && selectedDay ? (
            <DailyFloatSection
              shopId={shopId}
              businessDayKey={selectedDay}
              float={selectedDayFloat}
              cashSales={selectedDayRow?.cashSales ?? 0}
              currency={currency}
              updatedBy={appUser.id}
              updatedByName={appUser.name}
            />
          ) : null}

          <div>
            <h3 className="mb-2 text-sm font-semibold">เงินโอนเข้าบัญชี</h3>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เวลาโอน (จากการ์ดแจ้งเตือน)</TableHead>
                  <TableHead>วันทำการ</TableHead>
                  <TableHead className="text-right">จำนวนเงิน</TableHead>
                  <TableHead>หมายเหตุ</TableHead>
                  <TableHead className="w-32" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedDayTransfers.map((t) => (
                  <TransferRow key={t.id} transfer={t} currency={currency} fromHour={fromHour} />
                ))}
                {selectedDayTransfers.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      ยังไม่มีรายการโอนวันนี้
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          <div>
            <h3 className="mb-1 text-sm font-semibold">บิลวันนี้ ({selectedDayOrders.length} บิล)</h3>
            {selectedDayRow ? (
              <p className="mb-2 text-sm text-muted-foreground">
                รวม {formatCurrency(selectedDayRow.totalSales, currency)} — เงินสด {formatCurrency(selectedDayRow.cashSales, currency)} ·
                โอน/QR {formatCurrency(selectedDayRow.qrSales, currency)}
                {selectedDayRow.otherSales > 0 ? ` · อื่นๆ ${formatCurrency(selectedDayRow.otherSales, currency)}` : ""}
              </p>
            ) : null}
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เลขที่ออเดอร์</TableHead>
                  <TableHead>ช่องทาง/โต๊ะ</TableHead>
                  <TableHead>ชำระโดย</TableHead>
                  <TableHead className="text-right">ยอด</TableHead>
                  <TableHead>เวลา</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {selectedDayOrders.map((o) => (
                  <TableRow key={o.id} className="cursor-pointer hover:bg-accent" onClick={() => setSelectedOrder(o)}>
                    <TableCell>{o.orderNumber || "—"}</TableCell>
                    <TableCell>
                      {o.tableName ? `โต๊ะ ${o.tableName}` : o.channelName}
                      {o.customerLabel ? ` · ${o.customerLabel}` : ""}
                    </TableCell>
                    <TableCell>{o.paymentMethodName || "-"}</TableCell>
                    <TableCell className="text-right">{formatCurrency(o.total, currency)}</TableCell>
                    <TableCell>
                      {new Date(o.paidAt ?? o.createdAt).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })}
                    </TableCell>
                  </TableRow>
                ))}
                {selectedDayOrders.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">
                      ไม่มีบิลวันนี้
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={selectedOrder !== null} onOpenChange={(open) => !open && setSelectedOrder(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {selectedOrder?.orderNumber} — {selectedOrder?.tableName ? `โต๊ะ ${selectedOrder.tableName}` : selectedOrder?.channelName}
              {selectedOrder?.customerLabel ? ` · ${selectedOrder.customerLabel}` : ""}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {selectedOrder?.items.map((item) => (
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
            {selectedOrder ? (
              <div className="grid gap-1 text-sm">
                <div className="flex justify-between text-base font-semibold">
                  <span>ยอดสุทธิ</span>
                  <span>{formatCurrency(selectedOrder.total, currency)}</span>
                </div>
                {selectedOrder.paymentMethodName ? (
                  <p className="text-muted-foreground">ชำระโดย {selectedOrder.paymentMethodName}</p>
                ) : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
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

/**
 * Color-codes a สุทธิ (net) figure so it reads unambiguously without relying on spotting a
 * lone "-" — item request: a negative amount's minus sign was wrapping onto its own line in the
 * narrow สุทธิ column (`whitespace-nowrap` above fixes the wrap itself), and losing/dropping the
 * "-" for one careless glance is exactly the kind of bookkeeping mistake a color makes hard to
 * make. Red for a loss uses the same `text-destructive` token every other negative/dangerous
 * value in this app uses; blue for a profit is a deliberate one-off here (not the app's existing
 * green `success` token) per the shop owner's explicit color choice for this specific figure.
 */
function netClassName(net: number): string {
  if (net < 0) return "text-destructive";
  if (net > 0) return "text-blue-600 dark:text-blue-400";
  return "";
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
}: {
  shopId: string;
  createdBy: string;
  createdByName: string;
  // Whichever day the "วันที่" filter above the table is set to — new entries always land on
  // that day, no separate date field here (removing the duplicate picker was the point: "วันที่มี
  // เลือกด้านบนแล้วไม่จำเป็นต้องมีซ้ำ").
  dateKey: string;
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
        recurringExpenseId: null,
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
 * entirely. No date field to edit — every row shown is already filtered to the one day picked
 * above, so a per-row date column/input was a pure duplicate of that same picker; to move an
 * entry to a different day, delete it here and re-add it under that day instead.
 */
function ExpenseRow({ expense, currency }: { expense: Expense; currency: string }) {
  const [editing, setEditing] = useState(false);
  const [category, setCategory] = useState<ExpenseCategory>(expense.category);
  const [description, setDescription] = useState(expense.description);
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">(expense.paymentMethod);
  const [amountText, setAmountText] = useState(String(expense.amount));
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setCategory(expense.category);
    setDescription(expense.description);
    setPaymentMethod(expense.paymentMethod);
    setAmountText(String(expense.amount));
    setEditing(true);
  }

  const amount = Number(amountText);
  const canSave = Number.isFinite(amount) && amount > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await expenseRepository.update(expense.id, { category, description: description.trim(), paymentMethod, amount });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    const label = expense.description || expense.category;
    // A row auto-generated from a รายจ่ายประจำ template needs an explicit skip record *first* —
    // otherwise the generation effect above would just recreate this exact row on its very next
    // run, since "no Expense doc" and "not generated yet" are otherwise indistinguishable (item:
    // "ถ้าวันไหนหยุด เดี๋ยวลบออกเอง"). A manually-entered row has nothing to skip; deleting it is
    // final, same as always.
    const confirmMessage = expense.recurringExpenseId
      ? `ลบรายจ่ายประจำวันที่ ${formatKey(expense.dateKey)} "${label}" ${formatCurrency(expense.amount, currency)}? (จะไม่สร้างรายการนี้ซ้ำสำหรับวันนี้อีก)`
      : `ลบรายจ่าย "${label}" ${formatCurrency(expense.amount, currency)}?`;
    if (!window.confirm(confirmMessage)) return;
    if (expense.recurringExpenseId) {
      await recurringExpenseSkipRepository.skip(expense.shopId, expense.recurringExpenseId, expense.dateKey);
    }
    await expenseRepository.remove(expense.id);
  }

  if (editing) {
    return (
      <TableRow className="bg-muted/20">
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
      <TableCell className="truncate">
        <Badge variant="muted">{expense.category}</Badge>
      </TableCell>
      <TableCell className="truncate text-muted-foreground">
        {expense.description || "-"}
        {expense.recurringExpenseId ? (
          <Badge variant="muted" className="ml-2 align-middle text-[10px]">
            ประจำ
          </Badge>
        ) : null}
      </TableCell>
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

/**
 * Same quick-add pattern as `ExpenseQuickAddRow`, for setting up a new รายจ่ายประจำ template
 * (item request: "ต้องการให้รายจ่ายประจำ ขึ้นอัตโนมัติเลย"). No dateKey field — a template isn't
 * itself pinned to one day, it *generates* a row for every day from today on (see the accounting
 * page's `generatingRecurringRef` effect and `createdDateKey`'s comment for why "from today" and
 * not earlier).
 */
function RecurringExpenseQuickAddRow({ shopId }: { shopId: string }) {
  const [category, setCategory] = useState<ExpenseCategory>(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [paymentMethod, setPaymentMethod] = useState<"cash" | "transfer">("cash");
  const [saving, setSaving] = useState(false);

  const amount = Number(amountText);
  const canSave = Number.isFinite(amount) && amount > 0;

  async function handleAdd() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      const now = Date.now();
      await recurringExpenseRepository.create({
        shopId,
        category,
        description: description.trim(),
        amount,
        paymentMethod,
        active: true,
        createdDateKey: todayKey(),
        createdAt: now,
        updatedAt: now,
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
          placeholder="เช่น ค่าเช่าที่, ค่าพนักงาน 2 คน"
          className="h-9 w-full"
        />
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
      <TableCell />
      <TableCell>
        <Button size="sm" onClick={handleAdd} disabled={!canSave || saving} className="w-full">
          +
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * One รายจ่ายประจำ template — a toggle to pause it without losing the setup/history, and a
 * delete that only removes the template itself. Every `Expense` row it already generated stays
 * exactly as-is either way (see `RecurringExpense.active`'s comment) — deleting the template just
 * means no *future* days get a new row from it.
 */
function RecurringExpenseRow({ template, currency }: { template: RecurringExpense; currency: string }) {
  const [busy, setBusy] = useState(false);

  async function toggleActive() {
    setBusy(true);
    try {
      await recurringExpenseRepository.update(template.id, { active: !template.active, updatedAt: Date.now() });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete() {
    const label = template.description || template.category;
    if (
      !window.confirm(
        `ลบรายจ่ายประจำ "${label}" ${formatCurrency(template.amount, currency)}/วัน? (รายการที่สร้างไปแล้วในตาราง "รายจ่าย" จะยังอยู่เหมือนเดิม แค่จะไม่สร้างวันใหม่ๆ ให้อีก)`
      )
    )
      return;
    await recurringExpenseRepository.remove(template.id);
  }

  return (
    <TableRow className={template.active ? undefined : "opacity-50"}>
      <TableCell className="truncate">
        <Badge variant="muted">{template.category}</Badge>
      </TableCell>
      <TableCell className="truncate text-muted-foreground">{template.description || "-"}</TableCell>
      <TableCell className="text-right">{formatCurrency(template.amount, currency)}</TableCell>
      <TableCell className="truncate">{template.paymentMethod === "cash" ? "เงินสด" : "โอน"}</TableCell>
      <TableCell>
        <Button size="sm" variant="ghost" className="px-2" onClick={toggleActive} disabled={busy}>
          {template.active ? "ใช้งานอยู่" : "ปิดอยู่"}
        </Button>
      </TableCell>
      <TableCell>
        <Button size="sm" variant="ghost" className="px-2 text-destructive" onClick={handleDelete}>
          ลบ
        </Button>
      </TableCell>
    </TableRow>
  );
}

/**
 * Same quick-add pattern as `ExpenseQuickAddRow`, for the เงินโอนเข้าบัญชี table — one row per
 * *individual* payment (item: "เชื่อมกับ K SHOP เวลามีคนโอน"). K SHOP's own payment-notification
 * card fires in real time per transaction (not per bank-settlement batch) and shows exactly two
 * numbers: the amount and the moment it happened ("24 ก.ย. 69, 04:05 น."). There's no text to
 * copy off that card (it's a LINE Flex-message card, confirmed with the shop owner) and no OCR
 * pipeline here, so the person still types it in — but now they type *what the card says*
 * (amount + time), never a guess about which business-day bucket it belongs to. That guess is
 * exactly what caused a real production mismatch earlier (a transfer filed under the wrong day),
 * so it's now `bangkokDateKeyWithCutoff`'s job, not a human's — see `bangkokWallTimeToEpoch`'s
 * comment. Logging every payment individually instead of one lump end-of-day total also means
 * `transfersForBusinessDay`'s sum-by-day naturally still adds them all up correctly with zero
 * changes to `reconciliation.ts`.
 */
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
  const [dateKey, setDateKey] = useState(() => bangkokDateKey(Date.now()));
  const [timeText, setTimeText] = useState(() => currentTimeHHMM());
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const amount = Number(amountText);
  const hasAmount = amountText.trim() !== "" && Number.isFinite(amount) && amount > 0;
  const parsedTime = parseHHMM(timeText);
  const canSave = Boolean(dateKey) && parsedTime !== null && hasAmount;
  const transferredAt = parsedTime ? bangkokWallTimeToEpoch(dateKey, parsedTime.hour, parsedTime.minute) : null;
  const previewBusinessDayKey = transferredAt !== null ? bangkokDateKeyWithCutoff(transferredAt, fromHour) : null;

  async function handleAdd() {
    if (!canSave || transferredAt === null || previewBusinessDayKey === null || saving) return;
    setSaving(true);
    try {
      await bankTransferRepository.create({
        shopId,
        transferredAt,
        amount,
        businessDayKey: previewBusinessDayKey,
        note: note.trim(),
        createdBy,
        createdByName,
        createdAt: Date.now(),
      });
      setAmountText("");
      setNote("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow className="bg-muted/30">
      <TableCell>
        <div className="flex items-center gap-1">
          <DateField value={dateKey} onChange={setDateKey} className="h-9 w-32" />
          <Input
            value={timeText}
            onChange={(e) => setTimeText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleAdd()}
            placeholder="04:05"
            inputMode="numeric"
            className="h-9 w-16 text-center"
          />
        </div>
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">
        {previewBusinessDayKey ? formatKey(previewBusinessDayKey) : "—"}
      </TableCell>
      <TableCell>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="จำนวนเงิน"
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

/** "HH:mm" for right now, Bangkok time — the quick-add row's default before the person overwrites
 * it with whatever the notification card actually says. */
function currentTimeHHMM(): string {
  const hour = bangkokHour(Date.now());
  const minute = new Date(Date.now() + 7 * 60 * 60 * 1000).getUTCMinutes();
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Parses a typed "H:mm"/"HH:mm" into its parts, or null if it isn't a valid time — used to gate
 * the quick-add button rather than silently falling back to midnight on a typo. */
function parseHHMM(text: string): { hour: number; minute: number } | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(text.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}


/**
 * One row of the เงินโอนเข้าบัญชี table — a plain read row by default, or (after "แก้ไข") lets
 * correcting the payment's own date/time, amount, or note. The business day is always re-derived
 * from that date/time (`bangkokDateKeyWithCutoff`), never edited directly — same reasoning as
 * `TransferQuickAddRow`'s comment: what a person can misjudge is which bucket a moment falls
 * into, not the moment itself, so only the moment is ever a text field.
 */
function TransferRow({
  transfer,
  currency,
  fromHour,
}: {
  transfer: BankTransfer;
  currency: string;
  fromHour: number;
}) {
  const [editing, setEditing] = useState(false);
  const [dateKey, setDateKey] = useState(() => bangkokDateKey(transfer.transferredAt));
  const [timeText, setTimeText] = useState(() => formatHHMM(transfer.transferredAt));
  const [amountText, setAmountText] = useState(String(transfer.amount));
  const [note, setNote] = useState(transfer.note);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDateKey(bangkokDateKey(transfer.transferredAt));
    setTimeText(formatHHMM(transfer.transferredAt));
    setAmountText(String(transfer.amount));
    setNote(transfer.note);
    setEditing(true);
  }

  const amount = Number(amountText);
  const parsedTime = parseHHMM(timeText);
  const canSave = Boolean(dateKey) && parsedTime !== null && Number.isFinite(amount) && amount > 0;

  async function handleSave() {
    if (!canSave || parsedTime === null || saving) return;
    setSaving(true);
    try {
      const transferredAt = bangkokWallTimeToEpoch(dateKey, parsedTime.hour, parsedTime.minute);
      await bankTransferRepository.update(transfer.id, {
        transferredAt,
        businessDayKey: bangkokDateKeyWithCutoff(transferredAt, fromHour),
        amount,
        note: note.trim(),
      });
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
          <div className="flex items-center gap-1">
            <DateField value={dateKey} onChange={setDateKey} className="h-9 w-32" />
            <Input
              value={timeText}
              onChange={(e) => setTimeText(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSave()}
              placeholder="04:05"
              inputMode="numeric"
              className="h-9 w-16 text-center"
            />
          </div>
        </TableCell>
        <TableCell className="text-xs text-muted-foreground">
          {parsedTime ? formatKey(bangkokDateKeyWithCutoff(bangkokWallTimeToEpoch(dateKey, parsedTime.hour, parsedTime.minute), fromHour)) : "—"}
        </TableCell>
        <TableCell>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={amountText}
            onChange={(e) => setAmountText(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSave()}
            className="h-9 w-28 text-right"
          />
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
      <TableCell>
        {formatKey(bangkokDateKey(transfer.transferredAt))} {formatHHMM(transfer.transferredAt)}
      </TableCell>
      <TableCell className="text-xs text-muted-foreground">{formatKey(transfer.businessDayKey)}</TableCell>
      <TableCell className="text-right">{formatCurrency(transfer.amount, currency)}</TableCell>
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

/** "HH:mm" (Bangkok local) from an epoch-ms timestamp — the display/edit counterpart to
 * `parseHHMM`. */
function formatHHMM(epochMs: number): string {
  const hour = bangkokHour(epochMs);
  const minute = new Date(epochMs + 7 * 60 * 60 * 1000).getUTCMinutes();
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/**
 * ยอดเริ่มต้นประจำวัน — the two numbers this app has no way to derive on its own: the cash float
 * placed in the drawer before the shift, and the K SHOP wallet-balance reading at shift start
 * (needed because that reading is cumulative, not a per-shift total — item: "ในระบบขึ้น 690 มันเป็น
 * ของเมื่อคืนล้นมา", see `DailyFloat`'s own comment). Shown inside the day-detail dialog since
 * both only make sense next to that day's already-known `cashSales`. Three independent fields,
 * each auto-saved on blur — there's no single "submit" moment since any one of them might get
 * filled in hours before the others (starting numbers at ~16:00, the K SHOP check at 23:00).
 */
function DailyFloatSection({
  shopId,
  businessDayKey,
  float,
  cashSales,
  currency,
  updatedBy,
  updatedByName,
}: {
  shopId: string;
  businessDayKey: string;
  float: DailyFloat | null;
  cashSales: number;
  currency: string;
  updatedBy: string;
  updatedByName: string;
}) {
  const [startingCashText, setStartingCashText] = useState(float?.startingCash != null ? String(float.startingCash) : "");
  const [startingKshopText, setStartingKshopText] = useState(float?.startingKshopBalance != null ? String(float.startingKshopBalance) : "");
  const [checkedKshopText, setCheckedKshopText] = useState(float?.kshopCheckedBalance != null ? String(float.kshopCheckedBalance) : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Re-seed local text state whenever the day changes or another device's write comes in —
  // otherwise switching from one day's dialog to another (or a live update from a co-worker)
  // would keep showing stale text still sitting in these inputs.
  // Re-seeding local edit buffers from a prop change (a new day, or a live Firestore update from
  // another device), not deriving fresh state — same reasoning as the page's other
  // setLoading(true)-in-effect, which is why each line below needs the same disable.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartingCashText(float?.startingCash != null ? String(float.startingCash) : "");
    setStartingKshopText(float?.startingKshopBalance != null ? String(float.startingKshopBalance) : "");
    setCheckedKshopText(float?.kshopCheckedBalance != null ? String(float.kshopCheckedBalance) : "");
  }, [businessDayKey, float?.startingCash, float?.startingKshopBalance, float?.kshopCheckedBalance]);

  function parseOrNull(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }

  async function save(patch: Partial<Pick<DailyFloat, "startingCash" | "startingKshopBalance" | "kshopCheckedBalance" | "kshopCheckedAt">>) {
    setSaving(true);
    setSaveError(null);
    try {
      await dailyFloatRepository.upsert(shopId, businessDayKey, { ...patch, updatedBy, updatedByName, updatedAt: Date.now() });
    } catch (err) {
      // Without this, a failed write (most commonly: `firestore.rules` for the new
      // `dailyFloats` collection hasn't been deployed yet — permission-denied) reads as "I typed
      // a number, closed the dialog, and it silently vanished" with nothing on screen to explain
      // why. Surface it loudly instead — same reasoning as `/admin/reports`' `loadError`.
      console.error(`[dailyFloats] upsert(${businessDayKey}) failed — is firestore.rules deployed? See "firebase deploy --only firestore:rules".`, err);
      setSaveError("บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }

  const startingCash = parseOrNull(startingCashText);
  const startingKshop = parseOrNull(startingKshopText);
  const checkedKshop = parseOrNull(checkedKshopText);

  // เงินสดที่ควรมีปลายกะ — a check-figure only, never fed back into `reconciliationRows`' own
  // `cashSales` (that number always comes from actual paid orders, untouched by this).
  const expectedCashAtClose = startingCash != null ? startingCash + cashSales : null;
  // K SHOP's wallet balance is cumulative (see this component's file comment) — subtracting the
  // shift's own starting reading is what turns "the number on screen right now" into "what this
  // shift actually sold", independent of this POS's own QR figure (a useful second check, not a
  // replacement for it).
  const kshopCountedThisShift = startingKshop != null && checkedKshop != null ? checkedKshop - startingKshop : null;

  return (
    <div className="rounded-md border border-border p-3">
      <h3 className="mb-2 text-sm font-semibold">ยอดเริ่มต้นประจำวัน</h3>
      <div className="grid gap-3 sm:grid-cols-3">
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">เงินสดเริ่มต้น (ทอน)</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={startingCashText}
            onChange={(e) => setStartingCashText(e.target.value)}
            onBlur={() => save({ startingCash: parseOrNull(startingCashText) })}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="0.00"
            className="h-9 text-right"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">ยอด K SHOP ตอนเริ่มกะ</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={startingKshopText}
            onChange={(e) => setStartingKshopText(e.target.value)}
            onBlur={() => save({ startingKshopBalance: parseOrNull(startingKshopText) })}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="0.00"
            className="h-9 text-right"
          />
        </div>
        <div>
          <Label className="mb-1 block text-xs text-muted-foreground">ยอด K SHOP ที่เช็คล่าสุด</Label>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            value={checkedKshopText}
            onChange={(e) => setCheckedKshopText(e.target.value)}
            onBlur={() => {
              const checked = parseOrNull(checkedKshopText);
              save({ kshopCheckedBalance: checked, kshopCheckedAt: checked != null ? Date.now() : null });
            }}
            onKeyDown={(e) => e.key === "Enter" && (e.currentTarget as HTMLInputElement).blur()}
            placeholder="0.00"
            className="h-9 text-right"
          />
        </div>
      </div>
      <div className="mt-3 grid gap-1 text-sm text-muted-foreground sm:grid-cols-2">
        <p>
          เงินสดที่ควรมีปลายกะ:{" "}
          <span className="font-medium text-foreground">
            {expectedCashAtClose != null ? formatCurrency(expectedCashAtClose, currency) : "-"}
          </span>
          {startingCash != null
            ? ` (เริ่มต้น ${formatCurrency(startingCash, currency)} + ขายเงินสด ${formatCurrency(cashSales, currency)})`
            : ""}
        </p>
        <p>
          QR ที่ขายได้กะนี้ (ตาม K SHOP):{" "}
          <span className="font-medium text-foreground">
            {kshopCountedThisShift != null ? formatCurrency(kshopCountedThisShift, currency) : "-"}
          </span>
        </p>
      </div>
      {saving ? <p className="mt-1 text-xs text-muted-foreground">กำลังบันทึก...</p> : null}
      {saveError ? <p className="mt-1 text-xs text-destructive">{saveError}</p> : null}
    </div>
  );
}
