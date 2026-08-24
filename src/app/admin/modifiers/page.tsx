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
import { modifierGroupRepository } from "@/repositories/modifierRepository";
import type { ModifierGroup, ModifierSelectionType } from "@/types";
import { GroupCard } from "./GroupCard";

interface FormState {
  name: string;
  required: boolean;
  selectionType: ModifierSelectionType;
}

const EMPTY_FORM: FormState = { name: "", required: false, selectionType: "single" };

/**
 * Modifier Group + Option management (item 12). Groups here; each `GroupCard` expands to manage
 * its Options inline — matches item 12's example of Group "เส้น" (required/single) and Group
 * "เพิ่มเติม" (optional/multi, priced options).
 */
export default function ModifiersPage() {
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ModifierGroup | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => modifierGroupRepository.subscribeForShop(DEFAULT_SHOP_ID, setGroups), []);

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(group: ModifierGroup) {
    setEditing(group);
    setForm({ name: group.name, required: group.required, selectionType: group.selectionType });
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    if (!name) return;
    setSaving(true);
    try {
      if (editing) {
        await modifierGroupRepository.update(editing.id, {
          name,
          required: form.required,
          selectionType: form.selectionType,
        });
      } else {
        await modifierGroupRepository.create({
          shopId: DEFAULT_SHOP_ID,
          name,
          required: form.required,
          selectionType: form.selectionType,
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
            onEdit={() => openEdit(group)}
            onToggleActive={() => toggleActive(group)}
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
