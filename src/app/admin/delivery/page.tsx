"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { DateField } from "@/components/admin/DateField";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatCurrency } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useAuth } from "@/hooks/useAuth";
import { bangkokDateKey, bangkokDayBounds, customRange, resolvePreset, type DateRange, type ReportPreset } from "@/lib/pos/dateRange";
import { deliveryRangeSummary, deliverySalesByPlatform } from "@/lib/pos/delivery";
import { deliveryFloatTopUpRepository } from "@/repositories/deliveryFloatTopUpRepository";
import { deliveryPayoutRepository } from "@/repositories/deliveryPayoutRepository";
import { orderRepository } from "@/repositories/orderRepository";
import { paymentMethodRepository } from "@/repositories/paymentMethodRepository";
import { shopRepository } from "@/repositories/shopRepository";
import {
  DELIVERY_PLATFORMS,
  DELIVERY_PLATFORM_LABELS,
  type DeliveryFloatTopUp,
  type DeliveryPayout,
  type DeliveryPlatform,
  type Order,
  type PaymentMethod,
} from "@/types";

const PRESETS: { value: ReportPreset; label: string }[] = [
  { value: "today", label: "วันนี้" },
  { value: "last7", label: "7 วันล่าสุด" },
  { value: "thisWeek", label: "สัปดาห์นี้" },
  { value: "thisMonth", label: "เดือนนี้" },
];

/**
 * ยอดขาย Delivery (item: ตารางติดตามยอด Grab/Line man/Shopee ของร้านเอง). Modeled on the shop's own
 * manual spreadsheet, but split into three parts instead of one flat table:
 * 1) ยอดขายที่ระบบขายได้ ต่อแพลตฟอร์ม เทียบกับ เงินที่แอปโอนเข้าบัญชีจริง (เหมือนเงินโอนเข้าบัญชี ของ
 *    หน้าบัญชีรายรับ-รายจ่าย) — คงเหลือที่ยังไม่โอนเข้า อาจติดลบได้ชั่วคราวถ้าแอปโอนเป็นก้อนที่คลุมมากกว่า
 *    1 รอบที่มองเห็นตอนนี้ (ดู `deliveryRangeSummary`'s comment)
 * 2) เงินทุน/ทอนที่เติมเข้าลิ้นชักสำหรับส่ง delivery (COD) — คนละเรื่องกับเงินสดเริ่มต้นกะปกติ, เป็น
 *    เงินสำรองที่เติมเข้าไม่บ่อย ไม่ได้รีเซ็ตทุกวันแบบเงินทอนกะ
 * ใช้ปฏิทินธรรมดา (dateKey) ไม่ใช่ business day แบบหน้าบัญชี — เพราะรอบโอนของแต่ละแอป ไม่ได้ผูกกับ
 * เวลาเปิดร้าน 16:00 เหมือน K SHOP (ดู `lib/pos/delivery.ts`'s file comment)
 */
export default function DeliveryPage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;

  const [preset, setPreset] = useState<ReportPreset | "custom">("last7");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const [payoutDay, setPayoutDay] = useState(() => todayKey());
  const [topUpDay, setTopUpDay] = useState(() => todayKey());

  const [orders, setOrders] = useState<Order[]>([]);
  const [paymentMethods, setPaymentMethods] = useState<PaymentMethod[]>([]);
  const [payouts, setPayouts] = useState<DeliveryPayout[]>([]);
  const [topUps, setTopUps] = useState<DeliveryFloatTopUp[]>([]);
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

  useEffect(() => {
    if (!shopId) return;
    return deliveryPayoutRepository.subscribeForShop(shopId, setPayouts);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return deliveryFloatTopUpRepository.subscribeForShop(shopId, setTopUps);
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
    const { startMs } = bangkokDayBounds(range.startKey);
    const { endMs } = bangkokDayBounds(range.endKey);
    orderRepository
      .listPaidForShopInRange(shopId, startMs, endMs)
      .then((result) => {
        if (!cancelled) setOrders(result);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [shopId, range.startKey, range.endKey]);

  const salesRows = useMemo(
    () => deliverySalesByPlatform(orders, paymentMethods, range.startKey, range.endKey),
    [orders, paymentMethods, range.startKey, range.endKey]
  );

  const summary = useMemo(
    () => deliveryRangeSummary(salesRows, payouts, range.startKey, range.endKey),
    [salesRows, payouts, range.startKey, range.endKey]
  );

  const rangeTotals = useMemo(
    () =>
      summary.reduce(
        (acc, s) => ({ sales: acc.sales + s.sales, payouts: acc.payouts + s.payouts, outstanding: acc.outstanding + s.outstanding }),
        { sales: 0, payouts: 0, outstanding: 0 }
      ),
    [summary]
  );

  // เลือกวันไหน โชว์แค่วันนั้น — same "own single-day filter" pattern as รายจ่าย on the accounting page.
  const visiblePayouts = useMemo(
    () => payouts.filter((p) => p.dateKey === payoutDay).sort((a, b) => b.createdAt - a.createdAt),
    [payouts, payoutDay]
  );
  const payoutDayTotal = useMemo(() => visiblePayouts.reduce((sum, p) => sum + p.amount, 0), [visiblePayouts]);

  const visibleTopUps = useMemo(
    () => topUps.filter((t) => t.dateKey === topUpDay).sort((a, b) => b.createdAt - a.createdAt),
    [topUps, topUpDay]
  );
  // ยอดสะสมทั้งหมด ไม่ใช่แค่ของวันที่เลือก — นี่คือเงินสำรองสำหรับทอน delivery ที่ไม่ได้รีเซ็ตทุกวัน
  const topUpRunningTotal = useMemo(() => topUps.reduce((sum, t) => sum + t.amount, 0), [topUps]);

  return (
    <AdminSection title="ยอดขาย Delivery" description="กระทบยอดขายแต่ละแพลตฟอร์มกับเงินที่โอนเข้าบัญชีจริง พร้อมบันทึกเงินทุนทอน COD">
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
        {loading ? <span className="text-sm text-muted-foreground">กำลังโหลด...</span> : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>สรุปยอดขายเทียบกับเงินโอนเข้าบัญชี ต่อแพลตฟอร์ม</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>แพลตฟอร์ม</TableHead>
                <TableHead className="text-right">ยอดขาย</TableHead>
                <TableHead className="text-right">โอนเข้าแล้ว</TableHead>
                <TableHead className="text-right">คงเหลือ</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {summary.map((s) => (
                <TableRow key={s.platform}>
                  <TableCell className="font-medium">{DELIVERY_PLATFORM_LABELS[s.platform]}</TableCell>
                  <TableCell className="text-right">{formatCurrency(s.sales, currency)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(s.payouts, currency)}</TableCell>
                  <TableCell className={cn("text-right font-medium", s.outstanding < 0 ? "text-destructive" : undefined)}>
                    {formatCurrency(s.outstanding, currency)}
                  </TableCell>
                </TableRow>
              ))}
              <TableRow className="font-medium">
                <TableCell>รวม</TableCell>
                <TableCell className="text-right">{formatCurrency(rangeTotals.sales, currency)}</TableCell>
                <TableCell className="text-right">{formatCurrency(rangeTotals.payouts, currency)}</TableCell>
                <TableCell className={cn("text-right", rangeTotals.outstanding < 0 ? "text-destructive" : undefined)}>
                  {formatCurrency(rangeTotals.outstanding, currency)}
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <p className="mt-3 text-xs text-muted-foreground">
            &quot;คงเหลือ&quot; ติดลบได้ชั่วคราว ถ้าแอปโอนเงินเป็นก้อนที่คลุมมากกว่ารอบที่เห็นตอนนี้ — ไม่ใช่ข้อผิดพลาดเสมอไป
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>เงินที่แอปโอนเข้าบัญชีจริง</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">วันที่</Label>
            <DateField value={payoutDay} onChange={setPayoutDay} className="h-9 w-36" />
            <span className="text-sm font-medium">{formatKey(payoutDay)}</span>
          </div>
          <Table className="table-fixed min-w-[560px]">
            <colgroup>
              <col className="w-[20%]" />
              <col className="w-[20%]" />
              <col className="w-[36%]" />
              <col className="w-[24%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead>แพลตฟอร์ม</TableHead>
                <TableHead className="text-right">จำนวนเงิน</TableHead>
                <TableHead>หมายเหตุ</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shopId && appUser ? (
                <PayoutQuickAddRow shopId={shopId} createdBy={appUser.id} createdByName={appUser.name} dateKey={payoutDay} />
              ) : null}
              {visiblePayouts.map((p) => (
                <PayoutRow key={p.id} payout={p} currency={currency} />
              ))}
              {visiblePayouts.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground">
                    ยังไม่มีรายการโอนวันนี้
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <p className="mt-3 text-right text-sm font-medium">
            ยอดรวมวันที่ {formatKey(payoutDay)} {formatCurrency(payoutDayTotal, currency)}
          </p>
        </CardContent>
      </Card>

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>เงินทุน/ทอนที่เติมเข้าลิ้นชักสำหรับส่ง Delivery</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-muted-foreground">
            เงินที่เติมเข้าลิ้นชักไว้ทอนลูกค้า COD (เก็บเงินปลายทาง) โดยเฉพาะ — คนละก้อนกับเงินทอนเริ่มกะปกติในหน้า
            บัญชีรายรับ-รายจ่าย ไม่ได้รีเซ็ตทุกวัน เติมเมื่อไหร่ก็บันทึกไว้ตรงนี้
          </p>
          <div className="mb-3 flex items-center gap-2">
            <Label className="text-sm text-muted-foreground">วันที่</Label>
            <DateField value={topUpDay} onChange={setTopUpDay} className="h-9 w-36" />
            <span className="text-sm font-medium">{formatKey(topUpDay)}</span>
          </div>
          <Table className="table-fixed min-w-[480px]">
            <colgroup>
              <col className="w-[24%]" />
              <col className="w-[44%]" />
              <col className="w-[32%]" />
            </colgroup>
            <TableHeader>
              <TableRow>
                <TableHead className="text-right">จำนวนเงิน</TableHead>
                <TableHead>หมายเหตุ</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {shopId && appUser ? (
                <TopUpQuickAddRow shopId={shopId} createdBy={appUser.id} createdByName={appUser.name} dateKey={topUpDay} />
              ) : null}
              {visibleTopUps.map((t) => (
                <TopUpRow key={t.id} topUp={t} currency={currency} />
              ))}
              {visibleTopUps.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    ยังไม่มีรายการเติมวันนี้
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <p className="mt-3 text-right text-sm font-medium">
            ยอดสะสมทั้งหมด {formatCurrency(topUpRunningTotal, currency)}
          </p>
        </CardContent>
      </Card>
    </AdminSection>
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

function PlatformSelect({ value, onChange }: { value: DeliveryPlatform; onChange: (platform: DeliveryPlatform) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as DeliveryPlatform)}>
      <SelectTrigger className="h-9 w-full text-sm">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DELIVERY_PLATFORMS.map((p) => (
          <SelectItem key={p} value={p}>
            {DELIVERY_PLATFORM_LABELS[p]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** Same quick-add pattern as `ExpenseQuickAddRow`/`TransferQuickAddRow` on the accounting page —
 * an always-visible editable row, auto-saving on Enter/click rather than a modal, so several
 * payouts (one per platform) can be logged back-to-back without leaving the table. */
function PayoutQuickAddRow({
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
  const [platform, setPlatform] = useState<DeliveryPlatform>("grab");
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const amount = Number(amountText);
  const canSave = Boolean(dateKey) && Number.isFinite(amount) && amount > 0;

  async function handleAdd() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await deliveryPayoutRepository.create({
        shopId,
        dateKey,
        platform,
        amount,
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
        <PlatformSelect value={platform} onChange={setPlatform} />
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
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="หมายเหตุ (ไม่บังคับ)"
          className="h-9 w-full"
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

/** One row of the เงินโอนเข้าบัญชี table — plain read row, or (after "แก้ไข") inline edit for a
 * typo/amount fix, plus "ลบ" for a mistaken entry. No date/platform column edit surprise here —
 * both stay editable too, same as `TransferRow`'s businessDayKey edit on the accounting page. */
function PayoutRow({ payout, currency }: { payout: DeliveryPayout; currency: string }) {
  const [editing, setEditing] = useState(false);
  const [dateKey, setDateKey] = useState(payout.dateKey);
  const [platform, setPlatform] = useState<DeliveryPlatform>(payout.platform);
  const [amountText, setAmountText] = useState(String(payout.amount));
  const [note, setNote] = useState(payout.note);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setDateKey(payout.dateKey);
    setPlatform(payout.platform);
    setAmountText(String(payout.amount));
    setNote(payout.note);
    setEditing(true);
  }

  const amount = Number(amountText);
  const canSave = Boolean(dateKey) && Number.isFinite(amount) && amount > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await deliveryPayoutRepository.update(payout.id, { dateKey, platform, amount, note: note.trim() });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`ลบรายการโอน ${DELIVERY_PLATFORM_LABELS[payout.platform]} ${formatCurrency(payout.amount, currency)} (${formatKey(payout.dateKey)})?`))
      return;
    await deliveryPayoutRepository.remove(payout.id);
  }

  if (editing) {
    return (
      <TableRow className="bg-muted/20">
        <TableCell>
          <div className="flex flex-col gap-1">
            <PlatformSelect value={platform} onChange={setPlatform} />
            <DateField value={dateKey} onChange={setDateKey} className="h-9" />
          </div>
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
          <Input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSave()} className="h-9 w-full" />
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
      <TableCell className="truncate font-medium">{DELIVERY_PLATFORM_LABELS[payout.platform]}</TableCell>
      <TableCell className="text-right">{formatCurrency(payout.amount, currency)}</TableCell>
      <TableCell className="truncate text-muted-foreground">{payout.note || "-"}</TableCell>
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

/** Same quick-add pattern, for the เงินทุน/ทอน delivery log — no platform field, since the top-up
 * is one shared reserve for all delivery apps at once, not tracked per platform. */
function TopUpQuickAddRow({
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
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const amount = Number(amountText);
  const canSave = Boolean(dateKey) && Number.isFinite(amount) && amount > 0;

  async function handleAdd() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await deliveryFloatTopUpRepository.create({
        shopId,
        dateKey,
        amount,
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
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="หมายเหตุ (ไม่บังคับ)"
          className="h-9 w-full"
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

function TopUpRow({ topUp, currency }: { topUp: DeliveryFloatTopUp; currency: string }) {
  const [editing, setEditing] = useState(false);
  const [amountText, setAmountText] = useState(String(topUp.amount));
  const [note, setNote] = useState(topUp.note);
  const [saving, setSaving] = useState(false);

  function startEdit() {
    setAmountText(String(topUp.amount));
    setNote(topUp.note);
    setEditing(true);
  }

  const amount = Number(amountText);
  const canSave = Number.isFinite(amount) && amount > 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await deliveryFloatTopUpRepository.update(topUp.id, { amount, note: note.trim() });
      setEditing(false);
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!window.confirm(`ลบรายการเติมเงินทุน ${formatCurrency(topUp.amount, currency)} (${formatKey(topUp.dateKey)})?`)) return;
    await deliveryFloatTopUpRepository.remove(topUp.id);
  }

  if (editing) {
    return (
      <TableRow className="bg-muted/20">
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
          <Input value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && handleSave()} className="h-9 w-full" />
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
      <TableCell className="text-right">{formatCurrency(topUp.amount, currency)}</TableCell>
      <TableCell className="truncate text-muted-foreground">{topUp.note || "-"}</TableCell>
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
