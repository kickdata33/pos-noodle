"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { BarList } from "@/components/admin/reports/BarList";
import { DailyTrendChart } from "@/components/admin/reports/DailyTrendChart";
import { HourlyChart } from "@/components/admin/reports/HourlyChart";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { formatCurrency } from "@/lib/format";
import { useAuth } from "@/hooks/useAuth";
import {
  addDaysToKey,
  bangkokDateKeyWithCutoff,
  bangkokDayBounds,
  customRange,
  resolvePreset,
  type DateRange,
  type ReportPreset,
} from "@/lib/pos/dateRange";
import {
  dailySales,
  hourlySales,
  salesByChannel,
  salesByPaymentMethod,
  summarizeOrders,
  topProducts,
} from "@/lib/pos/reports";
import { deliveryPayoutRepository } from "@/repositories/deliveryPayoutRepository";
import { expenseRepository } from "@/repositories/expenseRepository";
import { orderRepository } from "@/repositories/orderRepository";
import { shopRepository } from "@/repositories/shopRepository";
import type { DeliveryPayout, Expense, Order } from "@/types";

const PRESETS: { value: ReportPreset; label: string }[] = [
  { value: "today", label: "วันนี้" },
  { value: "yesterday", label: "เมื่อวาน" },
  { value: "last7", label: "7 วันล่าสุด" },
  { value: "thisWeek", label: "สัปดาห์นี้" },
  { value: "thisMonth", label: "เดือนนี้" },
];

/**
 * รายงานสรุปยอด (Admin-only, item: "หน้าสรุปยอดแบบละเอียด" — สินค้าขายดี, ช่วงเวลาที่ขายดี,
 * เลือกช่วงวันที่ย้อนหลังได้). One `orderRepository.listPaidForShopInRange` fetch per range
 * change; every card/chart below derives from that same array via the pure functions in
 * `lib/pos/reports.ts` so the numbers can never disagree with each other.
 */
export default function ReportsPage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;
  const [preset, setPreset] = useState<ReportPreset | "custom">("thisWeek");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("THB");
  const [loadError, setLoadError] = useState<string | null>(null);
  // Off by default (plain midnight-to-midnight day, unchanged from before this existed). On:
  // "ยอดขายรายวัน" regroups each day to run from `fromHour` to `toHour` the next day instead of
  // midnight-to-midnight — matches how the shop actually thinks about "one day" (e.g. 16:00 today
  // to 04:00 the next morning, its real operating hours), so the chart's day boundary lines up
  // with a shift instead of the clock. Grouping only needs `fromHour` (a day always runs a full
  // 24h from wherever it starts — see `bangkokDateKeyWithCutoff`'s comment); `toHour` is kept
  // alongside it purely so the UI reads as a shift ("16:00–04:00") rather than an abstract
  // "cutoff" number. Only affects that one chart; the range picker above and every other card
  // stay on plain calendar days.
  const [useBusinessDay, setUseBusinessDay] = useState(false);
  const [fromHour, setFromHour] = useState(16);
  // 06:00, not 04:00 — matches `/admin/accounting`'s default (some nights a table sits until
  // closer to 6am); purely a label, the grouping math already covers any close time up to 16:00
  // the next day regardless of this value — see that page's `toHour` comment for the full story.
  const [toHour, setToHour] = useState(6);

  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [deliveryPayouts, setDeliveryPayouts] = useState<DeliveryPayout[]>([]);

  useEffect(() => {
    if (!shopId) return;
    shopRepository.getSettings(shopId).then((settings) => {
      if (settings) setCurrency(settings.currency);
    });
  }, [shopId]);

  // สำหรับการ์ด "เปรียบเทียบค่าใช้จ่ายกับรายได้ Delivery" ด้านล่าง — เบา (ร้านนี้มีไม่กี่รายการ/วัน)
  // เลยใช้ live subscription ตรงๆ แบบเดียวกับหน้าบัญชี/หน้ายอดขาย Delivery แล้วกรองตามช่วงวันที่
  // ที่เลือกไว้ในหน้านี้เอง (client-side) แทนที่จะ fetch ใหม่ทุกครั้งที่เปลี่ยนช่วง.
  useEffect(() => {
    if (!shopId) return;
    return expenseRepository.subscribeForShop(shopId, setExpenses);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return deliveryPayoutRepository.subscribeForShop(shopId, setDeliveryPayouts);
  }, [shopId]);

  const range: DateRange = useMemo(() => {
    if (preset === "custom") {
      if (!customFrom || !customTo) return resolvePreset("thisWeek");
      return customRange(customFrom, customTo);
    }
    return resolvePreset(preset);
  }, [preset, customFrom, customTo]);

  // Plain calendar-day range when the "ดูตามช่วงเวลาทำการ" toggle is off (unchanged from before
  // that toggle existed). When it's on, a business day can pull in orders physically paid just
  // after midnight on the *next* calendar day (e.g. 02:00 on the 19th belongs to the shift that
  // started 16:00 on the 18th — see `bangkokDateKeyWithCutoff`'s comment) — a plain calendar
  // fetch would silently miss those, so pad the fetch by a day on each side, same fix already
  // applied to `/admin/accounting`'s `fetchRange`.
  const fetchRange = useMemo(() => {
    if (!useBusinessDay) return { startMs: range.startMs, endMs: range.endMs };
    return {
      startMs: bangkokDayBounds(addDaysToKey(range.startKey, -1)).startMs,
      endMs: bangkokDayBounds(addDaysToKey(range.endKey, 1)).endMs,
    };
  }, [useBusinessDay, range.startMs, range.endMs, range.startKey, range.endKey]);

  useEffect(() => {
    if (!shopId) return;
    let cancelled = false;
    // Range changed — kick off a fresh fetch and show the loading state immediately. This is a
    // one-shot fetch-on-dependency-change, not a subscription to an external system, so there's
    // nothing to move this into; matches the same pattern/reasoning as OrderScreen's draft-seed effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setLoadError(null);
    orderRepository
      .listPaidForShopInRange(shopId, fetchRange.startMs, fetchRange.endMs)
      .then((result) => {
        if (!cancelled) setOrders(result);
      })
      .catch((err) => {
        // Without this, a query error (most commonly: the composite index this query needs —
        // shopId + status + paidAt — hasn't been deployed yet) fails *silently* from the page's
        // point of view: `orders` just stays `[]` forever, so every card reads "0.00" with
        // nothing on screen to explain why real, paid orders aren't showing up. Surface it loudly
        // instead of letting a real bug read as "no sales this week".
        console.error(
          "[reports] listPaidForShopInRange failed — is the shopId+status+paidAt Firestore index deployed? See firestore.indexes.json / \"firebase deploy --only firestore:indexes\".",
          err
        );
        if (!cancelled) {
          setOrders([]);
          setLoadError(
            err instanceof Error && err.message ? err.message : "โหลดข้อมูลไม่สำเร็จ"
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, fetchRange.startMs, fetchRange.endMs]);

  // With the toggle off, `fetchRange` was never padded, so this is just `orders` again — no
  // behavior change from before. With it on, the padded fetch above may include orders from a
  // neighboring calendar day whose *business day* falls outside what was actually requested (or
  // vice versa — an order physically on this calendar day but belonging to the previous shift) —
  // filtering here, once, by the same `bangkokDateKeyWithCutoff` label the accounting page uses
  // is what keeps every card on this page (not just "ยอดขายรายวัน") agreeing on which orders
  // belong to the selected day(s), instead of the trend chart alone reading the shop's real
  // shift while the stat cards/top products/hourly/channel/payment cards silently still read
  // plain midnight-to-midnight.
  const scopedOrders = useMemo(() => {
    if (!useBusinessDay) return orders;
    return orders.filter((o) => {
      const key = bangkokDateKeyWithCutoff(o.paidAt ?? o.createdAt, fromHour);
      return key >= range.startKey && key <= range.endKey;
    });
  }, [orders, useBusinessDay, fromHour, range.startKey, range.endKey]);

  const summary = useMemo(() => summarizeOrders(scopedOrders), [scopedOrders]);
  const products = useMemo(() => topProducts(scopedOrders, 10), [scopedOrders]);
  const days = useMemo(
    () => dailySales(scopedOrders, range.startKey, range.endKey, useBusinessDay ? fromHour : 0),
    [scopedOrders, range.startKey, range.endKey, useBusinessDay, fromHour]
  );
  const hours = useMemo(() => hourlySales(scopedOrders), [scopedOrders]);
  const channels = useMemo(() => salesByChannel(scopedOrders), [scopedOrders]);
  const paymentMethods = useMemo(() => salesByPaymentMethod(scopedOrders), [scopedOrders]);

  // ค่าใช้จ่ายรวม ในช่วงที่เลือก — ปกติใช้ plain calendar `dateKey` เหมือนหน้าบัญชีรายรับ-รายจ่าย
  // (Expense เก็บเป็นวันปฏิทินธรรมดา ไม่ใช่ business-day key) แต่เมื่อเปิด "ดูตามช่วงเวลาทำการ" ไว้
  // (`useBusinessDay`) การ์ดยอดขายด้านบนเปลี่ยนไปนับตามกะ (16:00–06:00 เป็นต้น) แล้ว ถ้าการ์ดนี้ยังคง
  // เทียบด้วย `dateKey` ตรงๆ อยู่ รายการที่บันทึกไว้ตอนตี 1–2 (จริงๆ เป็นของกะเมื่อคืนที่ยังไม่ข้ามเที่ยงคืน
  // ตามเวลาทำการ) จะไปโผล่ใน "วันนี้" แทนที่จะเป็น "เมื่อวาน" — ให้สลับไปกลุ่มด้วย
  // `bangkokDateKeyWithCutoff(e.createdAt, fromHour)` แทน ให้ตรงกับตอนที่นับยอดขาย (`scopedOrders`)
  // ด้านบน.
  const totalExpenses = useMemo(() => {
    if (!useBusinessDay) {
      return expenses.filter((e) => e.dateKey >= range.startKey && e.dateKey <= range.endKey).reduce((sum, e) => sum + e.amount, 0);
    }
    return expenses
      .filter((e) => {
        const key = bangkokDateKeyWithCutoff(e.createdAt, fromHour);
        return key >= range.startKey && key <= range.endKey;
      })
      .reduce((sum, e) => sum + e.amount, 0);
  }, [expenses, range.startKey, range.endKey, useBusinessDay, fromHour]);

  // รายได้ Delivery ในช่วงที่เลือก — ยึดตามเงินที่แอป Grab/Line man/Shopee โอนเข้าบัญชีจริง (บันทึกไว้
  // ในหน้า "ยอดขาย Delivery") ไม่ใช่ยอดขายที่ระบบ POS คำนวณจากบิล (ซึ่งมักจะขึ้น 0 ถ้าพนักงานไม่ได้
  // เลือกวิธีชำระเป็น "Delivery" ตอนปิดบิล) — ถือเป็นรายได้ที่เข้าจริงตรงๆ ไม่ต้องเทียบ/หักลบกับยอดขาย
  // เหมือนคอลัมน์ "คงเหลือ" ในหน้ายอดขาย Delivery ที่อาจติดลบได้. เช่นเดียวกับ `totalExpenses` ข้างบน —
  // เมื่อเปิด "ดูตามช่วงเวลาทำการ" ให้กรองด้วยกะ (จาก `createdAt`) แทน `dateKey` ตรงๆ.
  const deliveryRevenue = useMemo(() => {
    if (!useBusinessDay) {
      return deliveryPayouts.filter((p) => p.dateKey >= range.startKey && p.dateKey <= range.endKey).reduce((sum, p) => sum + p.amount, 0);
    }
    return deliveryPayouts
      .filter((p) => {
        const key = bangkokDateKeyWithCutoff(p.createdAt, fromHour);
        return key >= range.startKey && key <= range.endKey;
      })
      .reduce((sum, p) => sum + p.amount, 0);
  }, [deliveryPayouts, range.startKey, range.endKey, useBusinessDay, fromHour]);
  // รายรับรวม (ยอดขายทั้งร้าน + รายได้ Delivery) — item request: เดิมเอาแค่ "รายได้ Delivery" (เงินโอน
  // เข้าจากแอป) ไปหักกับ "ค่าใช้จ่ายทั้งร้าน" ทำให้ผลต่างติดลบเกินจริงมาก เพราะเทียบรายจ่ายทั้งร้านกับ
  // รายได้แค่ช่องทางเดียว ตอนนี้รวมยอดขายทั้งร้าน (`summary.revenue`) เข้ากับรายได้ Delivery ก่อน
  // แล้วค่อยหักค่าใช้จ่าย ให้เห็นภาพรวมกำไร-ขาดทุนที่ใกล้เคียงความจริงมากขึ้น.
  const totalRevenue = summary.revenue + deliveryRevenue;
  const netAfterDelivery = totalRevenue - totalExpenses;

  return (
    <AdminSection title="รายงานสรุปยอด" description="ยอดขาย สินค้าขายดี และช่วงเวลาที่ลูกค้าเยอะ เลือกช่วงวันที่ย้อนหลังได้">
      <div className="mb-6 flex flex-wrap items-end gap-2">
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

      <p className="mb-4 text-sm text-muted-foreground">
        แสดงข้อมูล {formatRangeLabel(range)} {loading && "· กำลังโหลด..."}
      </p>

      {loadError ? (
        <div className="mb-4 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          โหลดรายงานไม่สำเร็จ: {loadError} — ลองกดรีเฟรชหน้านี้ใหม่ ถ้ายังไม่ได้กรุณาแจ้งผู้ดูแลระบบ
        </div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="ยอดขายรวม" value={formatCurrency(summary.revenue, currency)} />
        <StatCard label="จำนวนบิล" value={`${summary.orderCount.toLocaleString("th-TH")} บิล`} />
        <StatCard label="ยอดเฉลี่ยต่อบิล" value={formatCurrency(summary.avgOrderValue, currency)} />
        <StatCard label="จำนวนสินค้าที่ขาย" value={`${summary.itemCount.toLocaleString("th-TH")} ชิ้น`} />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>เปรียบเทียบรายรับรวมกับค่าใช้จ่าย</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <p className="text-sm text-muted-foreground">รายรับรวม (ยอดขาย + Delivery)</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600">{formatCurrency(totalRevenue, currency)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">ค่าใช้จ่ายรวม</p>
              <p className="mt-1 text-2xl font-semibold tabular-nums text-destructive">{formatCurrency(totalExpenses, currency)}</p>
            </div>
            <div>
              <p className="text-sm text-muted-foreground">ผลต่าง (รายรับรวม - ค่าใช้จ่าย)</p>
              <p className={`mt-1 text-2xl font-semibold tabular-nums ${netAfterDelivery < 0 ? "text-destructive" : "text-emerald-600"}`}>
                {formatCurrency(netAfterDelivery, currency)}
              </p>
            </div>
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            รายรับรวม = ยอดขายทั้งร้าน ({formatCurrency(summary.revenue, currency)}) + รายได้ Delivery ที่แอป
            Grab/Line man/Shopee โอนเข้าบัญชีจริง ({formatCurrency(deliveryRevenue, currency)}, บันทึกในหน้า
            &quot;ยอดขาย Delivery&quot;)
          </p>
        </CardContent>
      </Card>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>ยอดขายรายวัน</CardTitle>
              {useBusinessDay && (
                <p className="mt-1 text-xs text-muted-foreground">
                  นับ 1 วัน ตั้งแต่ {String(fromHour).padStart(2, "0")}:00 ถึง {String(toHour).padStart(2, "0")}:00
                  ของวันถัดไป แทนการนับตามเที่ยงคืน
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Label htmlFor="business-day" className="text-xs text-muted-foreground">
                ดูตามช่วงเวลาทำการ
              </Label>
              <Switch id="business-day" checked={useBusinessDay} onCheckedChange={setUseBusinessDay} />
              {useBusinessDay && (
                <>
                  <HourSelect label="จาก" value={fromHour} onChange={setFromHour} />
                  <span className="text-xs text-muted-foreground">ถึง</span>
                  <HourSelect label="ถึง" value={toHour} onChange={setToHour} />
                </>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <DailyTrendChart days={days} currency={currency} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ช่วงเวลาที่ขายดี (ตามชั่วโมง)</CardTitle>
          </CardHeader>
          <CardContent>
            <HourlyChart hours={hours} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>สินค้าขายดี</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              rows={products.map((p) => ({ key: p.productId, label: p.productName, value: p.qty, detail: formatCurrency(p.revenue, currency) }))}
              formatValue={(v) => `${v.toLocaleString("th-TH")} ชิ้น`}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ยอดขายตามช่องทาง</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              rows={channels.map((c) => ({ key: c.key, label: c.label, value: c.revenue, detail: `${c.orderCount} บิล` }))}
              formatValue={(v) => formatCurrency(v, currency)}
            />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ยอดขายตามวิธีชำระเงิน</CardTitle>
          </CardHeader>
          <CardContent>
            <BarList
              rows={paymentMethods.map((p) => ({ key: p.key, label: p.label, value: p.revenue, detail: `${p.orderCount} บิล` }))}
              formatValue={(v) => formatCurrency(v, currency)}
            />
          </CardContent>
        </Card>
      </div>
    </AdminSection>
  );
}

/** Plain 0–23 hour dropdown for the "จาก .. ถึง .." business-day range picker above. */
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

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="py-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

function formatRangeLabel(range: DateRange): string {
  if (range.startKey === range.endKey) return formatKey(range.startKey);
  return `${formatKey(range.startKey)} – ${formatKey(range.endKey)}`;
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
