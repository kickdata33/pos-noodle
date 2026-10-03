"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { DateField } from "@/components/admin/DateField";
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
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { bangkokDateKey } from "@/lib/pos/dateRange";
import {
  availableMonths,
  cashMoveOutRows,
  latestCashSafeCount,
  rowsForMonth,
  totalMovedOut,
} from "@/lib/pos/cashMoveOut";
import { shiftMonthKey } from "@/lib/pos/dateRange";
import { cashSafeCountRepository } from "@/repositories/cashSafeCountRepository";
import { dailyFloatRepository } from "@/repositories/dailyFloatRepository";
import { shopRepository } from "@/repositories/shopRepository";
import type { CashSafeCount, DailyFloat } from "@/types";

function todayKey(): string {
  return bangkokDateKey(Date.now());
}

function currentMonthKey(): string {
  return todayKey().slice(0, 7);
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

function formatMonthKey(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("th-TH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * ตัดเงินสดออก (item: "ตารางตัดเงินสดออก ว่าวันไหนเท่าไหร่แล้ว รวมที่ควรจะมี ตอนนี้มีเท่าไหร่").
 * Two numbers that are deliberately never derived from each other:
 * - "รวมที่ควรจะมี" — the running, all-time cumulative sum of every business day's
 *   `DailyFloat.cashMovedOut` (see `lib/pos/cashMoveOut.ts`'s file comment for why this never
 *   resets per month, only the table view groups rows by month).
 * - "ตอนนี้มีเท่าไหร่" — a separate, manually-entered `CashSafeCount` checkpoint; someone actually
 *   counted the stash. The difference between the two is what this page exists to surface.
 */
export default function CashSafePage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;

  const [currency, setCurrency] = useState("THB");
  const [floats, setFloats] = useState<DailyFloat[]>([]);
  const [counts, setCounts] = useState<CashSafeCount[]>([]);
  const [monthKey, setMonthKey] = useState(() => currentMonthKey());
  const [countOpen, setCountOpen] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    shopRepository.getSettings(shopId).then((settings) => {
      if (settings) setCurrency(settings.currency);
    });
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return dailyFloatRepository.subscribeForShop(shopId, setFloats);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return cashSafeCountRepository.subscribeForShop(shopId, setCounts);
  }, [shopId]);

  const rows = useMemo(() => cashMoveOutRows(floats), [floats]);
  const total = useMemo(() => totalMovedOut(rows), [rows]);
  const months = useMemo(() => availableMonths(rows), [rows]);
  // Descending (latest day first) for the table — `cashMoveOutRows` computes the cumulative in
  // ascending order first (it has to, to be correct), this just reverses for display.
  const monthRows = useMemo(() => [...rowsForMonth(rows, monthKey)].reverse(), [rows, monthKey]);
  const monthTotal = useMemo(() => monthRows.reduce((sum, r) => sum + r.movedOut, 0), [monthRows]);

  const latestCount = useMemo(() => latestCashSafeCount(counts), [counts]);
  const difference = latestCount != null ? latestCount.amount - total : null;

  const sortedCounts = useMemo(
    () => [...counts].sort((a, b) => b.dateKey.localeCompare(a.dateKey) || b.createdAt - a.createdAt),
    [counts]
  );

  return (
    <AdminSection
      title="ตัดเงินสดออก"
      description="เงินสดที่โยกออกเก็บระหว่างกะ สะสมทั้งหมด เทียบกับยอดที่นับได้จริง"
      actionLabel="+ บันทึกยอดนับจริง"
      onAction={() => setCountOpen(true)}
    >
      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryStat label="รวมที่โยกออกสะสม (ควรมี)" value={formatCurrency(total, currency)} />
        <SummaryStat
          label="ยอดนับจริงล่าสุด"
          value={latestCount ? formatCurrency(latestCount.amount, currency) : "ยังไม่ได้นับ"}
          sub={latestCount ? `นับเมื่อ ${formatDateKey(latestCount.dateKey)}` : undefined}
        />
        <SummaryStat
          label="ผลต่าง (นับจริง - ควรมี)"
          value={difference != null ? formatCurrency(difference, currency) : "-"}
          tone={difference == null ? "muted" : difference < 0 ? "destructive" : difference > 0 ? "success" : undefined}
        />
      </div>

      <Card className="mt-4">
        <CardHeader>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>รายวัน</CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={() => setMonthKey((k) => shiftMonthKey(k, -1))}>
                ‹ เดือนก่อน
              </Button>
              <span className="min-w-[9rem] text-center text-sm font-medium">{formatMonthKey(monthKey)}</span>
              <Button size="sm" variant="outline" onClick={() => setMonthKey((k) => shiftMonthKey(k, 1))} disabled={monthKey >= currentMonthKey()}>
                เดือนถัดไป ›
              </Button>
            </div>
          </div>
          {months.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {months.map((m) => (
                <Button key={m} size="sm" variant={m === monthKey ? "default" : "ghost"} className="h-7 px-2 text-xs" onClick={() => setMonthKey(m)}>
                  {formatMonthKey(m)}
                </Button>
              ))}
            </div>
          ) : null}
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>วันที่</TableHead>
                <TableHead className="text-right">โยกออกวันนั้น</TableHead>
                <TableHead className="text-right">สะสมถึงวันนี้</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {monthRows.map((r) => (
                <TableRow key={r.dateKey}>
                  <TableCell>{formatDateKey(r.dateKey)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(r.movedOut, currency)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(r.cumulative, currency)}</TableCell>
                </TableRow>
              ))}
              {monthRows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3} className="text-center text-muted-foreground">
                    ไม่มีรายการโยกออกในเดือนนี้
                  </TableCell>
                </TableRow>
              ) : (
                <TableRow>
                  <TableCell className="text-muted-foreground">รวมเดือนนี้</TableCell>
                  <TableCell className="text-right font-semibold">{formatCurrency(monthTotal, currency)}</TableCell>
                  <TableCell />
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {sortedCounts.length > 0 ? (
        <Card className="mt-4">
          <CardHeader>
            <CardTitle>ประวัติการนับยอดจริง</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>วันที่นับ</TableHead>
                  <TableHead className="text-right">ยอดนับได้</TableHead>
                  <TableHead>หมายเหตุ</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedCounts.map((c) => (
                  <TableRow key={c.id}>
                    <TableCell className="whitespace-nowrap">{formatDateKey(c.dateKey)}</TableCell>
                    <TableCell className="text-right">{formatCurrency(c.amount, currency)}</TableCell>
                    <TableCell className="text-muted-foreground">{c.note || "-"}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-6 px-2 text-xs text-destructive"
                        onClick={() => cashSafeCountRepository.remove(c.id)}
                      >
                        ลบ
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      <AddCashSafeCountDialog
        open={countOpen}
        onOpenChange={setCountOpen}
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

function AddCashSafeCountDialog({
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
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDateKey(todayKey());
      setAmountText("");
      setNote("");
    }
  }, [open]);

  const amount = Number(amountText);
  const canSave = Boolean(shopId) && Boolean(dateKey) && Number.isFinite(amount) && amount >= 0;

  async function handleSave() {
    if (!canSave || saving) return;
    setSaving(true);
    try {
      await cashSafeCountRepository.create({
        shopId,
        dateKey,
        amount,
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
          <DialogTitle>บันทึกยอดนับจริง</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="count-date">วันที่นับ</Label>
            <DateField id="count-date" value={dateKey} onChange={setDateKey} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="count-amount">ยอดที่นับได้ (บาท)</Label>
            <Input
              id="count-amount"
              type="number"
              inputMode="decimal"
              min={0}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="count-note">หมายเหตุ (ถ้ามี)</Label>
            <Input id="count-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น นับพร้อมยอดสิ้นเดือน" />
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
