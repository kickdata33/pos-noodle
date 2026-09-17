"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ModifierGroup, ModifierOption, ProductQuickPreset } from "@/types";

/**
 * Editor for one product's `posQuickPresets` (see that field's doc comment) — lives inside the
 * product edit dialog in `page.tsx`, right below the modifier-group checkboxes, since a preset
 * only makes sense once at least one group is attached. Only offers groups/options currently on
 * this product (via `groups`/`optionsFor`), mirroring `ModifierPickerDialog`'s own
 * single-vs-multiple/maxSelect/required rules so a preset can never represent a selection the
 * real picker couldn't also produce.
 */
export function QuickPresetEditor({
  groups,
  modifierOptions,
  productId,
  presets,
  onChange,
}: {
  groups: ModifierGroup[];
  modifierOptions: ModifierOption[];
  productId: string;
  presets: ProductQuickPreset[];
  onChange: (presets: ProductQuickPreset[]) => void;
}) {
  function optionsFor(groupId: string): ModifierOption[] {
    return modifierOptions.filter(
      (o) => o.groupId === groupId && o.active && (!o.restrictToProductIds || o.restrictToProductIds.includes(productId))
    );
  }

  function addPreset() {
    onChange([...presets, { id: crypto.randomUUID(), label: "", selections: {} }]);
  }

  function removePreset(id: string) {
    onChange(presets.filter((p) => p.id !== id));
  }

  function updatePreset(id: string, patch: Partial<ProductQuickPreset>) {
    onChange(presets.map((p) => (p.id === id ? { ...p, ...patch } : p)));
  }

  function toggleOption(preset: ProductQuickPreset, group: ModifierGroup, optionId: string) {
    const current = preset.selections[group.id] ?? [];
    let next: string[];
    if (group.selectionType === "single") {
      // Same rule as the real picker: an optional single-select can be cleared by re-tapping;
      // a required one always keeps exactly one selected once anything's been picked.
      next = current.includes(optionId) && !group.required ? [] : [optionId];
    } else {
      if (!current.includes(optionId) && group.maxSelect && current.length >= group.maxSelect) return;
      next = current.includes(optionId) ? current.filter((id) => id !== optionId) : [...current, optionId];
    }
    updatePreset(preset.id, { selections: { ...preset.selections, [group.id]: next } });
  }

  return (
    <div className="grid gap-3">
      {presets.map((preset) => {
        const missingRequired = groups.some((g) => g.required && (preset.selections[g.id] ?? []).length === 0);
        return (
          <div key={preset.id} className="grid gap-3 rounded-lg border border-border p-3">
            <div className="flex items-center gap-2">
              <Input
                value={preset.label}
                onChange={(e) => updatePreset(preset.id, { label: e.target.value })}
                placeholder='เช่น "ก๋วยเตี๋ยวพิเศษ"'
                className="flex-1"
              />
              <Button type="button" variant="destructive" size="sm" onClick={() => removePreset(preset.id)}>
                ลบปุ่มนี้
              </Button>
            </div>

            {groups.map((group) => {
              const groupSelections = preset.selections[group.id] ?? [];
              const atCap = Boolean(group.maxSelect) && groupSelections.length >= group.maxSelect!;
              return (
                <div key={group.id} className="grid gap-1">
                  <p className="text-xs font-medium text-muted-foreground">
                    {group.name}
                    {group.required ? <span className="text-destructive"> *จำเป็น</span> : null}
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {optionsFor(group.id).map((option) => {
                      const selected = groupSelections.includes(option.id);
                      const disabled = atCap && !selected;
                      return (
                        <button
                          key={option.id}
                          type="button"
                          disabled={disabled}
                          onClick={() => toggleOption(preset, group, option.id)}
                          className={
                            "rounded-full border px-3 py-1 text-xs " +
                            (disabled
                              ? "cursor-not-allowed border-border bg-muted/40 opacity-60"
                              : selected
                                ? "border-primary bg-primary/10 font-medium"
                                : "border-border bg-card hover:bg-accent")
                          }
                        >
                          {option.name}
                        </button>
                      );
                    })}
                    {optionsFor(group.id).length === 0 ? (
                      <span className="text-xs text-muted-foreground">ยังไม่มีตัวเลือกในกลุ่มนี้</span>
                    ) : null}
                  </div>
                </div>
              );
            })}

            {missingRequired ? (
              <p className="text-xs text-destructive">
                ยังไม่ได้เลือกให้ครบทุกกลุ่มที่ *จำเป็น — ปุ่มนี้จะไม่ถูกบันทึกจนกว่าจะเลือกครบ
              </p>
            ) : null}
          </div>
        );
      })}

      <Button type="button" variant="outline" size="sm" onClick={addPreset} className="justify-self-start">
        + เพิ่มปุ่มลัด
      </Button>
    </div>
  );
}
