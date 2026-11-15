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
import { computeOrderTotals, groupItemsByProduct, resolveManualDiscount } from "@/lib/pos/pricing";
import type { OrderItem, PaymentMethod, ShopSettings } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  items: OrderItem[];
  settings: Pick<ShopSettings, "vatEnabled" | "vatRate" | "serviceChargeEnabled" | "serviceChargeRate" | "currency">;
  paymentMethods: PaymentMethod[];
  saving: boolean;
  onConfirm: (payment: {
    paymentMethodId: string;
    paymentMethodName: string;
    cashReceived: number | null;
    changeDue: number | null;
    /** Baht taken off on top of any promotion discount — 0 when staff left the discount field
     * blank. See the "ส่วนลดเพิ่มเติม" input's comment below for why this is computed here rather
     * than passed in already-applied. */
    manualDiscount: number;
  }) => void;
  /** Present only when check-bill printing is on — shows a "พิมพ์บิลอีกครั้ง" button. */
  onReprintCheckBill?: () => void;
  /** True while a "พิมพ์บิลอีกครั้ง" tap is still being sent — disables the button so a slow
   * connection (mobile data, especially) can't turn a second impatient tap into a second
   * duplicate print job. Defaults to false since most callers don't pass it. */
  reprintingCheckBill?: boolean;
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
  settings,
  paymentMethods,
  saving,
  onConfirm,
  onReprintCheckBill,
  reprintingCheckBill = false,
}: Props) {
  const currency = settings.currency;
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
  // ส่วนลดเพิ่มเติม (item: "เพิ่มช่องโปรโมชั่นส่วนลดหน่อย") — a free-form discount staff can key in
  // right here before confirming, on top of whatever promotion discount the items already carry.
  // Kept as mode + raw text (not baht-already-applied) so switching บาท/% recomputes live against
  // the current subtotal instead of needing the previous amount re-entered.
  const [discountMode, setDiscountMode] = useState<"amount" | "percent">("amount");
  const [discountText, setDiscountText] = useState("");

  // This dialog stays mounted across orders (OrderScreen just toggles `open`), so without this
  // a staff member checking out order #2 would still see order #1's payment method highlighted
  // and its cash-received amount pre-filled — reset to a blank slate every time it opens.
  useEffect(() => {
    // Resetting on the `open` prop transition, not looping off this effect's own state.
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMethodId("");
      setCashReceivedText("");
      setDiscountMode("amount");
      setDiscountText("");
    }
  }, [open]);

  // Totals with no manual discount yet — what the subtotal/promotion discount actually are,
  // used to turn a "%" entry into baht and to cap the discount so it can never push the total
  // below what service charge + tax alone would be (a typo like "200" must not bill negative).
  const baseTotals = computeOrderTotals(items, settings);
  const discountValue = Number(discountText);
  const discountEntered = discountText.trim() !== "" && Number.isFinite(discountValue) && discountValue > 0;
  const manualDiscount = resolveManualDiscount(discountMode, discountValue, baseTotals.subtotal, baseTotals.promoDiscount);
  const rawManualDiscount = discountMode === "percent" ? (baseTotals.subtotal * discountValue) / 100 : discountValue;
  const discountClamped = discountEntered && rawManualDiscount > manualDiscount;
  const totals = computeOrderTotals(items, settings, manualDiscount);

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
      manualDiscount,
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
            <div key={`${group.productId}::${group.productName}`}>
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

        <div className="grid gap-2">
          <p className="text-sm font-medium">
            ส่วนลดเพิ่มเติม <span className="font-normal text-muted-foreground">(ไม่บังคับ)</span>
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant={discountMode === "amount" ? "default" : "outline"}
              onClick={() => setDiscountMode("amount")}
            >
              บาท
            </Button>
            <Button
              type="button"
              variant={discountMode === "percent" ? "default" : "outline"}
              onClick={() => setDiscountMode("percent")}
            >
              %
            </Button>
            <Input
              type="number"
              inputMode="decimal"
              min={0}
              placeholder={discountMode === "percent" ? "เช่น 10" : "เช่น 20"}
              value={discountText}
              onChange={(e) => setDiscountText(e.target.value)}
              className="flex-1"
            />
          </div>
          {discountEntered && (discountMode === "percent" || discountClamped) ? (
            <p className="text-xs text-muted-foreground">
              {discountMode === "percent" ? `= -${formatCurrency(manualDiscount, currency)}` : ""}
              {discountClamped ? " (ลดได้สูงสุดแค่นี้ ไม่ให้ยอดติดลบ)" : ""}
            </p>
          ) : null}
        </div>

        <div className="grid gap-3 text-sm">
          <Row label="ยอดรวม" value={formatCurrency(totals.subtotal, currency)} />
          {totals.discount > 0 ? (
            <Row
              label={totals.promoDiscount === totals.discount ? "ส่วนลดโปรโมชั่น" : "ส่วนลด"}
              value={`-${formatCurrency(totals.discount, currency)}`}
            />
          ) : null}
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
          {onReprintCheckBill ? (
            <Button
              variant="ghost"
              onClick={onReprintCheckBill}
              disabled={saving || reprintingCheckBill}
              className="sm:mr-auto"
            >
              {reprintingCheckBill ? "กำลังส่งพิมพ์..." : "พิมพ์บิลอีกครั้ง"}
            </Button>
          ) : null}
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
