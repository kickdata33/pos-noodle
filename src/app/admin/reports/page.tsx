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
import { formatCurrency } from "@/lib/format";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { customRange, resolvePreset, type DateRange, type ReportPreset } from "@/lib/pos/dateRange";
import {
  dailySales,
  hourlySales,
  salesByChannel,
  salesByPaymentMethod,
  summarizeOrders,
  topProducts,
} from "@/lib/pos/reports";
import { orderRepository } from "@/repositories/orderRepository";
import { shopRepository } from "@/repositories/shopRepository";
import type { Order } from "@/types";

const PRESETS: { value: ReportPreset; label: string }[] = [
  { value: "today", label: "วันนี้" },
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
  const [preset, setPreset] = useState<ReportPreset | "custom">("thisWeek");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [currency, setCurrency] = useState("THB");
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    shopRepository.getSettings(DEFAULT_SHOP_ID).then((settings) => {
      if (settings) setCurrency(settings.currency);
    });
  }, []);

  const range: DateRange = useMemo(() => {
    if (preset === "custom") {
      if (!customFrom || !customTo) return resolvePreset("thisWeek");
      return customRange(customFrom, customTo);
    }
    return resolvePreset(preset);
  }, [preset, customFrom, customTo]);

  useEffect(() => {
    let cancelled = false;
    // Range changed — kick off a fresh fetch and show the loading state immediately. This is a
    // one-shot fetch-on-dependency-change, not a subscription to an external system, so there's
    // nothing to move this into; matches the same pattern/reasoning as OrderScreen's draft-seed effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setLoadError(null);
    orderRepository
      .listPaidForShopInRange(DEFAULT_SHOP_ID, range.startMs, range.endMs)
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
  }, [range.startMs, range.endMs]);

  const summary = useMemo(() => summarizeOrders(orders), [orders]);
  const products = useMemo(() => topProducts(orders, 10), [orders]);
  const days = useMemo(() => dailySales(orders, range.startKey, range.endKey), [orders, range.startKey, range.endKey]);
  const hours = useMemo(() => hourlySales(orders), [orders]);
  const channels = useMemo(() => salesByChannel(orders), [orders]);
  const paymentMethods = useMemo(() => salesByPaymentMethod(orders), [orders]);

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

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>ยอดขายรายวัน</CardTitle>
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
