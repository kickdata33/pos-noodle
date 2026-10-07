"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { DateField } from "@/components/admin/DateField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { bangkokDateKey } from "@/lib/pos/dateRange";
import {
  DAYS_PER_MONTH,
  computePaybackProgress,
  computeTargetPaybackPlan,
  summarizeHistoricalPerformance,
  summarizeInvestments,
} from "@/lib/pos/investmentAnalysis";
import { deliveryPayoutRepository } from "@/repositories/deliveryPayoutRepository";
import { expenseRepository } from "@/repositories/expenseRepository";
import { investmentRepository } from "@/repositories/investmentRepository";
import { orderRepository } from "@/repositories/orderRepository";
import { shopRepository } from "@/repositories/shopRepository";
import type { DeliveryPayout, Expense, InvestmentItem, Order } from "@/types";

function todayKey(): string {
  return bangkokDateKey(Date.now());
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

const TARGET_MONTH_PRESETS = [6, 12, 18, 24, 36];

/**
 * สรุปการลงทุน (item: "อยากได้ หน้า สรุปการลงทุน ไม่ว่าจะเป็นค่าเซ้ง ค่าของ ที่ลงทุนไปทั้งหมด และ
 * วิเคราะห์ จากรายรับรายจ่าย ระยะเวลาคืนทุน ยอดขายที่ควรจะมี เฉลี่ย ต่อวันต่อเดือน"). Universal
 * feature, not one of the four shop-specific modules — deliberately no `ModuleGate` here (see
 * `AdminNav`'s file comment for which pages do need one and why).
 *
 * Investment items are free-text with no fixed category list, unlike `ExpenseCategory` (see
 * `types/investment.ts`'s file comment) — the shop owner's own pick when asked, since an
 * investment is usually one-off and highly specific ("ตู้แช่ 2 บาน มือสอง"), so a category picker
 * would mostly just get in the way.
 *
 * Shows both kinds of payback analysis the owner asked for ("ทั้งสองแบบ (แนะนำ)" — their own
 * choice when offered a choice between them):
 *  - actual historical pace → `computePaybackProgress` (how much has really come back so far,
 *    projected forward at the shop's own average)
 *  - a target period the owner picks → `computeTargetPaybackPlan` ("ถ้าอยากคืนทุนภายใน N เดือน
 *    ต้องขายเท่าไหร่")
 *
 * All the math lives in `lib/pos/investmentAnalysis.ts` (pure, unit-tested in
 * `scripts/investmentAnalysis.test.ts`) — this page is just wiring: live-subscribe
 * `investments`/`expenses`/`deliveryPayouts` for the shop's whole history (same pattern as
 * `/admin/cash-safe`), one-time fetch every PAID order ever (`orderRepository.listAllPaidForShop`
 * — reuses the existing index, see that method's own comment for why no new index is needed), and
 * hand the four to the calculators.
 */
export default function InvestmentPage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;

  const [currency, setCurrency] = useState("THB");
  const [items, setItems] = useState<InvestmentItem[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [deliveryPayouts, setDeliveryPayouts] = useState<DeliveryPayout[]>([]);
  const [ordersLoaded, setOrdersLoaded] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [targetMonths, setTargetMonths] = useState(12);

  useEffect(() => {
    if (!shopId) return;
    shopRepository.getSettings(shopId).then((settings) => {
      if (settings) setCurrency(settings.currency);
    });
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return investmentRepository.subscribeForShop(shopId, setItems);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return expenseRepository.subscribeForShop(shopId, setExpenses);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return deliveryPayoutRepository.subscribeForShop(shopId, setDeliveryPayouts);
  }, [shopId]);

  // One-time fetch, not a live subscription — the shop's whole order history can be large and
  // this page only needs totals/averages out of it, same choice `/admin/reports` makes for its
  // own (range-limited) order fetch. One-shot fetch-on-dependency-change, not a subscription to
  // an external system, so there's nothing to move this into — same reasoning as that page's
  // own fetch effect.
  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setOrdersLoaded(false);
    orderRepository
      .listAllPaidForShop(shopId)
      .then((all) => {
        if (cancelled) return;
        setOrders(all);
      })
      .catch((err) => {
        // Same reasoning as `/admin/reports`'s fetch effect — without this, a missing composite
        // index (shopId+status+paidAt) just fails silently and every "เฉลี่ยยอดขาย" figure reads
        // as 0 with nothing on screen to explain why.
        console.error(
          "[investment] listAllPaidForShop failed — is the shopId+status+paidAt Firestore index deployed? See firestore.indexes.json / \"firebase deploy --only firestore:indexes\".",
          err
        );
        if (!cancelled) setOrders([]);
      })
      .finally(() => {
        if (!cancelled) setOrdersLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId]);

  const asOfKey = useMemo(() => todayKey(), []);

  const investmentTotals = useMemo(() => summarizeInvestments(items), [items]);
  const performance = useMemo(
    () => summarizeHistoricalPerformance(orders, deliveryPayouts, expenses, asOfKey),
    [orders, deliveryPayouts, expenses, asOfKey]
  );
  const payback = useMemo(
    () => computePaybackProgress(investmentTotals.totalInvested, performance, asOfKey),
    [investmentTotals.totalInvested, performance, asOfKey]
  );
  const targetPlan = useMemo(
    () => computeTargetPaybackPlan(investmentTotals.totalInvested, targetMonths * DAYS_PER_MONTH, performance),
    [investmentTotals.totalInvested, targetMonths, performance]
  );

  const sortedItems = useMemo(
    () => [...items].sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.createdAt - a.createdAt),
    [items]
  );

  return (
    <AdminSection
      title="สรุปการลงทุน"
      description="เงินลงทุนทั้งหมด (ค่าเซ้ง ค่าตกแต่ง/อุปกรณ์ ของเริ่มต้น ฯลฯ) เทียบกับยอดขายจริง และระยะเวลาคืนทุน"
      actionLabel="+ บันทึกรายการลงทุน"
      onAction={() => setAddOpen(true)}
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <SummaryStat
          label="ยอดลงทุนรวม"
          value={formatCurrency(investmentTotals.totalInvested, currency)}
          sub={`${investmentTotals.itemCount} รายการ`}
        />
        <SummaryStat
          label="กำไรสุทธิสะสม (ตั้งแต่เปิดขาย)"
          value={formatCurrency(payback.cumulativeNet, currency)}
          sub={
            performance.startDateKey
              ? `ตั้งแต่ ${formatDateKey(performance.startDateKey)} (${performance.daysOfHistory} วัน)`
              : "ยังไม่มีข้อมูลยอดขาย/รายจ่าย"
          }
        />
        <SummaryStat
          label="คืนทุนแล้ว"
          value={payback.percentRecovered != null ? `${payback.percentRecovered.toFixed(1)}%` : "-"}
          sub={
            payback.isFullyRecovered
              ? "คืนทุนครบแล้ว"
              : `เหลืออีก ${formatCurrency(Math.max(payback.amountRemaining, 0), currency)}`
          }
          tone={payback.isFullyRecovered ? "success" : undefined}
        />
        <SummaryStat
          label="คาดว่าจะคืนทุน"
          value={
            payback.isFullyRecovered
              ? "คืนทุนแล้ว"
              : payback.estimatedPaybackDateKey
                ? formatDateKey(payback.estimatedPaybackDateKey)
                : "ยังไม่สามารถคาดการณ์ได้"
          }
          sub={
            !payback.isFullyRecovered && payback.estimatedDaysRemaining != null
              ? `อีกประมาณ ${payback.estimatedDaysRemaining} วัน ที่ยอดขายเฉลี่ยตอนนี้`
              : !payback.isFullyRecovered
                ? "ยอดขายเฉลี่ยตอนนี้ยังไม่พอจะคืนทุนได้"
                : undefined
          }
          tone={!payback.isFullyRecovered && payback.estimatedPaybackDateKey == null ? "destructive" : undefined}
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>ยอดขายเฉลี่ยจากที่ขายได้จริง</CardTitle>
          <CardDescription>
            {!ordersLoaded
              ? "กำลังโหลดข้อมูลยอดขาย..."
              : performance.daysOfHistory > 0 && performance.startDateKey
                ? `เฉลี่ยจาก ${performance.daysOfHistory} วันที่มีข้อมูล (${formatDateKey(performance.startDateKey)} ถึง ${formatDateKey(asOfKey)})`
                : "ยังไม่มีข้อมูลยอดขาย/รายจ่ายให้คำนวณ"}
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <MiniStat label="รายรับเฉลี่ย/วัน" value={formatCurrency(performance.avgRevenuePerDay, currency)} />
          <MiniStat label="รายจ่ายเฉลี่ย/วัน" value={formatCurrency(performance.avgExpensePerDay, currency)} />
          <MiniStat
            label="กำไรสุทธิเฉลี่ย/วัน"
            value={formatCurrency(performance.avgNetPerDay, currency)}
            tone={performance.avgNetPerDay < 0 ? "destructive" : "success"}
          />
          <MiniStat label="รายรับเฉลี่ย/เดือน" value={formatCurrency(performance.avgRevenuePerDay * DAYS_PER_MONTH, currency)} />
          <MiniStat label="รายจ่ายเฉลี่ย/เดือน" value={formatCurrency(performance.avgExpensePerDay * DAYS_PER_MONTH, currency)} />
          <MiniStat
            label="กำไรสุทธิเฉลี่ย/เดือน"
            value={formatCurrency(performance.avgNetPerMonth, currency)}
            tone={performance.avgNetPerMonth < 0 ? "destructive" : "success"}
          />
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>ถ้าอยากคืนทุนภายใน...</CardTitle>
          <CardDescription>
            ยอดขายที่ควรจะมีต่อวัน/เดือน ถ้าอยากคืนทุนให้ครบภายในระยะเวลาที่ตั้งไว้ (ใช้รายจ่ายเฉลี่ยจริงด้านบนเป็นต้นทุนตั้งต้น)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <Label htmlFor="target-months" className="text-sm">
              ระยะเวลาที่ต้องการ (เดือน)
            </Label>
            <Input
              id="target-months"
              type="number"
              inputMode="numeric"
              min={1}
              className="w-24"
              value={targetMonths}
              onChange={(e) => setTargetMonths(Math.max(1, Math.round(Number(e.target.value)) || 1))}
            />
            <div className="flex flex-wrap gap-1.5">
              {TARGET_MONTH_PRESETS.map((m) => (
                <Button
                  key={m}
                  size="sm"
                  variant={m === targetMonths ? "default" : "outline"}
                  className="h-7 px-2 text-xs"
                  onClick={() => setTargetMonths(m)}
                >
                  {m} เดือน
                </Button>
              ))}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <MiniStat label="ยอดขายที่ควรมี/วัน" value={formatCurrency(targetPlan.requiredRevenuePerDay, currency)} />
            <MiniStat label="ยอดขายที่ควรมี/เดือน" value={formatCurrency(targetPlan.requiredRevenuePerMonth, currency)} />
          </div>
          <p className={`mt-3 text-sm ${targetPlan.gapRevenuePerDay > 0 ? "text-destructive" : "text-success"}`}>
            {targetPlan.gapRevenuePerDay > 0
              ? `ขายเฉลี่ยตอนนี้ยังขาดอีกวันละ ${formatCurrency(targetPlan.gapRevenuePerDay, currency)} ถึงจะคืนทุนได้ตามเป้านี้`
              : `ขายเฉลี่ยตอนนี้เกินเป้านี้อยู่วันละ ${formatCurrency(Math.abs(targetPlan.gapRevenuePerDay), currency)} แล้ว`}
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>รายการลงทุน</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วันที่</TableHead>
                <TableHead>รายละเอียด</TableHead>
                <TableHead className="text-right">จำนวน</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.map((item) => (
                <TableRow key={item.id}>
                  <TableCell className="whitespace-nowrap">{formatDateKey(item.dateKey)}</TableCell>
                  <TableCell>{item.description}</TableCell>
                  <TableCell className="text-right">{formatCurrency(item.amount, currency)}</TableCell>
                  <TableCell className="text-right">
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-xs text-destructive"
                      onClick={() => investmentRepository.remove(item.id)}
                    >
                      ลบ
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
              {sortedItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    ยังไม่มีรายการลงทุน
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell className="text-muted-foreground">รวม</TableCell>
                  <TableCell />
                  <TableCell className="text-right font-semibold">{formatCurrency(investmentTotals.totalInvested, currency)}</TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <AddInvestmentDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        shopId={shopId ?? ""}
        createdBy={appUser?.id ?? ""}
        createdByName={appUser?.name ?? ""}
      />
    </AdminSection>
  );
}

function SummaryStat({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "success" | "destructive" | "muted";
}) {
  const toneClass = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : tone === "muted" ? "text-muted-foreground" : "";
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className={`text-2xl font-semibold ${toneClass}`}>{value}</p>
        {sub ? <p className="mt-1 text-xs text-muted-foreground">{sub}</p> : null}
      </CardContent>
    </Card>
  );
}

function MiniStat({ label, value, tone }: { label: string; value: string; tone?: "success" | "destructive" }) {
  const toneClass = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "";
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`text-base font-semibold ${toneClass}`}>{value}</p>
    </div>
  );
}

function AddInvestmentDialog({
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
  const [dateKey, setDateKey] = useState(() => todayKey());
  const [description, setDescription] = useState("");
  const [amountText, setAmountText] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDateKey(todayKey());
      setDescription("");
      setAmountText("");
    }
  }, [open]);

  const amount = Number(amountText);
  const canSave =
    Boolean(shopId) && Boolean(dateKey) && description.trim().length > 0 && Number.isFinite(amount) && amount > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await investmentRepository.create({
        shopId,
        dateKey,
        description: description.trim(),
        amount,
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
          <DialogTitle>บันทึกรายการลงทุน</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="investment-date">วันที่ลงทุน</Label>
            <DateField id="investment-date" value={dateKey} onChange={setDateKey} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="investment-description">รายละเอียด</Label>
            <Input
              id="investment-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="เช่น ค่าเซ้งร้าน, ตู้แช่ 2 บาน มือสอง, ของเริ่มต้นร้าน"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="investment-amount">จำนวน (บาท)</Label>
            <Input
              id="investment-amount"
              type="number"
              inputMode="decimal"
              min={0}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
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
