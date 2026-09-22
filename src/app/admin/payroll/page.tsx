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
import { useAuth } from "@/hooks/useAuth";
import { formatCurrency } from "@/lib/format";
import { bangkokDateKey } from "@/lib/pos/dateRange";
import {
  computeAccrual,
  computeAvailableAdvance,
  computeCurrentPeriodStart,
  computeSettlementPreview,
} from "@/lib/pos/payroll";
import { payrollAbsenceRepository } from "@/repositories/payrollAbsenceRepository";
import { payrollAdvanceRepository } from "@/repositories/payrollAdvanceRepository";
import { payrollEmployeeRepository } from "@/repositories/payrollEmployeeRepository";
import { payrollSettlementRepository } from "@/repositories/payrollSettlementRepository";
import { shopRepository } from "@/repositories/shopRepository";
import { userRepository } from "@/repositories/userRepository";
import type { AppUser, PayrollAbsence, PayrollAdvance, PayrollEmployee, PayrollSettlement } from "@/types";

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

  const [enrollOpen, setEnrollOpen] = useState(false);

  useEffect(() => {
    if (!shopId) return;
    shopRepository.getSettings(shopId).then((settings) => {
      if (settings) setCurrency(settings.currency);
    });
  }, [shopId]);

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
    <AdminSection
      title="ตารางพนักงาน"
      description="ค่าจ้างรายวัน เบิกล่วงหน้า และตัดจ่ายรายสัปดาห์ — แยกจากรายจ่ายทั่วไป"
      actionLabel={enrollableStaff.length > 0 ? "+ เพิ่มพนักงาน" : undefined}
      onAction={() => setEnrollOpen(true)}
    >
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
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setStaffId(candidates[0]?.id ?? "");
      setWageText("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const wage = Number(wageText);
  const canSave = Boolean(shopId) && Boolean(staffId) && Number.isFinite(wage) && wage > 0;

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
        createdDateKey: todayKey(),
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
}: {
  employee: PayrollEmployee;
  advances: PayrollAdvance[];
  absences: PayrollAbsence[];
  settlements: PayrollSettlement[];
  currency: string;
  createdBy: string;
  createdByName: string;
}) {
  const [advanceOpen, setAdvanceOpen] = useState(false);
  const [absentOpen, setAbsentOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [editingWage, setEditingWage] = useState(false);
  const [wageText, setWageText] = useState(String(employee.dailyWage));
  const [savingWage, setSavingWage] = useState(false);

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

  const accrual = useMemo(
    () => computeAccrual(periodStart, today, employee.dailyWage, absentDateKeys),
    [periodStart, today, employee.dailyWage, absentDateKeys]
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

        <p className="text-sm text-muted-foreground">
          งวดปัจจุบัน {formatKey(periodStart)} – {formatKey(today)} ({accrual.daysWorked} วันทำงาน)
        </p>

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
      />
    </Card>
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
}) {
  const [periodEnd, setPeriodEnd] = useState(today);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (open) setPeriodEnd(today);
  }, [open, today]);

  // Advances taken strictly within [periodStart, periodEnd] — if periodEnd is pulled back
  // earlier than today (settling a bit late, not counting today's not-yet-worked day), any
  // advance dated after it correctly falls into the *next* period instead of this settlement.
  const preview = useMemo(
    () => computeSettlementPreview(periodStart, periodEnd, employee.dailyWage, absentDateKeys, totalAdvances),
    [periodStart, periodEnd, employee.dailyWage, absentDateKeys, totalAdvances]
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
