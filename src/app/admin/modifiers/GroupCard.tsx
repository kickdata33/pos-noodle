"use client";

import { useEffect, useState } from "react";

import { SortButtons } from "@/components/admin/SortButtons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { computeSwap } from "@/lib/admin/sortOrder";
import { modifierOptionRepository } from "@/repositories/modifierRepository";
import type { ModifierGroup, ModifierOption, Product } from "@/types";

/**
 * One Modifier Group and its Options, expandable — matches item 12's shape: e.g. Group "เส้น"
 * (required, single-select) with plain options, or Group "เพิ่มเติม" (optional, multi-select)
 * with priced options like "พิเศษ +10". Real delete is offered for both group and options —
 * safe for options (a past order's `OrderItemModifier` already snapshots optionId/name/price,
 * never reads the live doc again); the group delete itself is guarded one level up in
 * `ModifiersPage` (blocked while any Product still lists this group).
 */
export function GroupCard({
  group,
  products,
  onEdit,
  onToggleActive,
  onDelete,
  onMove,
  disabledUp,
  disabledDown,
}: {
  group: ModifierGroup;
  /** Every product in the shop — filtered down here to just the ones that actually offer this
   * group, since restricting an option to a product that doesn't even use this group would be
   * meaningless (see `restrictDialogEligibleProducts`). */
  products: Product[];
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  onMove: (direction: "up" | "down") => void;
  disabledUp: boolean;
  disabledDown: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [options, setOptions] = useState<ModifierOption[]>([]);
  const [addingName, setAddingName] = useState("");
  const [addingPrice, setAddingPrice] = useState("0");
  const [saving, setSaving] = useState(false);
  // Which option's price is being edited inline right now, and its in-progress text — kept
  // separate from `options` (the live Firestore subscription) so a keystroke mid-edit is never
  // clobbered by that subscription firing, and so unrelated options re-rendering doesn't reset
  // this one's draft. Only one option can be mid-edit at a time.
  const [editingPriceId, setEditingPriceId] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState("");
  // The "จำกัดเมนู" dialog — which option it's open for (null = closed), whether restriction is
  // turned on at all, and the draft set of product ids while it's open. Kept separate from
  // `options`/the option's own `restrictToProductIds` for the same reason `priceDraft` is: a
  // mid-edit toggle shouldn't get clobbered by the live subscription.
  const [restrictOption, setRestrictOption] = useState<ModifierOption | null>(null);
  const [restrictEnabled, setRestrictEnabled] = useState(false);
  const [restrictDraft, setRestrictDraft] = useState<string[]>([]);

  // Only products that actually offer this group are meaningful choices — restricting an option
  // to a product that doesn't even list this group would just make it disappear everywhere.
  const eligibleProducts = products.filter((p) => p.modifierGroupIds.includes(group.id));

  useEffect(() => {
    if (!expanded) return;
    return modifierOptionRepository.subscribeForGroup(group.id, setOptions);
  }, [expanded, group.id]);

  async function addOption() {
    const name = addingName.trim();
    const priceDelta = Number(addingPrice) || 0;
    if (!name) return;
    setSaving(true);
    try {
      await modifierOptionRepository.create({
        shopId: group.shopId,
        groupId: group.id,
        name,
        priceDelta,
        active: true,
        sortOrder: options.length,
        createdAt: Date.now(),
      });
      setAddingName("");
      setAddingPrice("0");
    } finally {
      setSaving(false);
    }
  }

  async function toggleOptionActive(option: ModifierOption) {
    await modifierOptionRepository.update(option.id, { active: !option.active });
  }

  function startEditingPrice(option: ModifierOption) {
    setEditingPriceId(option.id);
    setPriceDraft(String(option.priceDelta));
  }

  async function commitPriceEdit(option: ModifierOption) {
    const priceDelta = Number(priceDraft) || 0;
    setEditingPriceId(null);
    if (priceDelta === option.priceDelta) return; // nothing actually changed, skip the write
    await modifierOptionRepository.update(option.id, { priceDelta });
  }

  function openRestrictDialog(option: ModifierOption) {
    setRestrictOption(option);
    setRestrictEnabled(Boolean(option.restrictToProductIds && option.restrictToProductIds.length > 0));
    setRestrictDraft(option.restrictToProductIds ?? []);
  }

  function toggleRestrictProduct(productId: string) {
    setRestrictDraft((prev) =>
      prev.includes(productId) ? prev.filter((id) => id !== productId) : [...prev, productId]
    );
  }

  async function saveRestrictDialog() {
    if (!restrictOption) return;
    await modifierOptionRepository.update(restrictOption.id, {
      restrictToProductIds: restrictEnabled ? restrictDraft : null,
    });
    setRestrictOption(null);
  }

  async function deleteOption(option: ModifierOption) {
    if (!confirm(`ลบตัวเลือก "${option.name}" ใช่หรือไม่? ลบแล้วกู้คืนไม่ได้`)) return;
    await modifierOptionRepository.remove(option.id);
  }

  async function moveOption(index: number, direction: "up" | "down") {
    const swap = computeSwap(options, index, direction);
    if (!swap) return;
    await Promise.all(
      swap.map((s) => modifierOptionRepository.update(s.id, { sortOrder: s.sortOrder }))
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card">
      <div className="flex items-center gap-3 p-4">
        <SortButtons disabledUp={disabledUp} disabledDown={disabledDown} onUp={() => onMove("up")} onDown={() => onMove("down")} />

        <button
          className="flex flex-1 items-center gap-3 text-left"
          onClick={() => setExpanded((e) => !e)}
        >
          <span className="font-medium">{group.name}</span>
          <Badge variant="muted">{group.required ? "บังคับ" : "ไม่บังคับ"}</Badge>
          <Badge variant="muted">
            {group.selectionType === "single"
              ? "เลือก 1"
              : group.maxSelect
                ? `เลือกได้สูงสุด ${group.maxSelect}`
                : "เลือกได้หลายอัน"}
          </Badge>
          {group.pricingMode === "tieredByCount" ? (
            <Badge variant="muted">
              ราคาตามจำนวน
              {group.tierPricing && group.tierPricing.length > 0
                ? `: ${group.tierPricing
                    .slice()
                    .sort((a, b) => a.count - b.count)
                    .map((t) => `${t.count}=${t.price}`)
                    .join(" / ")}`
                : ""}
            </Badge>
          ) : null}
          <Badge variant={group.active ? "success" : "muted"}>
            {group.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
          </Badge>
        </button>

        <Switch checked={group.active} onCheckedChange={onToggleActive} />
        <Button variant="outline" size="sm" onClick={onEdit}>
          แก้ไข
        </Button>
        <Button variant="destructive" size="sm" onClick={onDelete}>
          ลบ
        </Button>
        <Button variant="ghost" size="sm" onClick={() => setExpanded((e) => !e)}>
          {expanded ? "ย่อ" : "ตัวเลือก"}
        </Button>
      </div>

      {expanded ? (
        <div className="border-t border-border p-4">
          <div className="grid gap-2">
            {options.map((option, index) => (
              <div key={option.id} className="flex items-center gap-3 rounded-md border border-border px-3 py-2">
                <SortButtons
                  disabledUp={index === 0}
                  disabledDown={index === options.length - 1}
                  onUp={() => moveOption(index, "up")}
                  onDown={() => moveOption(index, "down")}
                />
                <span className="flex-1 text-sm">{option.name}</span>
                {group.pricingMode !== "tieredByCount" ? (
                  editingPriceId === option.id ? (
                    <Input
                      type="number"
                      autoFocus
                      className="h-8 w-24"
                      value={priceDraft}
                      onChange={(e) => setPriceDraft(e.target.value)}
                      onBlur={() => commitPriceEdit(option)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") e.currentTarget.blur(); // blur triggers the commit above
                        if (e.key === "Escape") setEditingPriceId(null); // discard, no write
                      }}
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => startEditingPrice(option)}
                      className="rounded-md px-2 py-1 text-sm text-muted-foreground underline decoration-dotted hover:bg-accent"
                      title="กดเพื่อแก้ไขราคา"
                    >
                      {option.priceDelta > 0 ? `+${option.priceDelta}` : option.priceDelta} บาท
                    </button>
                  )
                ) : null}
                {eligibleProducts.length > 1 ? (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => openRestrictDialog(option)}
                    title="เลือกว่าตัวเลือกนี้ใช้ได้กับเมนูไหนบ้าง"
                  >
                    {option.restrictToProductIds && option.restrictToProductIds.length > 0
                      ? `เฉพาะ ${option.restrictToProductIds.length} เมนู`
                      : "ทุกเมนู"}
                  </Button>
                ) : null}
                <Switch checked={option.active} onCheckedChange={() => toggleOptionActive(option)} />
                <Button variant="destructive" size="sm" onClick={() => deleteOption(option)}>
                  ลบ
                </Button>
              </div>
            ))}
            {options.length === 0 ? (
              <p className="text-sm text-muted-foreground">ยังไม่มีตัวเลือก</p>
            ) : null}
          </div>

          <div className="mt-3 flex items-end gap-2">
            <div className="grid flex-1 gap-1">
              <span className="text-xs text-muted-foreground">ชื่อตัวเลือกใหม่</span>
              <Input
                value={addingName}
                onChange={(e) => setAddingName(e.target.value)}
                placeholder="เช่น ไม่งอก"
              />
            </div>
            {group.pricingMode !== "tieredByCount" ? (
              <div className="grid w-28 gap-1">
                <span className="text-xs text-muted-foreground">ราคาเพิ่ม</span>
                <Input
                  type="number"
                  value={addingPrice}
                  onChange={(e) => setAddingPrice(e.target.value)}
                />
              </div>
            ) : (
              <p className="pb-2 text-xs text-muted-foreground">
                กลุ่มนี้คิดราคาตามจำนวนที่เลือก — ตัวเลือกใหม่ไม่มีราคาต่อชิ้น (แก้ไขราคาตามจำนวนได้ที่ปุ่ม &quot;แก้ไข&quot;)
              </p>
            )}
            <Button size="sm" onClick={addOption} disabled={saving || !addingName.trim()}>
              + เพิ่ม
            </Button>
          </div>
        </div>
      ) : null}

      <Dialog open={restrictOption !== null} onOpenChange={(open) => !open && setRestrictOption(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เมนูที่ใช้ตัวเลือก &quot;{restrictOption?.name}&quot;</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="flex items-center justify-between rounded-lg border border-border p-3">
              <div>
                <p className="font-medium">จำกัดเฉพาะบางเมนู</p>
                <p className="text-xs text-muted-foreground">
                  ปิด = ใช้กับทุกเมนูที่มีกลุ่ม &quot;{group.name}&quot; (ค่าเริ่มต้น)
                </p>
              </div>
              <Switch checked={restrictEnabled} onCheckedChange={setRestrictEnabled} />
            </div>
            {restrictEnabled ? (
              <div className="grid gap-2 rounded-lg border border-border p-3">
                {eligibleProducts.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={restrictDraft.includes(p.id)}
                      onCheckedChange={() => toggleRestrictProduct(p.id)}
                    />
                    {p.name}
                  </label>
                ))}
                {restrictDraft.length === 0 ? (
                  <p className="text-xs text-destructive">
                    ยังไม่ได้เลือกเมนู — ตัวเลือกนี้จะไม่ขึ้นในเมนูไหนเลยจนกว่าจะเลือกอย่างน้อย 1 เมนู
                  </p>
                ) : null}
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestrictOption(null)}>
              ยกเลิก
            </Button>
            <Button onClick={saveRestrictDialog}>บันทึก</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
