"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { DateField } from "@/components/admin/DateField";
import { ModuleGate } from "@/components/admin/ModuleGate";
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
  customRange,
  resolvePreset,
  type DateRange,
  type ReportPreset,
} from "@/lib/pos/dateRange";
import { ledgerDayRows, ledgerRangeTotals, type LedgerDayRow } from "@/lib/pos/ledgerDay";
import { reconciliationRows } from "@/lib/pos/reconciliation";
import { computeMissingRecurringExpenses, recurringExpenseDayKey } from "@/lib/pos/recurringExpenses";
import { bankTransferRepository } from "@/repositories/bankTransferRepository";
import { dailyFloatRepository } from "@/repositories/dailyFloatRepository";
import { deliveryPayoutRepository } from "@/repositories/deliveryPayoutRepository";
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
  type DeliveryPayout,
  type Expense,
  type ExpenseCategory,
  type Order,
  type PaymentMethod,
  type RecurringExpense,
  type RecurringExpenseSkip,
} from "@/types";

const PRESETS: { value: ReportPreset; label: string }[] = [
  { value: "today", label: "วันนี้" },
  { value: "yesterday", label: "เมื่อวาน" },
  { value: "last7", label: "7 วันล่าสุด" },
  { value: "thisWeek", label: "สัปดาห์นี้" },
  { value: "thisMonth", label: "เดือนนี้" },
];

/**
 * บัญชีรายรับ-รายจ่าย — 1 แถว = 1 วันทำการ, กำไร/ขาดทุน (ยอดขายทุกช่องทาง รวม Delivery หักรายจ่ายทั้งหมด)
 * เป็นตัวเลขหลักของแถว, กดแถวเพื่อดูรายละเอียด (รายจ่ายแยกรายการ, เงินโอนแยกรอบ, บิลวันนี้, และ "ตรวจนับ
 * เงินสด" ซึ่งเป็นการเช็คแยกต่างหากว่านับเงินสดปลายกะตรงกับที่ระบบคาดไหม) แทนที่จะต้องเปิดป๊อปอัปแยกหรือ
 * เลื่อนไปดูอีกตาราง.
 *
 * v1 ของตารางนี้ใช้ "ส่วนต่างรวม" (ผลต่างเงินสด+โอน) เป็นตัวเลขหลัก ซึ่งทำให้วันที่ร้านขาดทุนจริง (รายจ่าย
 * มากกว่ายอดขาย) แต่บังเอิญนับเงินสดได้เกินพอดี กลับโชว์เป็น "เกิน" สีบวกอยู่ดี อ่านแล้วเข้าใจผิดว่าร้าน
 * กำไร — v2 (ปัจจุบัน) แยกสองเรื่องนี้ออกจากกันชัดเจน: "กำไร/ขาดทุน" (`LedgerDayRow.netProfit`, สี
 * เขียว/แดง) เป็นตัวเลขบัญชีล้วนๆ จากยอดขายหักรายจ่าย ส่วน "ตรวจนับเงินสด" (`cashDifference`/`combined`,
 * สีน้ำเงิน/แดง — คนละโทนสีโดยตั้งใจ) ย้ายไปเป็นรายละเอียดย่อยที่กดดูได้ พร้อมไอคอน ⚠ เตือนข้าง สถานะ
 * เวลามีส่วนต่างจากการนับ ทั้งสองดีไซน์ reviewed เป็น HTML mockup ก่อนเขียนจริงทั้งคู่ (item: "ช่วยออกแบบ
 * หน้ากรอกข้อมูลเพื่อให้ทำบัญชี ง่ายดูได้จากตารางเดียว ... อยากให้ delivery รวมไปด้วย" ตามด้วย "เอายอดขาย
 * แต่ละช่องมารวมกัน และเอาไป - กับ รายจ่าย เหลือสุทธิเท่าไหร่ กำไรเท่าไหร่ ขาดทุนเท่าไหร่ในวันนั้นๆ"). See
 * `lib/pos/ledgerDay.ts`'s file comment for how Delivery gets folded in and how `netProfit` /
 * `cashRemainingNow` are derived, and `lib/pos/dailyFloat.ts`'s file comment for the "นับเงินสด
 * ปลายกะ" field's corrected (post-move-out) semantics.
 *
 * รายจ่ายประจำ (recurring expense templates) is the one piece left as its own card below — it's
 * config, not a per-day figure, so it never belonged inside a per-business-day row.
 */
export default function AccountingPage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;

  const [preset, setPreset] = useState<ReportPreset | "custom">("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  // Business-day boundary — defaults match the shop's real operating hours (16:00-04:00), not
  // K SHOP's settlement cutoff (23:00) — see `lib/pos/reconciliation.ts`'s file comment.
  const [fromHour, setFromHour] = useState(16);
  const [toHour, setToHour] = useState(6);

  // Which row's detail panel (รายจ่าย/เงินโอน/Delivery/บิลวันนี้ ของวันนั้น) is open — replaces the
  // old day-detail Dialog. Shared between the desktop table and the mobile card list so switching
  // viewport width mid-session doesn't lose which day was open.
  const [expandedDay, setExpandedDay] = useState<string | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);

  const [orders, setOrders] = useState<Order[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [transfers, setTransfers] = useState<BankTransfer[]>([]);
  const [floats, setFloats] = useState<DailyFloat[]>([]);
  const [deliveryPayouts, setDeliveryPayouts] = useState<DeliveryPayout[]>([]);
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
  // just-added expense/transfer shows up immediately without a manual refresh, same reasoning as
  // every other admin CRUD page in this app. Filtered to the visible range (or the one expanded
  // day) client-side below.
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
    return deliveryPayoutRepository.subscribeForShop(shopId, setDeliveryPayouts);
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
  // generated (`computeMissingRecurringExpenses` only ever returns what's actually missing).
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
        // Deterministic id so two devices racing to generate the same (template, day) pair land
        // on the same doc instead of creating a duplicate — see the original comment history for
        // the exact production bug this prevents.
        expenseRepository.create(
          { ...m, createdBy: "system-recurring", createdByName: "รายจ่ายประจำ (อัตโนมัติ)", createdAt: Date.now() },
          `${m.recurringExpenseId}_${m.dateKey}`
        )
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

  // Padding the order fetch by a full calendar day on each side guarantees every order that
  // could possibly land in a requested business day gets fetched — see `bangkokDateKeyWithCutoff`'s
  // comment for why a business day can start on the previous calendar day's paidAt.
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

  // One signed correction per business day for a bill rung in under the wrong payment method —
  // see `DailyFloat.cashTransferAdjustment`'s comment.
  const cashTransferAdjustments = useMemo(() => {
    const map: Record<string, number> = {};
    for (const f of floats) {
      if (f.cashTransferAdjustment) map[f.businessDayKey] = f.cashTransferAdjustment;
    }
    return map;
  }, [floats]);

  const reconciliation = useMemo(
    () => reconciliationRows(orders, paymentMethods, transfers, expenses, range.startKey, range.endKey, fromHour, cashTransferAdjustments),
    [orders, paymentMethods, transfers, expenses, range.startKey, range.endKey, fromHour, cashTransferAdjustments]
  );

  // The one merge that makes this a single table: folds Delivery revenue and the cash-float
  // check (เงินสดที่ควรมี/ผลต่างเงินสด/ส่วนต่างรวม) into `reconciliation` — see `lib/pos/ledgerDay.ts`.
  const ledgerRows: LedgerDayRow[] = useMemo(
    () => ledgerDayRows(reconciliation, floats, expenses, deliveryPayouts),
    [reconciliation, floats, expenses, deliveryPayouts]
  );
  const totals = useMemo(() => ledgerRangeTotals(ledgerRows), [ledgerRows]);
  const avgExpensePerDay = ledgerRows.length > 0 ? totals.expenses / ledgerRows.length : 0;

  // Marks a day's outstanding QR-not-yet-transferred amount as settled without requiring the
  // owner to re-type it into the เงินโอนเข้าบัญชี form — writes a real `BankTransfer` for exactly
  // today's outstanding amount, tagged so it's obviously a manual confirmation if anyone reviews
  // the โอนเข้าบัญชี list later.
  const [confirmingDays, setConfirmingDays] = useState<Set<string>>(new Set());
  async function confirmPendingTransfer(row: LedgerDayRow) {
    if (!shopId || !appUser || row.pendingTransfer <= 0 || confirmingDays.has(row.dateKey)) return;
    setConfirmingDays((prev) => new Set(prev).add(row.dateKey));
    try {
      await bankTransferRepository.create({
        shopId,
        transferredAt: Date.now(),
        amount: row.pendingTransfer,
        businessDayKey: row.dateKey,
        note: "ยืนยันด้วยตนเองว่าโอนเข้าแล้ว (ติ๊กจากตารางบัญชี)",
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

  function toggleExpand(dateKey: string) {
    setExpandedDay((cur) => (cur === dateKey ? null : dateKey));
  }

  return (
    <ModuleGate module="accounting">
      <AdminSection
        title="บัญชีรายรับ-รายจ่าย"
        description="1 แถว = 1 วันทำการ — ยอดขายแยกช่องทาง รายจ่าย และกำไร/ขาดทุน (รวม Delivery) ดูได้ในตารางเดียว กดแถวเพื่อดูรายละเอียด/ตรวจนับเงินสด"
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

        <div className="mb-4 flex flex-wrap items-center gap-2">
          <Label className="text-sm text-muted-foreground">1 วันทำการ นับตั้งแต่</Label>
          <HourSelect label="จาก" value={fromHour} onChange={setFromHour} />
          <span className="text-sm text-muted-foreground">ถึง</span>
          <HourSelect label="ถึง" value={toHour} onChange={setToHour} />
          <span className="text-sm text-muted-foreground">ของวันถัดไป{loading && " · กำลังโหลด..."}</span>
        </div>

        <div className="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <SummaryTile label="ยอดขายรวม (รวม Delivery)" value={formatCurrency(totals.salesTotal, currency)} />
          <SummaryTile label="รายจ่ายรวม" value={formatCurrency(totals.expenses, currency)} sub={`เฉลี่ย ${formatCurrency(avgExpensePerDay, currency)}/วัน`} />
          <SummaryTile
            label="กำไร/ขาดทุนรวมทั้งช่วง"
            value={formatCurrency(totals.netProfit, currency)}
            tone={totals.netProfit < 0 ? "neg" : totals.netProfit > 0 ? "pos" : "flat"}
            palette="profit"
            highlight
          />
          <SummaryTile
            label={`ส่วนต่างจากการนับเงินสด+โอน รวม (ไม่ใช่กำไรขาดทุน)${totals.combinedKnownDays < totals.totalDays ? ` · นับแล้ว ${totals.combinedKnownDays}/${totals.totalDays} วัน` : ""}`}
            value={formatCurrency(totals.combined, currency)}
            tone={totals.combined < 0 ? "neg" : totals.combined > 0 ? "pos" : "flat"}
            secondary
          />
        </div>

        {/* Desktop/tablet: one wide table, horizontal-scroll if needed. Mobile: a stacked card per
            day instead — the same data and the same inline cash-count inputs, just laid out for a
            narrow screen a person is actually typing on at the end of a shift. */}
        <div className="hidden md:block">
          <LedgerTable
            rows={ledgerRows}
            currency={currency}
            shopId={shopId}
            appUser={appUser}
            expandedDay={expandedDay}
            onToggle={toggleExpand}
            confirmingDays={confirmingDays}
            onConfirmPending={confirmPendingTransfer}
            expenses={expenses}
            transfers={transfers}
            orders={orders}
            floats={floats}
            fromHour={fromHour}
            onSelectOrder={setSelectedOrder}
          />
        </div>
        <div className="space-y-3 md:hidden">
          <LedgerCards
            rows={ledgerRows}
            currency={currency}
            shopId={shopId}
            appUser={appUser}
            expandedDay={expandedDay}
            onToggle={toggleExpand}
            confirmingDays={confirmingDays}
            onConfirmPending={confirmPendingTransfer}
            expenses={expenses}
            transfers={transfers}
            orders={orders}
            floats={floats}
            fromHour={fromHour}
            onSelectOrder={setSelectedOrder}
          />
        </div>
        {ledgerRows.length === 0 ? <p className="mt-3 text-center text-sm text-muted-foreground">ไม่มีข้อมูลในช่วงนี้</p> : null}

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>รายจ่ายประจำ</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-3 text-sm text-muted-foreground">
              รายการที่ตั้งไว้ที่นี่จะถูกสร้างเป็นแถวรายจ่ายในตารางด้านบนให้อัตโนมัติทุกวัน (เช่น ค่าเช่าที่ ค่าพนักงาน ค่าเน็ต) — ถ้าวันไหนหยุด
              ให้ไปลบแถวรายจ่ายของวันนั้นในรายละเอียดแถวได้เลย ระบบจะไม่สร้างซ้ำให้วันนั้นอีก
            </p>
            <Table className="table-fixed min-w-[640px]">
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
      </AdminSection>

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
                {selectedOrder.paymentMethodName ? <p className="text-muted-foreground">ชำระโดย {selectedOrder.paymentMethodName}</p> : null}
              </div>
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
    </ModuleGate>
  );
}

function SummaryTile({
  label,
  value,
  sub,
  tone = "flat",
  highlight = false,
  secondary = false,
  palette = "cash",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "neg" | "pos" | "flat";
  highlight?: boolean;
  /** A smaller, dashed-border tile for a secondary/supporting figure — used for the cash-count
   * check tile so it never reads with the same weight as the กำไร/ขาดทุน headline tile. */
  secondary?: boolean;
  /** "profit" uses green for a positive value instead of the default blue, so a reader never
   * mistakes a cash-count surplus ("pos", blue) for actual profit ("profit", green). */
  palette?: "cash" | "profit";
}) {
  const toneValue = tone === "neg" ? -1 : tone === "pos" ? 1 : 0;
  return (
    <div
      className={cn(
        "rounded-lg border p-3",
        highlight ? "border-primary sm:col-span-2" : "border-border",
        secondary && "border-dashed sm:col-span-2"
      )}
    >
      <p className="text-xs leading-snug text-muted-foreground">{label}</p>
      <p className={cn("mt-0.5 font-semibold", highlight ? "text-lg" : secondary ? "text-sm" : "text-base", palette === "profit" ? profitClassName(toneValue) : netClassName(toneValue))}>
        {value}
      </p>
      {sub ? <p className="text-xs text-muted-foreground">{sub}</p> : null}
    </div>
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
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

function todayKey(): string {
  return bangkokDateKey(Date.now());
}

/** Color-codes a cash-count/transfer difference (ขาด=red, เกิน=blue) so it reads unambiguously
 * without relying on spotting a lone "-". Used only for the secondary "ตรวจนับเงินสด" check. */
function netClassName(net: number): string {
  if (net < 0) return "text-destructive";
  if (net > 0) return "text-blue-600 dark:text-blue-400";
  return "";
}

/** Color-codes a กำไร/ขาดทุน figure (ขาดทุน=red, กำไร=green) — a deliberately different palette
 * from `netClassName` so a reader never confuses actual profit/loss with the cash-count check. */
function profitClassName(net: number): string {
  if (net < 0) return "text-destructive";
  if (net > 0) return "text-emerald-600 dark:text-emerald-400";
  return "";
}

// ================================================================================================
// Row-level editable cash-float fields — shared by the desktop table row and the mobile card via
// one hook per rendered instance, so each stays in sync with live Firestore data independently of
// which layout is currently visible (only one is ever shown via CSS, but both mount).
// ================================================================================================

function useDailyFloatFields(
  shopId: string | undefined,
  businessDayKey: string,
  float: DailyFloat | null,
  // Pre-fills "เงินสดเริ่มต้น" with yesterday's นับปลายกะ when today's own figure hasn't been
  // entered yet (`LedgerDayRow.effectiveStartingCash`) — still just a suggestion sitting in the
  // text field, not written anywhere until the person actually blurs the input.
  carriedStartingCash: number | null,
  updatedBy: string,
  updatedByName: string
) {
  const [startingCashText, setStartingCashText] = useState(
    float?.startingCash != null ? String(float.startingCash) : carriedStartingCash != null ? String(carriedStartingCash) : ""
  );
  const [cashMovedOutText, setCashMovedOutText] = useState(float?.cashMovedOut != null ? String(float.cashMovedOut) : "");
  const [closingCashText, setClosingCashText] = useState(float?.closingCashCounted != null ? String(float.closingCashCounted) : "");
  const [adjustmentText, setAdjustmentText] = useState(float?.cashTransferAdjustment != null ? String(float.cashTransferAdjustment) : "");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStartingCashText(float?.startingCash != null ? String(float.startingCash) : carriedStartingCash != null ? String(carriedStartingCash) : "");
    setCashMovedOutText(float?.cashMovedOut != null ? String(float.cashMovedOut) : "");
    setClosingCashText(float?.closingCashCounted != null ? String(float.closingCashCounted) : "");
    setAdjustmentText(float?.cashTransferAdjustment != null ? String(float.cashTransferAdjustment) : "");
  }, [businessDayKey, float?.startingCash, carriedStartingCash, float?.cashMovedOut, float?.closingCashCounted, float?.cashTransferAdjustment]);

  function parseOrNull(text: string): number | null {
    const trimmed = text.trim();
    if (trimmed === "") return null;
    const n = Number(trimmed);
    return Number.isFinite(n) ? n : null;
  }
  function parseNonNegativeOrNull(text: string): number | null {
    const n = parseOrNull(text);
    return n != null ? Math.abs(n) : null;
  }

  async function save(patch: Partial<Pick<DailyFloat, "startingCash" | "cashMovedOut" | "cashTransferAdjustment" | "closingCashCounted" | "closingCashCountedAt">>) {
    if (!shopId) return;
    setSaving(true);
    setSaveError(null);
    try {
      await dailyFloatRepository.upsert(shopId, businessDayKey, { ...patch, updatedBy, updatedByName, updatedAt: Date.now() });
    } catch (err) {
      console.error(`[dailyFloats] upsert(${businessDayKey}) failed — is firestore.rules deployed?`, err);
      setSaveError("บันทึกไม่สำเร็จ — ลองใหม่อีกครั้ง");
    } finally {
      setSaving(false);
    }
  }

  return {
    startingCashText,
    setStartingCashText,
    saveStartingCash: () => save({ startingCash: parseOrNull(startingCashText) }),
    cashMovedOutText,
    setCashMovedOutText,
    saveCashMovedOut: () => {
      const normalized = parseNonNegativeOrNull(cashMovedOutText);
      setCashMovedOutText(normalized != null ? String(normalized) : "");
      save({ cashMovedOut: normalized });
    },
    closingCashText,
    setClosingCashText,
    saveClosingCash: () => {
      const counted = parseOrNull(closingCashText);
      save({ closingCashCounted: counted, closingCashCountedAt: counted != null ? Date.now() : null });
    },
    adjustmentText,
    setAdjustmentText,
    saveAdjustment: () => save({ cashTransferAdjustment: parseOrNull(adjustmentText) }),
    saving,
    saveError,
  };
}

type FloatFields = ReturnType<typeof useDailyFloatFields>;

function blurOnEnter(e: React.KeyboardEvent<HTMLInputElement>) {
  if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
}

// ================================================================================================
// Desktop table
// ================================================================================================

interface LedgerListProps {
  rows: LedgerDayRow[];
  currency: string;
  shopId: string | undefined;
  appUser: { id: string; name: string } | null | undefined;
  expandedDay: string | null;
  onToggle: (dateKey: string) => void;
  confirmingDays: Set<string>;
  onConfirmPending: (row: LedgerDayRow) => void;
  expenses: Expense[];
  transfers: BankTransfer[];
  orders: Order[];
  floats: DailyFloat[];
  fromHour: number;
  onSelectOrder: (order: Order) => void;
}

function LedgerTable(props: LedgerListProps) {
  const { rows } = props;
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead />
          <TableHead>วันทำการ</TableHead>
          <TableHead className="text-right">ยอดขาย</TableHead>
          <TableHead className="text-right" title="เงินสดที่ควรเหลือในลิ้นชักตอนนี้ (หลังหักรายจ่ายเงินสดและเงินที่โยกออกไปเก็บแล้ว)">
            เงินสดคงเหลือ
          </TableHead>
          <TableHead className="text-right">รายจ่าย</TableHead>
          <TableHead className="text-right" title="ยอดขายทุกช่องทาง หักรายจ่ายทั้งหมด — ไม่เกี่ยวกับผลการนับเงินสด">
            กำไร/ขาดทุน
          </TableHead>
          <TableHead>สถานะ</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => (
          <LedgerTableRow key={r.dateKey} row={r} {...props} isExpanded={props.expandedDay === r.dateKey} />
        ))}
        {rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={7} className="text-center text-muted-foreground">
              ไม่มีข้อมูลในช่วงนี้
            </TableCell>
          </TableRow>
        ) : null}
      </TableBody>
    </Table>
  );
}

function LedgerTableRow({
  row,
  currency,
  shopId,
  appUser,
  isExpanded,
  onToggle,
  confirmingDays,
  onConfirmPending,
  expenses,
  transfers,
  orders,
  floats,
  fromHour,
  onSelectOrder,
}: LedgerListProps & { row: LedgerDayRow; isExpanded: boolean }) {
  const float = floats.find((f) => f.businessDayKey === row.dateKey) ?? null;
  const fields = useDailyFloatFields(shopId, row.dateKey, float, row.effectiveStartingCash, appUser?.id ?? "", appUser?.name ?? "");
  const isToday = isTodayRow(row.dateKey, fromHour);

  return (
    <Fragment>
      <TableRow className={cn("cursor-pointer hover:bg-accent/50", isToday && "bg-primary/5")} onClick={() => onToggle(row.dateKey)}>
        <TableCell className="w-6 text-muted-foreground">
          <span className={cn("inline-block transition-transform", isExpanded && "rotate-90")}>▶</span>
        </TableCell>
        <TableCell className="font-medium">{formatKey(row.dateKey)}</TableCell>
        <TableCell className="text-right">
          <div className="font-medium">{formatCurrency(row.salesTotal, currency)}</div>
          <SalesBreakdown row={row} currency={currency} />
        </TableCell>
        <TableCell className="text-right">
          <div>{row.cashRemainingNow != null ? formatCurrency(row.cashRemainingNow, currency) : "–"}</div>
          <p className="text-xs text-muted-foreground">ควรมีในลิ้นชัก</p>
        </TableCell>
        <TableCell className="text-right">{formatCurrency(row.expenses, currency)}</TableCell>
        <TableCell className="text-right">
          <ProfitCell row={row} currency={currency} />
        </TableCell>
        <TableCell>
          <StatusBadge row={row} currency={currency} />
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={7} className="bg-muted/30 p-0">
            <LedgerDetailPanel
              row={row}
              fields={fields}
              currency={currency}
              shopId={shopId}
              appUser={appUser}
              confirmingDays={confirmingDays}
              onConfirmPending={onConfirmPending}
              expenses={expenses}
              transfers={transfers}
              orders={orders}
              fromHour={fromHour}
              onSelectOrder={onSelectOrder}
            />
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
}

// ================================================================================================
// Mobile cards
// ================================================================================================

function LedgerCards(props: LedgerListProps) {
  return (
    <>
      {props.rows.map((r) => (
        <LedgerCardItem key={r.dateKey} row={r} {...props} isExpanded={props.expandedDay === r.dateKey} />
      ))}
    </>
  );
}

function LedgerCardItem({
  row,
  currency,
  shopId,
  appUser,
  isExpanded,
  onToggle,
  confirmingDays,
  onConfirmPending,
  expenses,
  transfers,
  orders,
  floats,
  fromHour,
  onSelectOrder,
}: LedgerListProps & { row: LedgerDayRow; isExpanded: boolean }) {
  const float = floats.find((f) => f.businessDayKey === row.dateKey) ?? null;
  const fields = useDailyFloatFields(shopId, row.dateKey, float, row.effectiveStartingCash, appUser?.id ?? "", appUser?.name ?? "");
  const isToday = isTodayRow(row.dateKey, fromHour);

  return (
    <Card className={cn(isToday && "border-primary")}>
      <CardContent className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="font-medium">{formatKey(row.dateKey)}</span>
          <StatusBadge row={row} currency={currency} />
        </div>
        <div className="mb-2 rounded-md bg-muted/40 p-2 text-center">
          <ProfitCell row={row} currency={currency} big />
          <p className="text-xs text-muted-foreground">กำไร/ขาดทุนวันนี้ (ยอดขาย − รายจ่าย)</p>
        </div>
        <p className="mb-2 text-xs text-muted-foreground">
          <SalesBreakdown row={row} currency={currency} />
        </p>
        <div className="mb-2 grid grid-cols-2 gap-2 text-sm">
          <StatPair label="รายจ่ายรวม" value={formatCurrency(row.expenses, currency)} />
          <StatPair label="เงินสดควรมีในลิ้นชัก" value={row.cashRemainingNow != null ? formatCurrency(row.cashRemainingNow, currency) : "–"} />
        </div>
        <Button variant="outline" size="sm" className="w-full" onClick={() => onToggle(row.dateKey)}>
          {isExpanded ? "ซ่อนรายละเอียด ▲" : "ดูรายละเอียด / ตรวจนับเงินสด ▼"}
        </Button>
        {isExpanded ? (
          <div className="mt-3 -mx-3 -mb-3 border-t border-border bg-muted/30 p-3">
            <LedgerDetailPanel
              row={row}
              fields={fields}
              currency={currency}
              shopId={shopId}
              appUser={appUser}
              confirmingDays={confirmingDays}
              onConfirmPending={onConfirmPending}
              expenses={expenses}
              transfers={transfers}
              orders={orders}
              fromHour={fromHour}
              onSelectOrder={onSelectOrder}
            />
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function StatPair({ label, value, extra }: { label: string; value: string; extra?: React.ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="font-medium">
        {value}
        {extra}
      </p>
    </div>
  );
}

// ================================================================================================
// Shared small bits (sales breakdown, profit cell, status badge + cash-check warning)
// ================================================================================================

function isTodayRow(dateKey: string, fromHour: number): boolean {
  return dateKey === bangkokDateKeyWithCutoff(Date.now(), fromHour);
}

/** "เงินสด ฿x · QR ฿y · Delivery ฿z" — lets the ยอดขาย cell show the per-channel split at a glance
 * without needing its own columns (that's what made the v1 desktop table too wide for the page's
 * shared max-w-4xl container). */
function SalesBreakdown({ row, currency }: { row: LedgerDayRow; currency: string }) {
  return (
    <p className="text-xs text-muted-foreground">
      เงินสด {formatCurrency(row.cashSales, currency)} · QR {formatCurrency(row.qrSales, currency)}
      {row.deliveryRevenue ? <> · Delivery {formatCurrency(row.deliveryRevenue, currency)}</> : null}
    </p>
  );
}

/** The table's headline figure — ยอดขายทุกช่องทาง หักรายจ่ายทั้งหมด, deliberately independent of the
 * cash-count check (see `LedgerDayRow.netProfit`'s comment). */
function ProfitCell({ row, currency, big = false }: { row: LedgerDayRow; currency: string; big?: boolean }) {
  const label = row.netProfit < 0 ? "ขาดทุน" : row.netProfit > 0 ? "กำไร" : "เท่าทุน";
  return (
    <span className={cn("font-semibold", profitClassName(row.netProfit), big && "text-xl")}>
      {formatCurrency(Math.abs(row.netProfit), currency)} {label}
    </span>
  );
}

function StatusBadge({ row, currency }: { row: LedgerDayRow; currency: string }) {
  return (
    <span className="inline-flex items-center gap-1">
      <Badge variant={row.settled ? "success" : "default"}>{row.settled ? "ครบ" : "รอ"}</Badge>
      <CashCheckWarning row={row} currency={currency} />
    </span>
  );
}

/** A small ⚠ next to สถานะ when the physical cash count came out off from what the system expects
 * — the one signal from the old "ส่วนต่างรวม" column kept visible without expanding the row, now
 * that the count check itself lives in the detail panel instead of the headline. */
function CashCheckWarning({ row, currency }: { row: LedgerDayRow; currency: string }) {
  if (row.cashDifference == null || row.cashDifference === 0) return null;
  const label = row.cashDifference > 0 ? "เกิน" : "ขาด";
  return (
    <span
      className="cursor-help text-amber-600 dark:text-amber-400"
      title={`นับเงินสดปลายกะ${label} ${formatCurrency(Math.abs(row.cashDifference), currency)} จากที่ระบบคาด — ดูรายละเอียด`}
    >
      ⚠
    </span>
  );
}

// ================================================================================================
// Expanded detail panel — รายจ่าย/เงินโอน/Delivery/บิลวันนี้ for exactly this one business day.
// ================================================================================================

function LedgerDetailPanel({
  row,
  fields,
  currency,
  shopId,
  appUser,
  confirmingDays,
  onConfirmPending,
  expenses,
  transfers,
  orders,
  fromHour,
  onSelectOrder,
}: {
  row: LedgerDayRow;
  fields: FloatFields;
  currency: string;
  shopId: string | undefined;
  appUser: { id: string; name: string } | null | undefined;
  confirmingDays: Set<string>;
  onConfirmPending: (row: LedgerDayRow) => void;
  expenses: Expense[];
  transfers: BankTransfer[];
  orders: Order[];
  fromHour: number;
  onSelectOrder: (order: Order) => void;
}) {
  const dayExpenses = useMemo(
    () => expenses.filter((e) => e.dateKey === row.dateKey).sort((a, b) => b.createdAt - a.createdAt),
    [expenses, row.dateKey]
  );
  const dayTransfers = useMemo(
    () => transfers.filter((t) => t.businessDayKey === row.dateKey).sort((a, b) => b.transferredAt - a.transferredAt),
    [transfers, row.dateKey]
  );
  const dayOrders = useMemo(
    () =>
      orders
        .filter((o) => bangkokDateKeyWithCutoff(o.paidAt ?? o.createdAt, fromHour) === row.dateKey)
        .sort((a, b) => (a.paidAt ?? a.createdAt) - (b.paidAt ?? b.createdAt)),
    [orders, row.dateKey, fromHour]
  );

  return (
    <div className="grid gap-5 p-4 sm:grid-cols-3">
      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">สรุปกำไร-ขาดทุน</h4>
        <CalcRow k="ยอดขายรวม (เงินสด+QR+Delivery)" v={formatCurrency(row.salesTotal, currency)} />
        <CalcRow k="รายจ่ายรวม" v={formatCurrency(row.expenses, currency)} />
        <CalcRow
          k={row.netProfit < 0 ? "ขาดทุน" : row.netProfit > 0 ? "กำไร" : "เท่าทุน"}
          v={formatCurrency(Math.abs(row.netProfit), currency)}
          tone={row.netProfit}
          palette="profit"
        />

        <h4 className="mb-2 mt-5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">ตรวจนับเงินสด</h4>
        <p className="mb-2 text-[11px] leading-snug text-muted-foreground">
          เช็คว่าเงินสดที่นับได้จริงตรงกับที่ระบบคำนวณไหม (จับกรณีนับผิด หรือพนักงานกดรับเงินผิดช่องทาง) — ไม่ใช่กำไรขาดทุนของร้าน
        </p>
        <div className="mb-3 grid grid-cols-3 gap-2">
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">เงินสดเริ่มต้น</Label>
            <Input
              type="number"
              inputMode="decimal"
              value={fields.startingCashText}
              onChange={(e) => fields.setStartingCashText(e.target.value)}
              onBlur={fields.saveStartingCash}
              onKeyDown={blurOnEnter}
              placeholder="–"
              className="h-9 text-right"
            />
            {row.startingCashIsCarriedForward ? (
              <p className="mt-1 text-[11px] leading-tight text-muted-foreground">ดึงจากนับปลายกะเมื่อวาน ถ้าตรงไม่ต้องแก้</p>
            ) : null}
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground">โยกออก</Label>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={fields.cashMovedOutText}
              onChange={(e) => fields.setCashMovedOutText(e.target.value)}
              onBlur={fields.saveCashMovedOut}
              onKeyDown={blurOnEnter}
              className="h-9 text-right"
            />
          </div>
          <div>
            <Label className="mb-1 block text-xs text-muted-foreground" title="นับหลังหยิบเงินออกไปเก็บแล้ว">
              นับปลายกะ
            </Label>
            <Input
              type="number"
              inputMode="decimal"
              value={fields.closingCashText}
              onChange={(e) => fields.setClosingCashText(e.target.value)}
              onBlur={fields.saveClosingCash}
              onKeyDown={blurOnEnter}
              placeholder="ยังไม่นับ"
              className="h-9 text-right"
            />
          </div>
        </div>
        <div className="mb-3">
          <Label className="mb-1 block text-xs text-muted-foreground">ยอดปรับ (สลับเงินสด/โอน)</Label>
          <Input
            type="number"
            inputMode="decimal"
            value={fields.adjustmentText}
            onChange={(e) => fields.setAdjustmentText(e.target.value)}
            onBlur={fields.saveAdjustment}
            onKeyDown={blurOnEnter}
            className="h-9 text-right"
          />
          <p className="mt-1 text-[11px] leading-tight text-muted-foreground">+ = บันทึกเป็นเงินสดผิด ที่จริงเป็นโอน · - = บันทึกเป็นโอนผิด ที่จริงเป็นเงินสด</p>
        </div>
        <CalcRow k="เงินสดที่ควรเหลือตอนนี้" v={row.cashRemainingNow != null ? formatCurrency(row.cashRemainingNow, currency) : "-"} />
        <CalcRow
          k="ส่วนต่างจากการนับ"
          v={
            row.cashDifference != null
              ? `${row.cashDifference < 0 ? "ขาด " : row.cashDifference > 0 ? "เกิน " : "ตรง "}${formatCurrency(Math.abs(row.cashDifference), currency)}`
              : "-"
          }
          tone={row.cashDifference ?? 0}
        />
        <div className="mt-2 flex items-center justify-between border-t border-border pt-2 text-sm">
          <span>รอโอน / เกิน</span>
          {row.pendingTransfer > 0 ? (
            <span className="inline-flex items-center gap-2">
              <span className="text-amber-600 dark:text-amber-400">{formatCurrency(row.pendingTransfer, currency)}</span>
              <button
                type="button"
                className="text-xs text-primary underline disabled:opacity-50"
                disabled={confirmingDays.has(row.dateKey)}
                onClick={() => onConfirmPending(row)}
              >
                ติ๊กว่าโอนแล้ว
              </button>
            </span>
          ) : row.overTransferred > 0 ? (
            <span className="text-blue-600 dark:text-blue-400" title="ยอดที่โอนเข้ามากกว่ายอด QR ที่ระบบคำนวณ — เช็คว่ามีแถวกรอกผิด/กรอกซ้ำ">
              เกิน {formatCurrency(row.overTransferred, currency)}
            </span>
          ) : (
            <span className="text-muted-foreground">-</span>
          )}
        </div>
        {fields.saving ? <p className="mt-2 text-xs text-muted-foreground">กำลังบันทึก...</p> : null}
        {fields.saveError ? <p className="mt-2 text-xs text-destructive">{fields.saveError}</p> : null}
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">รายจ่าย</h4>
        <div className="space-y-1">
          {shopId && appUser ? <ExpenseQuickAddRowInline shopId={shopId} createdBy={appUser.id} createdByName={appUser.name} dateKey={row.dateKey} /> : null}
          {dayExpenses.map((e) => (
            <ExpenseRowInline key={e.id} expense={e} currency={currency} />
          ))}
          {dayExpenses.length === 0 ? <p className="text-sm text-muted-foreground">ยังไม่มีรายจ่ายวันนี้</p> : null}
          <p className="flex justify-between border-t border-dashed border-border pt-1 text-sm text-muted-foreground">
            <span>รวมรายจ่าย</span>
            <span>{formatCurrency(row.expenses, currency)}</span>
          </p>
        </div>
      </div>

      <div>
        <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">เงินโอนเข้าบัญชี</h4>
        <div className="space-y-1">
          {shopId && appUser ? (
            <TransferQuickAddRowInline shopId={shopId} businessDayKey={row.dateKey} createdBy={appUser.id} createdByName={appUser.name} />
          ) : null}
          {dayTransfers.map((t) => (
            <TransferRowInline key={t.id} transfer={t} currency={currency} />
          ))}
          {dayTransfers.length === 0 ? <p className="text-sm text-muted-foreground">ยังไม่มีรายการโอนวันนี้</p> : null}
          <p className="flex justify-between border-t border-dashed border-border pt-1 text-sm text-muted-foreground">
            <span>รวมที่โอนเข้า (ไม่รวม Delivery)</span>
            <span>{formatCurrency(row.transferred, currency)}</span>
          </p>
        </div>

        <h4 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted-foreground">บิลวันนี้ ({dayOrders.length} บิล)</h4>
        <div className="max-h-48 space-y-1 overflow-y-auto">
          {dayOrders.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => onSelectOrder(o)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-sm hover:bg-accent"
            >
              <span className="truncate text-muted-foreground">
                {o.orderNumber || "—"} · {o.tableName ? `โต๊ะ ${o.tableName}` : o.channelName}
              </span>
              <span className="shrink-0">{formatCurrency(o.total, currency)}</span>
            </button>
          ))}
          {dayOrders.length === 0 ? <p className="text-sm text-muted-foreground">ไม่มีบิลวันนี้</p> : null}
        </div>
      </div>
    </div>
  );
}

function CalcRow({ k, v, tone, palette = "cash" }: { k: string; v: string; tone?: number; palette?: "cash" | "profit" }) {
  const toneClass = tone == null ? undefined : palette === "profit" ? profitClassName(tone) : netClassName(tone);
  return (
    <div className="flex justify-between py-0.5 text-sm">
      <span className="text-muted-foreground">{k}</span>
      <span className={cn("font-medium", toneClass)}>{v}</span>
    </div>
  );
}

// ================================================================================================
// รายจ่าย — quick-add + row, scoped to one already-known day (no date picker needed, the day is
// whichever row's detail panel this is rendered inside).
// ================================================================================================

function ExpenseQuickAddRowInline({
  shopId,
  createdBy,
  createdByName,
  dateKey,
}: {
  shopId: string;
  createdBy: string;
  createdByName: string;
  dateKey: string;
}) {
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
    <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted/40 p-1.5">
      <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
        <SelectTrigger className="h-8 w-24 text-xs">
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
      <Input
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        placeholder="รายการ (ไม่บังคับ)"
        className="h-8 min-w-0 flex-1 text-xs"
      />
      <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as "cash" | "transfer")}>
        <SelectTrigger className="h-8 w-20 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="cash">เงินสด</SelectItem>
          <SelectItem value="transfer">โอน</SelectItem>
        </SelectContent>
      </Select>
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        value={amountText}
        onChange={(e) => setAmountText(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        placeholder="0.00"
        className="h-8 w-20 text-right text-xs"
      />
      <Button size="sm" className="h-8 px-2" onClick={handleAdd} disabled={!canSave || saving}>
        +
      </Button>
    </div>
  );
}

function ExpenseRowInline({ expense, currency }: { expense: Expense; currency: string }) {
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
    const confirmMessage = expense.recurringExpenseId
      ? `ลบรายจ่ายประจำ "${label}" ${formatCurrency(expense.amount, currency)}? (จะไม่สร้างรายการนี้ซ้ำสำหรับวันนี้อีก)`
      : `ลบรายจ่าย "${label}" ${formatCurrency(expense.amount, currency)}?`;
    if (!window.confirm(confirmMessage)) return;
    if (expense.recurringExpenseId) {
      await recurringExpenseSkipRepository.skip(expense.shopId, expense.recurringExpenseId, expense.dateKey);
    }
    await expenseRepository.remove(expense.id);
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted/40 p-1.5">
        <Select value={category} onValueChange={(v) => setCategory(v as ExpenseCategory)}>
          <SelectTrigger className="h-8 w-24 text-xs">
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
        <Input value={description} onChange={(e) => setDescription(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSave()} className="h-8 min-w-0 flex-1 text-xs" />
        <Select value={paymentMethod} onValueChange={(v) => setPaymentMethod(v as "cash" | "transfer")}>
          <SelectTrigger className="h-8 w-20 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="cash">เงินสด</SelectItem>
            <SelectItem value="transfer">โอน</SelectItem>
          </SelectContent>
        </Select>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="h-8 w-20 text-right text-xs"
        />
        <Button size="sm" className="h-8 px-2" onClick={handleSave} disabled={!canSave || saving}>
          บันทึก
        </Button>
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditing(false)}>
          ยกเลิก
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent/50">
      <div className="min-w-0">
        <Badge variant="muted" className="mr-1 align-middle text-[10px]">
          {expense.category}
        </Badge>
        <span className="text-muted-foreground">{expense.description || "-"}</span>
        {expense.recurringExpenseId ? (
          <Badge variant="muted" className="ml-1 align-middle text-[10px]">
            ประจำ
          </Badge>
        ) : null}
        <span className="ml-1 text-xs text-muted-foreground">({expense.paymentMethod === "cash" ? "เงินสด" : "โอน"})</span>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-medium">{formatCurrency(expense.amount, currency)}</span>
        <button type="button" className="text-xs text-primary underline" onClick={startEdit}>
          แก้ไข
        </button>
        <button type="button" className="text-xs text-destructive underline" onClick={handleDelete}>
          ลบ
        </button>
      </div>
    </div>
  );
}

// ================================================================================================
// เงินโอนเข้าบัญชี — quick-add + row, scoped to one already-known business day.
// ================================================================================================

function TransferQuickAddRowInline({
  shopId,
  businessDayKey,
  createdBy,
  createdByName,
}: {
  shopId: string;
  businessDayKey: string;
  createdBy: string;
  createdByName: string;
}) {
  const [amount1Text, setAmount1Text] = useState("");
  const [amount2Text, setAmount2Text] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const amount1 = Number(amount1Text);
  const amount2 = Number(amount2Text);
  const hasAmount1 = amount1Text.trim() !== "" && Number.isFinite(amount1) && amount1 > 0;
  const hasAmount2 = amount2Text.trim() !== "" && Number.isFinite(amount2) && amount2 > 0;
  const canSave = hasAmount1 || hasAmount2;

  async function handleAdd() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      // Batch 1 (16:00-23:00) settles at 23:00 on the business-day label date itself; batch 2
      // (23:00-04:00) settles at 23:00 the *next* calendar day — see `reconciliation.ts`'s file
      // comment for why K SHOP's cutoff splits one shift's transfers across two calendar nights.
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
    <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted/40 p-1.5">
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        value={amount1Text}
        onChange={(e) => setAmount1Text(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        placeholder="16:00-23:00"
        className="h-8 w-24 text-right text-xs"
      />
      <Input
        type="number"
        inputMode="decimal"
        min={0}
        value={amount2Text}
        onChange={(e) => setAmount2Text(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        placeholder="23:00-04:00"
        className="h-8 w-24 text-right text-xs"
      />
      <Input
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && handleAdd()}
        placeholder="หมายเหตุ"
        className="h-8 min-w-0 flex-1 text-xs"
      />
      <Button size="sm" className="h-8 px-2" onClick={handleAdd} disabled={!canSave || saving}>
        +
      </Button>
    </div>
  );
}

function TransferRowInline({ transfer, currency }: { transfer: BankTransfer; currency: string }) {
  const isBatch1 = bangkokDateKey(transfer.transferredAt) === transfer.businessDayKey;
  const [editing, setEditing] = useState(false);
  const [amountText, setAmountText] = useState(String(transfer.amount));
  const [note, setNote] = useState(transfer.note);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setAmountText(String(transfer.amount));
    setNote(transfer.note);
    setEditing(true);
  }

  const amount = Number(amountText);
  const canSave = Number.isFinite(amount) && amount > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await bankTransferRepository.update(transfer.id, { amount, note: note.trim() });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`ลบรายการโอน ${formatCurrency(transfer.amount, currency)}?`)) return;
    await bankTransferRepository.remove(transfer.id);
  }

  if (editing) {
    return (
      <div className="flex flex-wrap items-center gap-1 rounded-md bg-muted/40 p-1.5">
        <span className="text-xs text-muted-foreground">{isBatch1 ? "16:00-23:00" : "23:00-04:00"}</span>
        <Input
          type="number"
          inputMode="decimal"
          min={0}
          value={amountText}
          onChange={(e) => setAmountText(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSave()}
          className="h-8 w-24 text-right text-xs"
        />
        <Input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSave()} className="h-8 min-w-0 flex-1 text-xs" />
        <Button size="sm" className="h-8 px-2" onClick={handleSave} disabled={!canSave || saving}>
          บันทึก
        </Button>
        <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditing(false)}>
          ยกเลิก
        </Button>
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-accent/50">
      <span className="min-w-0 truncate text-muted-foreground">
        {isBatch1 ? "16:00-23:00" : "23:00-04:00"}
        {transfer.note ? ` · ${transfer.note}` : ""}
      </span>
      <div className="flex shrink-0 items-center gap-2">
        <span className="font-medium">{formatCurrency(transfer.amount, currency)}</span>
        <button type="button" className="text-xs text-primary underline" onClick={startEdit}>
          แก้ไข
        </button>
        <button type="button" className="text-xs text-destructive underline" onClick={handleDelete}>
          ลบ
        </button>
      </div>
    </div>
  );
}

// ================================================================================================
// รายจ่ายประจำ — unchanged from the previous page: config, not a per-day ledger row.
// ================================================================================================

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
        `ลบรายจ่ายประจำ "${label}" ${formatCurrency(template.amount, currency)}/วัน? (รายการที่สร้างไปแล้วจะยังอยู่เหมือนเดิม แค่จะไม่สร้างวันใหม่ๆ ให้อีก)`
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
