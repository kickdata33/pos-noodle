"use client";

import { useEffect, useState } from "react";

import { SortButtons } from "@/components/admin/SortButtons";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { computeSwap } from "@/lib/admin/sortOrder";
import { modifierOptionRepository } from "@/repositories/modifierRepository";
import type { ModifierGroup, ModifierOption } from "@/types";

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
  onEdit,
  onToggleActive,
  onDelete,
  onMove,
  disabledUp,
  disabledDown,
}: {
  group: ModifierGroup;
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
          <Badge variant="muted">{group.selectionType === "single" ? "เลือก 1" : "เลือกได้หลายอัน"}</Badge>
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
                <span className="text-sm text-muted-foreground">
                  {option.priceDelta > 0 ? `+${option.priceDelta}` : option.priceDelta} บาท
                </span>
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
            <div className="grid w-28 gap-1">
              <span className="text-xs text-muted-foreground">ราคาเพิ่ม</span>
              <Input
                type="number"
                value={addingPrice}
                onChange={(e) => setAddingPrice(e.target.value)}
              />
            </div>
            <Button size="sm" onClick={addOption} disabled={saving || !addingName.trim()}>
              + เพิ่ม
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
