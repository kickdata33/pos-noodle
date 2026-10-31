"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { ModuleGate } from "@/components/admin/ModuleGate";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { bangkokDateKey, shiftMonthKey } from "@/lib/pos/dateRange";
import { cn } from "@/lib/utils";
import {
  computeAccrual,
  computeAvailableAdvance,
  computeCurrentPeriodStart,
  computeSettlementPreview,
  suggestedSettlementEnd,
} from "@/lib/pos/payroll";
import {
  closedDateKeysInRange,
  dateKeysInMonth,
  resolveClosedStatus,
  toOverrideMap,
  weekdayOfDateKey,
  type ShopClosedStatus,
} from "@/lib/pos/shopCalendar";
import { payrollAbsenceRepository } from "@/repositories/payrollAbsenceRepository";
import { payrollAdvanceRepository } from "@/repositories/payrollAdvanceRepository";
import { payrollEmployeeRepository } from "@/repositories/payrollEmployeeRepository";
import { payrollSettlementRepository } from "@/repositories/payrollSettlementRepository";
import { shopClosedDateRepository } from "@/repositories/shopClosedDateRepository";
import { shopRepository } from "@/repositories/shopRepository";
import { userRepository } from "@/repositories/userRepository";
import { DEFAULT_CLOSED_DAYS_OF_MONTH } from "@/types";
import type { AppUser, PayrollAbsence, PayrollAdvance, PayrollEmployee, PayrollSettlement, ShopClosedDate } from "@/types";

function todayKey(): string {
  return bangkokDateKey(Date.now());
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

/**
 * ตารางพนักงานแยก (item: "สร้างตารางพนักงานแยกดีกว่า เพราะจะตัดจ่ายทุกอาทิตย์") — a weekly payroll
 * ledger, kept separate from the general รายจ่าย log on `/admin/accounting` because it needs its
 * own per-employee running balance (accrued wage, advances taken, net still owed) that a plain
 * expense row can't represent. See `lib/pos/payroll.ts`'s file comment for the confirmed rules
 * this page implements: wage accrues per day worked, every day counts unless marked "ลา", and an
 * advance can never exceed what's already been earned and not yet advanced.
 */
export default function PayrollPage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;

  const [currency, setCurrency] = useState("THB");
  const [staff, setStaff] = useState<AppUser[]>([]);
  const [employees, setEmployees] = useState<PayrollEmployee[]>([]);
  const [advances, setAdvances] = useState<PayrollAdvance[]>([]);
  const [absences, setAbsences] = useState<PayrollAbsence[]>([]);
  const [settlements, setSettlements] = useState<PayrollSettlement[]>([]);
  // "วันหยุดร้าน" (item: "กำหนดวันหยุดร้านได้") — see `ShopClosedDaysCard` below for the editing UI
  // and `lib/pos/shopCalendar.ts` for how these two combine into a resolved closed/not-closed
  // answer per date. Defaults to the confirmed usual rest days until an Admin customizes it, same
  // fallback every reader of `ShopSettings.closedDaysOfMonth` uses.
  const [closedDaysOfMonth, setClosedDaysOfMonth] = useState<number[]>(DEFAULT_CLOSED_DAYS_OF_MONTH);
  const [closedDateOverrides, setClosedDateOverrides] = useState<ShopClosedDate[]>([]);
  // จ่ายค่าจ้างวันหยุดร้านหรือไม่ (item: "ตั้งให้จ่ายหรือไม่จ่ายได้") — one shop-wide switch, read by
  // every computeAccrual/computeSettlementPreview call below. `undefined` (every shop before this
  // field existed) reads as `false`, same as `ShopSettings.payOnClosedDays`'s own comment.
  const [payOnClosedDays, setPayOnClosedDays] = useState(false);

  const [enrollOpen, setEnrollOpen] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    shopRepository.getSettings(shopId).then((settings) => {
      if (settings) {
        setCurrency(settings.currency);
        setClosedDaysOfMonth(settings.closedDaysOfMonth ?? DEFAULT_CLOSED_DAYS_OF_MONTH);
        setPayOnClosedDays(settings.payOnClosedDays ?? false);
      }
    });
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return shopClosedDateRepository.subscribeForShop(shopId, setClosedDateOverrides);
  }, [shopId]);

  const closedDateOverrideMap = useMemo(() => toOverrideMap(closedDateOverrides), [closedDateOverrides]);

  useEffect(() => {
    if (!shopId) return;
    userRepository.listForShop(shopId).then(setStaff);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return payrollEmployeeRepository.subscribeForShop(shopId, setEmployees);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return payrollAdvanceRepository.subscribeForShop(shopId, setAdvances);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return payrollAbsenceRepository.subscribeForShop(shopId, setAbsences);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    return payrollSettlementRepository.subscribeForShop(shopId, setSettlements);
  }, [shopId]);

  // Staff not already enrolled — the only people the "+ เพิ่มพนักงาน" dialog can pick from.
  const enrollableStaff = useMemo(
    () => staff.filter((u) => u.active && !employees.some((e) => e.staffId === u.id)),
    [staff, employees]
  );

  const sortedEmployees = useMemo(
    () => [...employees].sort((a, b) => a.staffName.localeCompare(b.staffName, "th")),
    [employees]
  );

  const history = useMemo(() => [...settlements].sort((a, b) => b.paidAt - a.paidAt), [settlements]);

  return (
    <ModuleGate module="payroll">
    <AdminSection
      title="เงินเดือนพนักงาน"
      description="ค่าจ้างรายวัน เบิกล่วงหน้า และตัดจ่ายทุกวันที่ 1 และ 16 — แยกจากรายจ่ายทั่วไป"
      actionLabel={enrollableStaff.length > 0 ? "+ เพิ่มพนักงาน" : undefined}
      onAction={() => setEnrollOpen(true)}
    >
      <ShopClosedDaysCard
        shopId={shopId ?? ""}
        closedDaysOfMonth={closedDaysOfMonth}
        overrides={closedDateOverrides}
        payOnClosedDays={payOnClosedDays}
        onPayOnClosedDaysChange={setPayOnClosedDays}
        createdBy={appUser?.id ?? ""}
        createdByName={appUser?.name ?? ""}
      />

      {sortedEmployees.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
          ยังไม่มีพนักงานในระบบเงินเดือน — กด &quot;+ เพิ่มพนักงาน&quot; เพื่อตั้งค่าอัตราค่าจ้างรายวัน
        </p>
      ) : (
        <div className="grid gap-4">
          {sortedEmployees.map((employee) => (
            <EmployeeCard
              key={employee.id}
              employee={employee}
              advances={advances.filter((a) => a.staffId === employee.staffId)}
              absences={absences.filter((a) => a.staffId === employee.staffId)}
              settlements={settlements.filter((s) => s.staffId === employee.staffId)}
              currency={currency}
              createdBy={appUser?.id ?? ""}
              createdByName={appUser?.name ?? ""}
              closedDaysOfMonth={closedDaysOfMonth}
              closedDateOverrideMap={closedDateOverrideMap}
              payOnClosedDays={payOnClosedDays}
            />
          ))}
        </div>
      )}

      <Card className="mt-4">
        <CardHeader>
          <CardTitle>ประวัติการตัดจ่าย</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>พนักงาน</TableHead>
                <TableHead>งวด</TableHead>
                <TableHead className="text-right">วันทำงาน</TableHead>
                <TableHead className="text-right">ค่าจ้างรวม</TableHead>
                <TableHead className="text-right">เบิกไปแล้ว</TableHead>
                <TableHead className="text-right">จ่ายจริง</TableHead>
                <TableHead>วันที่จ่าย</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {history.map((s) => (
                <TableRow key={s.id}>
                  <TableCell className="font-medium">{s.staffName}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatKey(s.periodStart)} – {formatKey(s.periodEnd)}
                  </TableCell>
                  <TableCell className="text-right">{s.daysWorked}</TableCell>
                  <TableCell className="text-right">{formatCurrency(s.accruedWage, currency)}</TableCell>
                  <TableCell className="text-right">{formatCurrency(s.totalAdvances, currency)}</TableCell>
                  <TableCell className="text-right font-medium">{formatCurrency(s.netPaid, currency)}</TableCell>
                  <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                    {formatKey(bangkokDateKey(s.paidAt))}
                  </TableCell>
                </TableRow>
              ))}
              {history.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={7} className="text-center text-muted-foreground">
                    ยังไม่มีประวัติการตัดจ่าย
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <EnrollDialog
        open={enrollOpen}
        onOpenChange={setEnrollOpen}
        shopId={shopId ?? ""}
        candidates={enrollableStaff}
      />
    </AdminSection>
    </ModuleGate>
  );
}

function EnrollDialog({
  open,
  onOpenChange,
  shopId,
  candidates,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
  candidates: AppUser[];
}) {
  const [staffId, setStaffId] = useState("");
  const [wageText, setWageText] = useState("");
  // Defaults to today, but editable — an employee is often enrolled a few days *after* they
  // actually started (item: "เริ่มทำงานตั้งแต่วันที่ 17" said about someone being set up here
  // after the fact), and this is the day wage accrual starts counting from, so it has to be
  // correctable rather than always locked to "today".
  const [startDateKey, setStartDateKey] = useState(() => todayKey());
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStaffId(candidates[0]?.id ?? "");
      setWageText("");
      setStartDateKey(todayKey());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const wage = Number(wageText);
  const canSave = Boolean(shopId) && Boolean(staffId) && Number.isFinite(wage) && wage > 0 && Boolean(startDateKey);

  async function handleSave() {
    if (!canSave || saving) return;
    const person = candidates.find((c) => c.id === staffId);
    if (!person) return;
    setSaving(true);
    try {
      const now = Date.now();
      await payrollEmployeeRepository.enroll({
        shopId,
        staffId: person.id,
        staffName: person.name,
        dailyWage: wage,
        active: true,
        createdDateKey: startDateKey,
        createdAt: now,
        updatedAt: now,
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
          <DialogTitle>เพิ่มพนักงานเข้าระบบเงินเดือน</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label>พนักงาน</Label>
            <Select value={staffId} onValueChange={setStaffId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid gap-2">
            <Label htmlFor="daily-wage">ค่าจ้างต่อวัน (บาท)</Label>
            <Input
              id="daily-wage"
              type="number"
              inputMode="decimal"
              min={0}
              value={wageText}
              onChange={(e) => setWageText(e.target.value)}
              placeholder="เช่น 350"
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="start-date">เริ่มทำงานตั้งแต่วันที่</Label>
            <Input
              id="start-date"
              type="date"
              value={startDateKey}
              onChange={(e) => setStartDateKey(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">ค่าจ้างจะเริ่มนับสะสมจากวันนี้เป็นต้นไป</p>
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

function EmployeeCard({
  employee,
  advances,
  absences,
  settlements,
  currency,
  createdBy,
  createdByName,
  closedDaysOfMonth,
  closedDateOverrideMap,
  payOnClosedDays,
}: {
  employee: PayrollEmployee;
  advances: PayrollAdvance[];
  absences: PayrollAbsence[];
  settlements: PayrollSettlement[];
  currency: string;
  createdBy: string;
  createdByName: string;
  closedDaysOfMonth: number[];
  closedDateOverrideMap: ReadonlyMap<string, boolean>;
  payOnClosedDays: boolean;
}) {
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [absentOpen, setAbsentOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [editingWage, setEditingWage] = useState(false);
  const [wageText, setWageText] = useState(String(employee.dailyWage));
  const [savingWage, setSavingWage] = useState(false);
  const [editingStart, setEditingStart] = useState(false);
  const [startDateText, setStartDateText] = useState(employee.createdDateKey);
  const [savingStart, setSavingStart] = useState(false);

  const today = todayKey();

  // The most recent settlement's periodEnd (if any) is what the current period starts the day
  // after — see `computeCurrentPeriodStart`'s comment. Employees can be settled more than once,
  // so this needs the *latest* one, not just "any".
  const periodStart = useMemo(() => {
    const latestEnd = settlements.reduce<string | null>(
      (max, s) => (max === null || s.periodEnd > max ? s.periodEnd : max),
      null
    );
    return computeCurrentPeriodStart(employee.createdDateKey, latestEnd);
  }, [employee.createdDateKey, settlements]);

  const absentDateKeys = useMemo(() => new Set(absences.map((a) => a.dateKey)), [absences]);

  const periodAdvances = useMemo(
    () => advances.filter((a) => a.dateKey >= periodStart && a.dateKey <= today).sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
    [advances, periodStart, today]
  );
  const periodAbsences = useMemo(
    () => absences.filter((a) => a.dateKey >= periodStart && a.dateKey <= today).sort((a, b) => b.dateKey.localeCompare(a.dateKey)),
    [absences, periodStart, today]
  );

  const closedDateKeys = useMemo(
    () => closedDateKeysInRange(periodStart, today, closedDaysOfMonth, closedDateOverrideMap),
    [periodStart, today, closedDaysOfMonth, closedDateOverrideMap]
  );
  const accrual = useMemo(
    () => computeAccrual(periodStart, today, employee.dailyWage, absentDateKeys, closedDateKeys, payOnClosedDays),
    [periodStart, today, employee.dailyWage, absentDateKeys, closedDateKeys, payOnClosedDays]
  );
  const totalAdvances = useMemo(() => periodAdvances.reduce((sum, a) => sum + a.amount, 0), [periodAdvances]);
  const available = computeAvailableAdvance(accrual.accruedWage, totalAdvances);

  async function saveWage() {
    const wage = Number(wageText);
    if (!Number.isFinite(wage) || wage <= 0 || savingWage) return;
    setSavingWage(true);
    try {
      await payrollEmployeeRepository.update(employee.id, { dailyWage: wage, updatedAt: Date.now() });
      setEditingWage(false);
    } finally {
      setSavingWage(false);
    }
  }

  async function toggleActive() {
    await payrollEmployeeRepository.update(employee.id, { active: !employee.active, updatedAt: Date.now() });
  }

  // Only meaningful before the first "ตัดจ่าย" — once a settlement exists, `periodStart` derives
  // from that settlement's `periodEnd` instead (see `computeCurrentPeriodStart`), so changing
  // `createdDateKey` at that point would no longer affect anything and would just be confusing to
  // offer. Item: "เริ่มงานวันที่ 17" — an employee enrolled a few days after their actual first day
  // needs this correctable, not locked to whatever the enroll dialog happened to default to.
  const canEditStart = settlements.length === 0;

  async function saveStart() {
    if (!startDateText || savingStart) return;
    setSavingStart(true);
    try {
      await payrollEmployeeRepository.update(employee.id, { createdDateKey: startDateText, updatedAt: Date.now() });
      setEditingStart(false);
    } finally {
      setSavingStart(false);
    }
  }

  return (
    <Card className={employee.active ? undefined : "opacity-60"}>
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>{employee.staffName}</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant={employee.active ? "success" : "muted"}>{employee.active ? "ใช้งานอยู่" : "ปิดอยู่"}</Badge>
            <Button size="sm" variant="ghost" onClick={toggleActive}>
              {employee.active ? "ปิดใช้งาน" : "เปิดใช้งาน"}
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">ค่าจ้าง/วัน</span>
          {editingWage ? (
            <>
              <Input
                type="number"
                inputMode="decimal"
                min={0}
                value={wageText}
                onChange={(e) => setWageText(e.target.value)}
                className="h-8 w-28"
                autoFocus
              />
              <Button size="sm" className="h-8 px-2" onClick={saveWage} disabled={savingWage}>
                บันทึก
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditingWage(false)}>
                ยกเลิก
              </Button>
            </>
          ) : (
            <>
              <span className="font-medium">{formatCurrency(employee.dailyWage, currency)}</span>
              <Button
                size="sm"
                variant="ghost"
                className="h-8 px-2"
                onClick={() => {
                  setWageText(String(employee.dailyWage));
                  setEditingWage(true);
                }}
              >
                แก้ไข
              </Button>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          {editingStart ? (
            <>
              <span>เริ่มงานวันที่</span>
              <Input
                type="date"
                value={startDateText}
                onChange={(e) => setStartDateText(e.target.value)}
                className="h-8 w-40"
                autoFocus
              />
              <Button size="sm" className="h-8 px-2" onClick={saveStart} disabled={savingStart || !startDateText}>
                บันทึก
              </Button>
              <Button size="sm" variant="ghost" className="h-8 px-2" onClick={() => setEditingStart(false)}>
                ยกเลิก
              </Button>
            </>
          ) : (
            <>
              <span>
                งวดปัจจุบัน {formatKey(periodStart)} – {formatKey(today)} ({accrual.daysWorked} วันทำงาน)
              </span>
              {canEditStart ? (
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-6 px-2 text-xs"
                  onClick={() => {
                    setStartDateText(employee.createdDateKey);
                    setEditingStart(true);
                  }}
                >
                  แก้วันเริ่มงาน
                </Button>
              ) : null}
            </>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label="ค่าจ้างสะสม" value={formatCurrency(accrual.accruedWage, currency)} />
          <Stat label="เบิกไปแล้ว" value={formatCurrency(totalAdvances, currency)} />
          <Stat label="คงเหลือ" value={formatCurrency(available, currency)} emphasize />
          <Stat label="ลาในงวดนี้" value={`${periodAbsences.length} วัน`} />
        </div>

        {periodAdvances.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">รายการเบิกในงวดนี้ ({periodAdvances.length})</summary>
            <ul className="mt-2 grid gap-1">
              {periodAdvances.map((a) => (
                <li key={a.id} className="flex justify-between gap-2 text-muted-foreground">
                  <span>
                    {formatKey(a.dateKey)}
                    {a.note ? ` — ${a.note}` : ""}
                  </span>
                  <span className="whitespace-nowrap">{formatCurrency(a.amount, currency)}</span>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        {periodAbsences.length > 0 ? (
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">วันลาในงวดนี้ ({periodAbsences.length})</summary>
            <ul className="mt-2 grid gap-1">
              {periodAbsences.map((a) => (
                <li key={a.id} className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>{formatKey(a.dateKey)}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-xs text-destructive"
                    onClick={() => payrollAbsenceRepository.unmarkAbsent(employee.staffId, a.dateKey)}
                  >
                    ยกเลิกลา
                  </Button>
                </li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => setAdvanceOpen(true)} disabled={available <= 0}>
            + เบิก
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAbsentOpen(true)}>
            มาร์กลา
          </Button>
          <Button size="sm" onClick={() => setSettleOpen(true)} disabled={accrual.daysWorked === 0}>
            ตัดจ่าย
          </Button>
        </div>
      </CardContent>

      <AdvanceDialog
        open={advanceOpen}
        onOpenChange={setAdvanceOpen}
        employee={employee}
        available={available}
        currency={currency}
        createdBy={createdBy}
        createdByName={createdByName}
      />
      <AbsentDialog open={absentOpen} onOpenChange={setAbsentOpen} employee={employee} today={today} absentDateKeys={absentDateKeys} />
      <SettleDialog
        open={settleOpen}
        onOpenChange={setSettleOpen}
        employee={employee}
        periodStart={periodStart}
        today={today}
        absentDateKeys={absentDateKeys}
        totalAdvances={totalAdvances}
        currency={currency}
        paidBy={createdBy}
        paidByName={createdByName}
        closedDaysOfMonth={closedDaysOfMonth}
        closedDateOverrideMap={closedDateOverrideMap}
        payOnClosedDays={payOnClosedDays}
      />
    </Card>
  );
}

const WEEKDAY_LABELS = ["อา", "จ", "อ", "พ", "พฤ", "ศ", "ส"];

function formatMonthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("th-TH", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

function dayCellClassFor(status: ShopClosedStatus): string {
  switch (status) {
    case "recurring":
      return "bg-destructive/10 text-destructive font-medium hover:bg-destructive/20";
    case "override-closed":
      return "bg-destructive text-destructive-foreground font-semibold hover:opacity-90";
    case "override-open":
      return "border border-dashed border-success bg-success/15 text-success font-semibold hover:bg-success/25";
    case "open":
      return "bg-muted text-foreground hover:bg-muted/70";
  }
}

/**
 * "วันหยุดร้าน" redesign (item: "ร้านหยุด แก้ไขใหม่ให้ใช้งานกว่าเดิม ... สามารถตั้งให้จ่ายหรือไม่จ่ายได้
 * กำหนดวันที่แทนได้ น่าจะง่ายกว่า"), confirmed against a mockup before implementation:
 * - One shop-wide switch (`ShopSettings.payOnClosedDays`) controls whether a closed day still
 *   pays wage — the owner's confirmed choice over a per-date version of the same toggle.
 * - The old "pick which days of the month" 1-31 button grid is gone, replaced by an actual
 *   month calendar the owner clicks dates on directly — but the recurring `closedDaysOfMonth`
 *   rule it used to edit was deliberately left completely alone: it still applies automatically
 *   to every month from here on, exactly as before. Clicking a date never edits that rule; it
 *   only adds/removes a per-date `shopClosedDates` override on top of it (`shopClosedDateRepository`
 *   already treated these as independent layers — see `lib/pos/shopCalendar.ts`), so nothing about
 *   already-scheduled future closures (e.g. every 1st and 16th) was at risk of quietly breaking.
 *
 * Both layers feed `computeAccrual`/`computeSettlementPreview` above via `closedDateKeysInRange`:
 * a closed day never counts as worked for any enrolled employee (unless `payOnClosedDays` is on),
 * without anyone having to mark each person "ลา" individually. Placed on this page (not a generic
 * settings page) since payroll wage accrual is the one place this actually changes a number.
 */
function ShopClosedDaysCard({
  shopId,
  closedDaysOfMonth,
  overrides,
  payOnClosedDays,
  onPayOnClosedDaysChange,
  createdBy,
  createdByName,
}: {
  shopId: string;
  closedDaysOfMonth: number[];
  overrides: ShopClosedDate[];
  payOnClosedDays: boolean;
  onPayOnClosedDaysChange: (value: boolean) => void;
  createdBy: string;
  createdByName: string;
}) {
  const [monthKey, setMonthKey] = useState(() => todayKey().slice(0, 7));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [savingDate, setSavingDate] = useState(false);
  const [savingPayToggle, setSavingPayToggle] = useState(false);

  const overrideMap = useMemo(() => toOverrideMap(overrides), [overrides]);
  const overrideByDateKey = useMemo(() => new Map(overrides.map((o) => [o.dateKey, o])), [overrides]);
  const sortedOverrides = useMemo(() => [...overrides].sort((a, b) => b.dateKey.localeCompare(a.dateKey)), [overrides]);
  const dateKeys = useMemo(() => dateKeysInMonth(monthKey), [monthKey]);
  const leadingBlanks = dateKeys.length > 0 ? weekdayOfDateKey(dateKeys[0]) : 0;
  const today = todayKey();

  // Keeps the note field in sync with whatever `overrides` actually says for the selected day —
  // covers both switching the selection and a save/remove round-tripping back from Firestore.
  useEffect(() => {
    if (selectedKey) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setNoteDraft(overrideByDateKey.get(selectedKey)?.note ?? "");
    }
  }, [selectedKey, overrideByDateKey]);

  async function togglePayOnClosedDays(next: boolean) {
    if (!shopId || savingPayToggle) return;
    setSavingPayToggle(true);
    try {
      await shopRepository.updateSettings(shopId, { payOnClosedDays: next, updatedAt: Date.now() });
      onPayOnClosedDaysChange(next);
    } finally {
      setSavingPayToggle(false);
    }
  }

  async function saveOverride(dateKey: string, closed: boolean) {
    if (!shopId || savingDate) return;
    setSavingDate(true);
    try {
      await shopClosedDateRepository.set({
        shopId,
        dateKey,
        closed,
        note: noteDraft.trim(),
        createdBy,
        createdByName,
        createdAt: Date.now(),
      });
    } finally {
      setSavingDate(false);
    }
  }

  async function removeOverride(dateKey: string) {
    if (!shopId) return;
    await shopClosedDateRepository.clear(shopId, dateKey);
    if (selectedKey === dateKey) setSelectedKey(null);
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>วันหยุดร้าน</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4">
        <div className="flex items-center justify-between gap-3 rounded-lg border border-border p-4">
          <div>
            <p className="font-medium">จ่ายค่าจ้างวันหยุดร้านหรือไม่</p>
            <p className="text-sm text-muted-foreground">
              {payOnClosedDays
                ? "จ่าย — วันหยุดร้านยังนับเป็นวันทำงาน จ่ายค่าจ้างตามปกติ เหมือนวันหยุดแบบได้ค่าจ้าง"
                : "ไม่จ่าย — วันหยุดร้านไม่นับเป็นวันทำงาน พนักงานจะไม่ได้ค่าจ้างวันนั้น"}
            </p>
          </div>
          <Switch checked={payOnClosedDays} disabled={savingPayToggle} onCheckedChange={togglePayOnClosedDays} />
        </div>

        <div>
          <p className="mb-2 text-sm text-muted-foreground">
            คลิกวันที่เพื่อปิดร้านเพิ่ม หรือเปิดร้านตามปกติในวันที่ปกติหยุด — วันหยุดประจำทุกเดือน (วันที่{" "}
            {closedDaysOfMonth.length > 0 ? closedDaysOfMonth.join(", ") : "ไม่มี"}) ยังใช้อัตโนมัติทุกเดือนเหมือนเดิม
          </p>
          <div className="mb-2 flex items-center justify-between">
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => setMonthKey((k) => shiftMonthKey(k, -1))}
              aria-label="เดือนก่อนหน้า"
            >
              ‹
            </Button>
            <p className="font-medium">{formatMonthLabel(monthKey)}</p>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => setMonthKey((k) => shiftMonthKey(k, 1))}
              aria-label="เดือนถัดไป"
            >
              ›
            </Button>
          </div>
          <div className="grid grid-cols-7 gap-1 text-center text-xs text-muted-foreground">
            {WEEKDAY_LABELS.map((w) => (
              <div key={w}>{w}</div>
            ))}
          </div>
          <div className="mt-1 grid grid-cols-7 gap-1">
            {Array.from({ length: leadingBlanks }, (_, i) => (
              <div key={`b${i}`} />
            ))}
            {dateKeys.map((dateKey) => {
              const status = resolveClosedStatus(dateKey, closedDaysOfMonth, overrideMap);
              return (
                <button
                  key={dateKey}
                  type="button"
                  onClick={() => setSelectedKey(dateKey)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-md text-sm transition-colors",
                    dayCellClassFor(status),
                    dateKey === today ? "ring-2 ring-primary ring-offset-1" : "",
                    dateKey === selectedKey ? "outline outline-2 outline-offset-2 outline-foreground" : ""
                  )}
                >
                  {Number(dateKey.slice(-2))}
                </button>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
            <LegendItem swatchClassName="bg-destructive/10" label="หยุดประจำ" />
            <LegendItem swatchClassName="bg-destructive" label="ปิดพิเศษ" />
            <LegendItem swatchClassName="border border-dashed border-success bg-success/15" label="เปิดตามปกติ" />
            <LegendItem swatchClassName="bg-muted" label="เปิดร้านปกติ" />
          </div>

          {selectedKey ? (
            <DayEditorPanel
              dateKey={selectedKey}
              status={resolveClosedStatus(selectedKey, closedDaysOfMonth, overrideMap)}
              note={noteDraft}
              onNoteChange={setNoteDraft}
              saving={savingDate}
              onMarkClosed={() => saveOverride(selectedKey, true)}
              onMarkOpen={() => saveOverride(selectedKey, false)}
              onClearOverride={() => removeOverride(selectedKey)}
            />
          ) : null}
        </div>

        <div>
          <p className="mb-2 text-sm text-muted-foreground">วันพิเศษทั้งหมด — วันที่ถูกปรับนอกเหนือจากวันหยุดประจำ</p>
          {sortedOverrides.length > 0 ? (
            <ul className="grid gap-1 text-sm">
              {sortedOverrides.map((o) => (
                <li key={o.id} className="flex items-center justify-between gap-2 rounded-md border border-border p-2">
                  <span className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{formatKey(o.dateKey)}</span>
                    <Badge variant={o.closed ? "destructive" : "success"}>{o.closed ? "ปิดพิเศษ" : "เปิดตามปกติ"}</Badge>
                    {o.note ? <span className="text-muted-foreground">{o.note}</span> : null}
                  </span>
                  <Button size="sm" variant="ghost" className="h-6 px-2 text-xs text-destructive" onClick={() => removeOverride(o.dateKey)}>
                    ลบ
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">ยังไม่มีวันพิเศษ</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function LegendItem({ swatchClassName, label }: { swatchClassName: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={cn("inline-block h-3 w-3 rounded-sm", swatchClassName)} />
      {label}
    </span>
  );
}

const DAY_STATUS_TEXT: Record<ShopClosedStatus, string> = {
  recurring: "ขณะนี้: ปิด (วันหยุดประจำทุกเดือน)",
  "override-closed": "ขณะนี้: ปิดพิเศษ",
  "override-open": "ขณะนี้: เปิดตามปกติ (ยกเว้นวันหยุดประจำ)",
  open: "ขณะนี้: เปิดร้านตามปกติ",
};

/** The panel that appears below the calendar once a date is clicked — one click to flip the
 * day's status (plus an optional note), instead of the old separate "+ เพิ่มวันพิเศษ" dialog with
 * its own date input and type dropdown. */
function DayEditorPanel({
  dateKey,
  status,
  note,
  onNoteChange,
  saving,
  onMarkClosed,
  onMarkOpen,
  onClearOverride,
}: {
  dateKey: string;
  status: ShopClosedStatus;
  note: string;
  onNoteChange: (value: string) => void;
  saving: boolean;
  onMarkClosed: () => void;
  onMarkOpen: () => void;
  onClearOverride: () => void;
}) {
  return (
    <div className="mt-3 rounded-lg border border-border bg-muted/30 p-3">
      <p className="font-medium">{formatKey(dateKey)}</p>
      <p className="mb-3 text-sm text-muted-foreground">{DAY_STATUS_TEXT[status]}</p>
      <div className="flex flex-wrap gap-2">
        {status === "open" ? (
          <Button size="sm" variant="destructive" disabled={saving} onClick={onMarkClosed}>
            ปิดร้านวันนี้
          </Button>
        ) : null}
        {status === "recurring" ? (
          <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90" disabled={saving} onClick={onMarkOpen}>
            เปิดร้านวันนี้ (ยกเว้นเดือนนี้เดือนเดียว)
          </Button>
        ) : null}
        {status === "override-closed" ? (
          <Button size="sm" className="bg-success text-success-foreground hover:bg-success/90" disabled={saving} onClick={onMarkOpen}>
            เปิดร้านวันนี้
          </Button>
        ) : null}
        {status === "override-open" ? (
          <Button size="sm" variant="destructive" disabled={saving} onClick={onMarkClosed}>
            ปิดร้านวันนี้
          </Button>
        ) : null}
        {status === "override-closed" || status === "override-open" ? (
          <Button size="sm" variant="ghost" disabled={saving} onClick={onClearOverride}>
            ลบวันพิเศษนี้ (กลับไปใช้ค่าเริ่มต้น)
          </Button>
        ) : null}
      </div>
      <div className="mt-3 grid gap-1.5">
        <Label htmlFor="day-editor-note" className="text-xs text-muted-foreground">
          หมายเหตุ (ถ้ามี)
        </Label>
        <Input
          id="day-editor-note"
          value={note}
          onChange={(e) => onNoteChange(e.target.value)}
          placeholder="เช่น วันสงกรานต์, ปิดซ่อมแอร์"
          className="h-8 text-sm"
        />
      </div>
    </div>
  );
}

function Stat({ label, value, emphasize }: { label: string; value: string; emphasize?: boolean }) {
  return (
    <div className="rounded-md border border-border p-2">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={emphasize ? "text-lg font-semibold" : "font-medium"}>{value}</p>
    </div>
  );
}

function AdvanceDialog({
  open,
  onOpenChange,
  employee,
  available,
  currency,
  createdBy,
  createdByName,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: PayrollEmployee;
  available: number;
  currency: string;
  createdBy: string;
  createdByName: string;
}) {
  const [amountText, setAmountText] = useState("");
  const [note, setNote] = useState("");
  const [dateKey, setDateKey] = useState(todayKey());
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmountText("");
      setNote("");
      setDateKey(todayKey());
      setError(null);
    }
  }, [open]);

  const amount = Number(amountText);
  const canSave = Number.isFinite(amount) && amount > 0 && amount <= available;

  async function handleSave() {
    if (!Number.isFinite(amount) || amount <= 0) return;
    // The shop owner's own rule: เบิกได้ไม่เกินยอดที่ค้างจ่าย — checked again here (not just via
    // the disabled button) since `available` could have shifted slightly between render and
    // click if another admin is also on this page.
    if (amount > available) {
      setError(`เบิกได้ไม่เกินยอดที่ค้างจ่าย — ตอนนี้เหลือ ${formatCurrency(available, currency)}`);
      return;
    }
    setSaving(true);
    try {
      await payrollAdvanceRepository.create({
        shopId: employee.shopId,
        staffId: employee.staffId,
        staffName: employee.staffName,
        amount,
        dateKey,
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
          <DialogTitle>เบิกเงิน — {employee.staffName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <p className="text-sm text-muted-foreground">
            เบิกได้ไม่เกิน <span className="font-medium text-foreground">{formatCurrency(available, currency)}</span>
          </p>
          <div className="grid gap-2">
            <Label htmlFor="advance-amount">จำนวนเงิน</Label>
            <Input
              id="advance-amount"
              type="number"
              inputMode="decimal"
              min={0}
              max={available}
              value={amountText}
              onChange={(e) => setAmountText(e.target.value)}
              autoFocus
            />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="advance-date">วันที่เบิก</Label>
            <Input id="advance-date" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="advance-note">หมายเหตุ (ไม่บังคับ)</Label>
            <Input id="advance-note" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {error ? <p className="text-sm text-destructive">{error}</p> : null}
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

function AbsentDialog({
  open,
  onOpenChange,
  employee,
  today,
  absentDateKeys,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: PayrollEmployee;
  today: string;
  absentDateKeys: ReadonlySet<string>;
}) {
  const [dateKey, setDateKey] = useState(today);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setDateKey(today);
  }, [open, today]);

  const alreadyMarked = absentDateKeys.has(dateKey);

  async function handleSave() {
    if (saving) return;
    setSaving(true);
    try {
      await payrollAbsenceRepository.markAbsent(employee.shopId, employee.staffId, dateKey);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>มาร์กลา — {employee.staffName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="absence-date">วันที่ลา</Label>
            <Input id="absence-date" type="date" value={dateKey} onChange={(e) => setDateKey(e.target.value)} />
          </div>
          {alreadyMarked ? <p className="text-sm text-muted-foreground">วันนี้มาร์กลาไว้แล้ว</p> : null}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button onClick={handleSave} disabled={saving || alreadyMarked}>
            บันทึก
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SettleDialog({
  open,
  onOpenChange,
  employee,
  periodStart,
  today,
  absentDateKeys,
  totalAdvances,
  currency,
  paidBy,
  paidByName,
  closedDaysOfMonth,
  closedDateOverrideMap,
  payOnClosedDays,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  employee: PayrollEmployee;
  periodStart: string;
  today: string;
  absentDateKeys: ReadonlySet<string>;
  totalAdvances: number;
  currency: string;
  paidBy: string;
  paidByName: string;
  closedDaysOfMonth: number[];
  closedDateOverrideMap: ReadonlyMap<string, boolean>;
  payOnClosedDays: boolean;
}) {
  // Defaults to the nearest 1st/16th cutoff (see `suggestedSettlementEnd`'s comment) when today
  // is payday, clamped so it never lands before the period even started (an employee enrolled
  // partway through the current half-month has no "yesterday's cutoff" to suggest).
  const defaultPeriodEnd = useMemo(() => {
    const suggested = suggestedSettlementEnd(today);
    return suggested < periodStart ? today : suggested;
  }, [today, periodStart]);
  const [periodEnd, setPeriodEnd] = useState(defaultPeriodEnd);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setPeriodEnd(defaultPeriodEnd);
  }, [open, defaultPeriodEnd]);

  // Advances taken strictly within [periodStart, periodEnd] — if periodEnd is pulled back
  // earlier than today (settling a bit late, not counting today's not-yet-worked day), any
  // advance dated after it correctly falls into the *next* period instead of this settlement.
  const closedDateKeys = useMemo(
    () => closedDateKeysInRange(periodStart, periodEnd, closedDaysOfMonth, closedDateOverrideMap),
    [periodStart, periodEnd, closedDaysOfMonth, closedDateOverrideMap]
  );
  const preview = useMemo(
    () =>
      computeSettlementPreview(
        periodStart,
        periodEnd,
        employee.dailyWage,
        absentDateKeys,
        totalAdvances,
        closedDateKeys,
        payOnClosedDays
      ),
    [periodStart, periodEnd, employee.dailyWage, absentDateKeys, totalAdvances, closedDateKeys, payOnClosedDays]
  );

  async function handleConfirm() {
    if (saving) return;
    setSaving(true);
    try {
      await payrollSettlementRepository.create({
        shopId: employee.shopId,
        staffId: employee.staffId,
        staffName: employee.staffName,
        periodStart,
        periodEnd,
        dailyWage: employee.dailyWage,
        daysWorked: preview.daysWorked,
        accruedWage: preview.accruedWage,
        totalAdvances: preview.totalAdvances,
        netPaid: preview.netPaid,
        paidAt: Date.now(),
        paidBy,
        paidByName,
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
          <DialogTitle>ตัดจ่าย — {employee.staffName}</DialogTitle>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid gap-2">
            <Label htmlFor="settle-end">ถึงวันที่</Label>
            <Input
              id="settle-end"
              type="date"
              value={periodEnd}
              min={periodStart}
              max={today}
              onChange={(e) => setPeriodEnd(e.target.value)}
            />
            <p className="text-xs text-muted-foreground">งวด {formatKey(periodStart)} – {formatKey(periodEnd)}</p>
          </div>
          <div className="grid gap-1 rounded-md border border-border p-3 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">วันทำงาน</span>
              <span>{preview.daysWorked} วัน</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">ค่าจ้างรวม</span>
              <span>{formatCurrency(preview.accruedWage, currency)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">หักเบิกไปแล้ว</span>
              <span>-{formatCurrency(preview.totalAdvances, currency)}</span>
            </div>
            <div className="mt-1 flex justify-between border-t border-border pt-1 font-semibold">
              <span>จ่ายจริง</span>
              <span>{formatCurrency(preview.netPaid, currency)}</span>
            </div>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button onClick={handleConfirm} disabled={saving}>
            ยืนยันจ่าย
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
