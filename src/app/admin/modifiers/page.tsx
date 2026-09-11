"use client";

import { useEffect, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { Button } from "@/components/ui/button";
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
import { computeSwap } from "@/lib/admin/sortOrder";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { modifierGroupRepository, modifierOptionRepository } from "@/repositories/modifierRepository";
import { productRepository } from "@/repositories/productRepository";
import type { ModifierGroup, ModifierPricingMode, ModifierSelectionType, Product } from "@/types";
import { GroupCard } from "./GroupCard";

interface FormState {
  name: string;
  required: boolean;
  selectionType: ModifierSelectionType;
  /** Text field state for `ModifierGroup.maxSelect` — empty string means unlimited. Only read
   * when `selectionType === "multiple"`; kept as a string here purely for the `Input`'s value. */
  maxSelect: string;
  /** "perOption" (default, per-option `priceDelta` add-ons) or "tieredByCount" (total price
   * depends on how many options are picked, e.g. "เนื้อสัตว์": 2 อย่าง 50 / 3 อย่าง 60). Only
   * selectable when `selectionType === "multiple"` — a single-select group always picks exactly
   * one option, so "by count" pricing has nothing to vary. */
  pricingMode: ModifierPricingMode;
  /** Text field state for `ModifierTier.price`, index i = the price for selecting `i + 1`
   * options. Length is kept in sync with `maxSelect` whenever it changes — `"tieredByCount"`
   * pricing requires a known upper bound (unlike the free-form "no cap" `maxSelect` otherwise
   * allows), enforced on save below. */
  tierPrices: string[];
}

const EMPTY_FORM: FormState = {
  name: "",
  required: false,
  selectionType: "single",
  maxSelect: "",
  pricingMode: "perOption",
  tierPrices: [],
};

/** Keeps `tierPrices`'s length equal to `maxSelect` when the cap changes — pads new tiers with
 * "" (unset) rather than guessing a price, trims extra tiers off the end. */
function resizeTierPrices(tierPrices: string[], maxSelect: number): string[] {
  const next = tierPrices.slice(0, maxSelect);
  while (next.length < maxSelect) next.push("");
  return next;
}

/**
 * Modifier Group + Option management (item 12). Groups here; each `GroupCard` expands to manage
 * its Options inline — matches item 12's example of Group "เส้น" (required/single) and Group
 * "เพิ่มเติม" (optional/multi, priced options).
 */
export default function ModifiersPage() {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ModifierGroup | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => modifierGroupRepository.subscribeForShop(DEFAULT_SHOP_ID, setGroups), []);
  useEffect(() => productRepository.subscribeForShop(DEFAULT_SHOP_ID, setProducts), []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(group: ModifierGroup) {
    setEditing(group);
    setForm({
      name: group.name,
      required: group.required,
      selectionType: group.selectionType,
      maxSelect: group.maxSelect ? String(group.maxSelect) : "",
      pricingMode: group.pricingMode ?? "perOption",
      tierPrices: group.maxSelect
        ? resizeTierPrices(
            (group.tierPricing ?? []).map((t) => String(t.price)),
            group.maxSelect
          )
        : [],
    });
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) return;
    // Meaningless for "single" (already capped at 1) — never persisted there even if a stray
    // value is sitting in the form from before the selection type was switched.
    const parsedMaxSelect = Number(form.maxSelect.trim());
    const maxSelect =
      form.selectionType === "multiple" && form.maxSelect.trim() && Number.isInteger(parsedMaxSelect) && parsedMaxSelect > 0
        ? parsedMaxSelect
        : undefined;
    const tiered = form.selectionType === "multiple" && form.pricingMode === "tieredByCount";

    // Tiered pricing needs a known upper bound (unlike per-option pricing, where "no cap" is a
    // valid choice) and a price for every count from 1 up to that bound — an incomplete tier
    // list would silently price some selection counts at 0 via `resolveTieredGroupPrice`'s
    // fallback, which is exactly the kind of "menu says one thing, POS charges another" mistake
    // item 34 exists to prevent.
    if (tiered && !maxSelect) {
      alert('โหมด "ราคาตามจำนวนที่เลือก" ต้องกำหนด "จำกัดจำนวนที่เลือกได้" ก่อน');
      return;
    }
    let tierPricing: { count: number; price: number }[] | undefined;
    if (tiered && maxSelect) {
      const prices = resizeTierPrices(form.tierPrices, maxSelect).map((p) => Number(p.trim()));
      if (prices.some((p) => !Number.isFinite(p) || p < 0)) {
        alert(`กรุณากรอกราคาให้ครบทุกจำนวน (1–${maxSelect} อย่าง)`);
        return;
      }
      tierPricing = prices.map((price, i) => ({ count: i + 1, price }));
    }

    setSaving(true);
    try {
      if (editing) {
        await modifierGroupRepository.update(editing.id, {
          name,
          required: form.required,
          selectionType: form.selectionType,
          maxSelect: maxSelect ?? null,
          pricingMode: tiered ? "tieredByCount" : "perOption",
          tierPricing: tierPricing ?? null,
        });
      } else {
        // The Firestore client SDK throws on a field explicitly set to `undefined` (unlike a key
        // that's simply absent), so `maxSelect`/`pricingMode`/`tierPricing` are only spread in
        // here when they actually have a value — never passed through as a literal `undefined`.
        await modifierGroupRepository.create({
          shopId: DEFAULT_SHOP_ID,
          name,
          required: form.required,
          selectionType: form.selectionType,
          ...(maxSelect !== undefined ? { maxSelect } : {}),
          ...(tiered ? { pricingMode: "tieredByCount" as const, tierPricing } : {}),
          active: true,
          sortOrder: groups.length,
          createdAt: Date.now(),
        });
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(group: ModifierGroup) {
    await modifierGroupRepository.update(group.id, { active: !group.active });
  }

  async function move(index: number, direction: "up" | "down") {
    const swap = computeSwap(groups, index, direction);
    if (!swap) return;
    await Promise.all(
      swap.map((s) => modifierGroupRepository.update(s.id, { sortOrder: s.sortOrder }))
    );
  }

  async function handleDelete(group: ModifierGroup) {
    const productCount = products.filter((p) => p.modifierGroupIds.includes(group.id)).length;
    if (productCount > 0) {
      alert(`ลบไม่ได้ — ยังมีเมนู ${productCount} รายการใช้กลุ่มนี้อยู่ เอาออกจากเมนูเหล่านั้นก่อน`);
      return;
    }
    if (!confirm(`ลบกลุ่ม Modifier "${group.name}" ใช่หรือไม่? ลบแล้วกู้คืนไม่ได้ (ตัวเลือกในกลุ่มจะถูกลบไปด้วย)`)) return;
    // Cascade: an option with no parent group left is unreachable dead data (nothing lists
    // options outside their group's own subscription), never useful to leave behind.
    const orphanedOptions = await modifierOptionRepository.listForGroup(group.id);
    await Promise.all(orphanedOptions.map((o) => modifierOptionRepository.remove(o.id)));
    await modifierGroupRepository.remove(group.id);
  }

  return (
    <AdminSection
      title="Modifier"
      description="เช่น กลุ่ม “เส้น” (บังคับ เลือก 1) หรือกลุ่ม “เพิ่มเติม” (ไม่บังคับ เลือกได้หลายอัน มีราคาเพิ่ม)"
      actionLabel="+ เพิ่มกลุ่ม Modifier"
      onAction={openCreate}
    >
      <div className="grid gap-3">
        {groups.map((group, index) => (
          <GroupCard
            key={group.id}
            group={group}
            products={products}
            onEdit={() => openEdit(group)}
            onToggleActive={() => toggleActive(group)}
            onDelete={() => handleDelete(group)}
            onMove={(direction) => move(index, direction)}
            disabledUp={index === 0}
            disabledDown={index === groups.length - 1}
          />
        ))}
        {groups.length === 0 ? (
          <p className="text-center text-muted-foreground">ยังไม่มีกลุ่ม Modifier</p>
        ) : null}
      </div>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "แก้ไขกลุ่ม Modifier" : "เพิ่มกลุ่ม Modifier"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="group-name">ชื่อกลุ่ม</Label>
              <Input
                id="group-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="เช่น เส้น"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label>เลือกได้กี่ตัวเลือก</Label>
              <Select
                value={form.selectionType}
                onValueChange={(v) => setForm((f) => ({ ...f, selectionType: v as ModifierSelectionType }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="single">เลือกได้ 1 ตัวเลือก</SelectItem>
                  <SelectItem value="multiple">เลือกได้หลายตัวเลือก</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.selectionType === "multiple" ? (
              <div className="grid gap-2">
                <Label htmlFor="group-max-select">
                  จำกัดจำนวนที่เลือกได้ {form.pricingMode === "tieredByCount" ? "" : "(ไม่บังคับ)"}
                </Label>
                <Input
                  id="group-max-select"
                  type="number"
                  min={1}
                  step={1}
                  value={form.maxSelect}
                  onChange={(e) => {
                    const value = e.target.value;
                    setForm((f) => {
                      const n = Number(value.trim());
                      return {
                        ...f,
                        maxSelect: value,
                        tierPrices: Number.isInteger(n) && n > 0 ? resizeTierPrices(f.tierPrices, n) : f.tierPrices,
                      };
                    });
                  }}
                  placeholder="ไม่จำกัด"
                />
              </div>
            ) : null}

            {form.selectionType === "multiple" ? (
              <div className="grid gap-2">
                <Label>รูปแบบราคา</Label>
                <Select
                  value={form.pricingMode}
                  onValueChange={(v) => setForm((f) => ({ ...f, pricingMode: v as ModifierPricingMode }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="perOption">บวกราคาต่อตัวเลือก (ค่าเริ่มต้น)</SelectItem>
                    <SelectItem value="tieredByCount">ราคาตามจำนวนที่เลือก (เช่น 2 อย่าง 50, 3 อย่าง 60)</SelectItem>
                  </SelectContent>
                </Select>
                {form.pricingMode === "tieredByCount" ? (
                  <p className="text-xs text-muted-foreground">
                    ราคาต่อตัวเลือกของแต่ละตัวเลือกในกลุ่มนี้จะไม่ถูกใช้ — คิดราคารวมตามจำนวนที่เลือกแทน
                  </p>
                ) : null}
              </div>
            ) : null}

            {form.selectionType === "multiple" && form.pricingMode === "tieredByCount" ? (
              <div className="grid gap-2">
                <Label>ตั้งราคาตามจำนวนที่เลือก</Label>
                {form.tierPrices.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    กรอก &quot;จำกัดจำนวนที่เลือกได้&quot; ด้านบนก่อน เพื่อตั้งราคาแต่ละจำนวน
                  </p>
                ) : (
                  <div className="grid gap-2">
                    {form.tierPrices.map((price, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <span className="w-20 shrink-0 text-sm text-muted-foreground">เลือก {i + 1} อย่าง</span>
                        <Input
                          type="number"
                          min={0}
                          step={1}
                          value={price}
                          onChange={(e) =>
                            setForm((f) => ({
                              ...f,
                              tierPrices: f.tierPrices.map((p, idx) => (idx === i ? e.target.value : p)),
                            }))
                          }
                          placeholder="0"
                        />
                        <span className="text-sm text-muted-foreground">บาท</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : null}

            <div className="grid gap-2">
              <Label>บังคับเลือกหรือไม่</Label>
              <Select
                value={form.required ? "required" : "optional"}
                onValueChange={(v) => setForm((f) => ({ ...f, required: v === "required" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="required">บังคับเลือก</SelectItem>
                  <SelectItem value="optional">ไม่บังคับ</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSave} disabled={saving || !form.name.trim()}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminSection>
  );
}
