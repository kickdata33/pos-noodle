"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatCurrency } from "@/lib/format";
import { groupItemsByProduct, type OrderTotals } from "@/lib/pos/pricing";
import type { OrderItem, PaymentMethod } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: OrderItem[];
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

/**
 * Checkout lives inside the order screen as a Dialog (item 26: never switch pages to pay). Shows
 * the full item breakdown (not just the totals) so staff can confirm what they're actually
 * charging for before tapping "ยืนยันชำระเงิน" — grouped the same way as the cart itself
 * (`groupItemsByProduct`), so a merged "ก๋วยเตี๋ยวหมู x2" line here still shows each note.
 */
export function CheckoutDialog({
  open,
  onOpenChange,
  items,
  totals,
  currency,
  paymentMethods,
  saving,
  onConfirm,
}: Props) {
  const groupedItems = groupItemsByProduct(items);
  // เงินสด/QR are the overwhelming majority of orders (item request: "เลือก เงินสด หรือ QR
  // ตัวใหญ่ๆ" — one big tap, no dropdown for the common case), so they get their own large
  // buttons in that fixed order regardless of `sortOrder`. Anything else the shop has configured
  // (Delivery, a custom method) still works — it just renders smaller below, since it's rarer.
  const cashMethod = paymentMethods.find((m) => m.code === "cash");
  const qrMethod = paymentMethods.find((m) => m.code === "qr");
  const otherMethods = paymentMethods.filter((m) => m.code !== "cash" && m.code !== "qr");
  const [methodId, setMethodId] = useState<string>("");
  const [cashReceivedText, setCashReceivedText] = useState("");

  // This dialog stays mounted across orders (OrderScreen just toggles `open`), so without this
  // a staff member checking out order #2 would still see order #1's payment method highlighted
  // and its cash-received amount pre-filled — reset to a blank slate every time it opens.
  useEffect(() => {
    // Resetting on the `open` prop transition, not looping off this effect's own state.
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMethodId("");
      setCashReceivedText("");
    }
  }, [open]);

  const method = paymentMethods.find((m) => m.id === methodId);
  const isCash = method?.code === "cash";
  // "รับเงินมา" is optional for now — a lot of orders get confirmed before staff bother counting
  // the exact cash handed over, so blank shouldn't block "ยืนยันชำระเงิน". Only an amount that was
  // actually typed in AND falls short of the total blocks confirming.
  const cashReceivedEntered = cashReceivedText.trim() !== "";
  const cashReceived = Number(cashReceivedText);
  const changeDue = isCash && cashReceivedEntered && Number.isFinite(cashReceived) ? cashReceived - totals.total : null;
  const cashShortfall = changeDue !== null && changeDue < 0;
  const canConfirm = Boolean(method) && !cashShortfall;

  function handleConfirm() {
    if (!method) return;
    onConfirm({
      paymentMethodId: method.id,
      paymentMethodName: method.name,
      cashReceived: isCash && changeDue !== null ? cashReceived : null,
      changeDue: isCash && changeDue !== null ? changeDue : null,
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>คิดเงิน</DialogTitle>
        </DialogHeader>

        <div className="grid max-h-48 gap-2 overflow-y-auto rounded-lg border border-border p-3 text-sm">
          {groupedItems.map((group) => (
            <div key={group.productId}>
              <div className="flex items-center justify-between font-medium">
                <span>
                  {group.productName}
                  {group.totalQty > 1 ? ` x${group.totalQty}` : ""}
                </span>
                <span>
                  {formatCurrency(
                    group.items.reduce((sum, i) => sum + i.lineTotal, 0),
                    currency
                  )}
                </span>
              </div>
              {group.items.map((item) => {
                const detail = [...item.modifiers.map((m) => m.optionName), item.note]
                  .filter(Boolean)
                  .join(", ");
                // A single, plain line (no modifiers/note, and nothing else of this product in
                // the cart) has nothing left to say beyond the header row above — skip it rather
                // than rendering an empty sub-line.
                if (group.items.length === 1 && !detail) return null;
                return (
                  <div key={item.id} className="pl-2 text-xs text-muted-foreground">
                    {group.items.length > 1 ? `x${item.quantity} — ` : ""}
                    {detail || "ไม่มีหมายเหตุ"}
                  </div>
                );
              })}
            </div>
          ))}
        </div>

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
          {(cashMethod || qrMethod) && (
            <div className="grid grid-cols-2 gap-3">
              {cashMethod ? (
                <PaymentMethodButton
                  method={cashMethod}
                  selected={methodId === cashMethod.id}
                  onSelect={() => setMethodId(cashMethod.id)}
                />
              ) : null}
              {qrMethod ? (
                <PaymentMethodButton
                  method={qrMethod}
                  selected={methodId === qrMethod.id}
                  onSelect={() => setMethodId(qrMethod.id)}
                />
              ) : null}
            </div>
          )}
          {otherMethods.length > 0 ? (
            <div className="mt-1 flex flex-wrap gap-2">
              {otherMethods.map((m) => (
                <Button
                  key={m.id}
                  type="button"
                  variant={methodId === m.id ? "default" : "outline"}
                  onClick={() => setMethodId(m.id)}
                >
                  {m.name}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        {isCash ? (
          <div className="grid gap-2">
            <p className="text-sm font-medium">รับเงินมา <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span></p>
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

/** Big one-tap payment button (item request: "เลือก เงินสด หรือ QR ตัวใหญ่ๆ") — the two most
 * common payment methods get their own oversized tap target instead of living inside a dropdown. */
function PaymentMethodButton({
  method,
  selected,
  onSelect,
}: {
  method: PaymentMethod;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <Button
      type="button"
      size="lg"
      variant={selected ? "default" : "outline"}
      className={cn("w-full text-lg", selected && "ring-2 ring-ring ring-offset-2")}
      onClick={onSelect}
    >
      {method.name}
    </Button>
  );
}
