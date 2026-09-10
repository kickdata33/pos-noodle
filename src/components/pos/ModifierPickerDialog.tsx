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
import { Textarea } from "@/components/ui/textarea";
import { formatCurrency } from "@/lib/format";
import type { ModifierGroup, ModifierOption, OrderItemModifier, Product } from "@/types";

interface Props {
  product: Product;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  modifierGroups: ModifierGroup[];
  modifierOptions: ModifierOption[];
  currency: string;
  onConfirm: (result: { quantity: number; modifiers: OrderItemModifier[]; note: string }) => void;
}

/**
 * Opens when a product has modifier groups attached (item 12). Required groups block "เพิ่ม"
 * until answered; single-selection groups behave like radio buttons, multi-selection groups
 * like checkboxes — matches how Admin defines each group's `selectionType`/`required`.
 */
export function ModifierPickerDialog({
  product,
  open,
  onOpenChange,
  modifierGroups,
  modifierOptions,
  currency,
  onConfirm,
}: Props) {
  // No reset effect needed: the parent only mounts this component while a product is picked
  // (`{pickerProduct ? <ModifierPickerDialog key={pickerProduct.id} .../> : null}`), and keys
  // it by product id, so React gives every open a fresh mount — state starts clean by construction.
  const [selections, setSelections] = useState<Record<string, string[]>>({});
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState("");

  const groups = product.modifierGroupIds
    .map((id) => modifierGroups.find((g) => g.id === id))
    .filter((g): g is ModifierGroup => Boolean(g) && g!.active);

  // Sold-out options (`active: false`, toggled from `/pos/stock`) still show — greyed out with
  // a "ของหมด" badge — rather than silently vanishing from the list (same reasoning as the
  // product grid; see `CustomerOrderScreen`'s and this file's own comments on why).
  function optionsFor(groupId: string): ModifierOption[] {
    return modifierOptions.filter((o) => o.groupId === groupId);
  }

  function toggleOption(group: ModifierGroup, optionId: string) {
    const option = optionsFor(group.id).find((o) => o.id === optionId);
    if (!option?.active) return; // sold out — never selectable, guards a stale/replayed tap too
    setSelections((prev) => {
      const current = prev[group.id] ?? [];
      if (group.selectionType === "single") {
        // An optional (not required) single-choice group must still be clearable — tapping the
        // already-selected option again deselects it, same as unchecking the only checked box in
        // a multi-select group below. A *required* group can't go empty by design, so the tapped
        // option there just stays selected (there's always exactly one, never zero, to pick from).
        if (current.includes(optionId) && !group.required) {
          return { ...prev, [group.id]: [] };
        }
        return { ...prev, [group.id]: [optionId] };
      }
      // Deselecting is always allowed; selecting a *new* one is blocked once `maxSelect` is
      // already reached (e.g. "เพิ่มลูกชิ้น" capped at 3) — re-tapping an already-selected option
      // still works fine since `current.includes(optionId)` takes the deselect branch below it.
      if (!current.includes(optionId) && group.maxSelect && current.length >= group.maxSelect) {
        return prev;
      }
      const next = current.includes(optionId)
        ? current.filter((id) => id !== optionId)
        : [...current, optionId];
      return { ...prev, [group.id]: next };
    });
  }

  const missingRequired = groups.some((g) => g.required && (selections[g.id] ?? []).length === 0);

  function handleConfirm() {
    const modifiers: OrderItemModifier[] = groups.flatMap((group) =>
      (selections[group.id] ?? []).map((optionId) => {
        const option = optionsFor(group.id).find((o) => o.id === optionId)!;
        return {
          groupId: group.id,
          groupName: group.name,
          optionId: option.id,
          optionName: option.name,
          priceDelta: option.priceDelta,
        };
      })
    );
    onConfirm({ quantity, modifiers, note: note.trim() });
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{product.name}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          {groups.map((group) => {
            const groupSelections = selections[group.id] ?? [];
            const atCap = Boolean(group.maxSelect) && groupSelections.length >= group.maxSelect!;
            return (
            <div key={group.id} className="grid gap-2">
              <p className="text-sm font-medium">
                {group.name}
                {group.required ? <span className="text-destructive"> *จำเป็น</span> : null}
                {group.maxSelect ? (
                  <span className="ml-2 font-normal text-muted-foreground">
                    (เลือกได้สูงสุด {group.maxSelect} — เลือกแล้ว {groupSelections.length})
                  </span>
                ) : null}
              </p>
              <div className="grid gap-2">
                {optionsFor(group.id).map((option) => {
                  const selected = groupSelections.includes(option.id);
                  const disabled = !option.active || (atCap && !selected);
                  return (
                    <button
                      key={option.id}
                      type="button"
                      disabled={disabled}
                      onClick={() => toggleOption(group, option.id)}
                      className={
                        "flex items-center justify-between rounded-lg border px-4 py-3 text-left " +
                        (disabled
                          ? "cursor-not-allowed border-border bg-muted/40 opacity-60"
                          : selected
                            ? "border-primary bg-primary/10"
                            : "border-border bg-card hover:bg-accent")
                      }
                    >
                      <span className={!option.active ? "line-through" : undefined}>{option.name}</span>
                      {!option.active ? (
                        <span className="text-xs font-medium text-destructive">ของหมด</span>
                      ) : option.priceDelta !== 0 ? (
                        <span className="text-sm text-muted-foreground">
                          +{formatCurrency(option.priceDelta, currency)}
                        </span>
                      ) : null}
                    </button>
                  );
                })}
              </div>
            </div>
            );
          })}

          <div className="grid gap-2">
            <p className="text-sm font-medium">จำนวน</p>
            <div className="flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                size="icon"
                onClick={() => setQuantity((q) => Math.max(1, q - 1))}
              >
                −
              </Button>
              <span className="w-8 text-center text-lg font-medium">{quantity}</span>
              <Button type="button" variant="outline" size="icon" onClick={() => setQuantity((q) => q + 1)}>
                +
              </Button>
            </div>
          </div>

          <div className="grid gap-2">
            <p className="text-sm font-medium">หมายเหตุ</p>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="เช่น ไม่ผัก, ไม่งอก"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button onClick={handleConfirm} disabled={missingRequired}>
            เพิ่มลงตะกร้า
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
