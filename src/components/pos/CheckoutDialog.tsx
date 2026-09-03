"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatCurrency } from "@/lib/format";
import type { OrderTotals } from "@/lib/pos/pricing";
import type { PaymentMethod } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  totals: OrderTotals;
  currency: string;
  paymentMethods: PaymentMethod[];
  saving: boolean;
  onConfirm: (payment: {
    paymentMethodId: string;
    paymentMethodName: string;
    cashReceived: number | null;
    changeDue: number | null;
  }) => void;
}

/** Checkout lives inside the order screen as a Dialog (item 26: never switch pages to pay). */
export function CheckoutDialog({
  open,
  onOpenChange,
  totals,
  currency,
  paymentMethods,
  saving,
  onConfirm,
}: Props) {
  const [methodId, setMethodId] = useState<string>(paymentMethods[0]?.id ?? "");
  const [cashReceivedText, setCashReceivedText] = useState("");

  const method = paymentMethods.find((m) => m.id === methodId);
  const isCash = method?.code === "cash";
  const cashReceived = Number(cashReceivedText);
  const changeDue = isCash && Number.isFinite(cashReceived) ? cashReceived - totals.total : null;
  const canConfirm = Boolean(method) && (!isCash || (changeDue !== null && changeDue >= 0));

  function handleConfirm() {
    if (!method) return;
    onConfirm({
      paymentMethodId: method.id,
      paymentMethodName: method.name,
      cashReceived: isCash ? cashReceived : null,
      changeDue: isCash ? changeDue : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>คิดเงิน</DialogTitle>
        </DialogHeader>

        <div className="grid gap-3 text-sm">
          <Row label="ยอดรวม" value={formatCurrency(totals.subtotal, currency)} />
          {totals.discount > 0 ? <Row label="ส่วนลด" value={`-${formatCurrency(totals.discount, currency)}`} /> : null}
          {totals.serviceCharge > 0 ? (
            <Row label="ค่าบริการ" value={formatCurrency(totals.serviceCharge, currency)} />
          ) : null}
          {totals.tax > 0 ? <Row label="ภาษีมูลค่าเพิ่ม" value={formatCurrency(totals.tax, currency)} /> : null}
          <Row label="ยอดชำระ" value={formatCurrency(totals.total, currency)} bold />
        </div>

        <div className="grid gap-2">
          <p className="text-sm font-medium">วิธีชำระเงิน</p>
          <Select value={methodId} onValueChange={setMethodId}>
            <SelectTrigger>
              <SelectValue placeholder="เลือกวิธีชำระเงิน" />
            </SelectTrigger>
            <SelectContent>
              {paymentMethods.map((m) => (
                <SelectItem key={m.id} value={m.id}>
                  {m.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {isCash ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">รับเงินมา</p>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              value={cashReceivedText}
              onChange={(e) => setCashReceivedText(e.target.value)}
              autoFocus
            />
            {changeDue !== null ? (
              <p className={"text-sm " + (changeDue < 0 ? "text-destructive" : "text-muted-foreground")}>
                {changeDue < 0 ? "เงินไม่พอ" : `เงินทอน ${formatCurrency(changeDue, currency)}`}
              </p>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            ยกเลิก
          </Button>
          <Button onClick={handleConfirm} disabled={!canConfirm || saving}>
            ยืนยันชำระเงิน
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Row({ label, value, bold }: { label: string; value: string; bold?: boolean }) {
  return (
    <div className={"flex items-center justify-between " + (bold ? "text-base font-semibold" : "")}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}
