"use client";

import { useEffect, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { SortButtons } from "@/components/admin/SortButtons";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeSwap } from "@/lib/admin/sortOrder";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { tableRepository } from "@/repositories/tableRepository";
import type { Table as PosTable } from "@/types";

/**
 * Table CRUD (item 13). Unlike Categories/Products, item 13 explicitly asks for real delete
 * ("เพิ่มโต๊ะ / ลบโต๊ะ") alongside "ปิดโต๊ะชั่วคราว" (temporary close) as a *separate* concept —
 * so this page has both a delete button and an active/inactive switch. Count/names are never
 * hardcoded (item 34) — this page is the only place table data comes from.
 */
export default function TablesPage() {
  const [items, setItems] = useState<PosTable[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PosTable | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => tableRepository.subscribeForShop(DEFAULT_SHOP_ID, setItems), []);

  function openCreate() {
    setEditing(null);
    setName("");
    setDialogOpen(true);
  }

  function openEdit(table: PosTable) {
    setEditing(table);
    setName(table.name);
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      if (editing) {
        await tableRepository.update(editing.id, { name: trimmed });
      } else {
        await tableRepository.create({
          shopId: DEFAULT_SHOP_ID,
          name: trimmed,
          sortOrder: items.length,
          active: true,
          createdAt: Date.now(),
        });
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(table: PosTable) {
    await tableRepository.update(table.id, { active: !table.active });
  }

  async function handleDelete(table: PosTable) {
    if (!confirm(`ลบโต๊ะ "${table.name}" ใช่หรือไม่?`)) return;
    await tableRepository.remove(table.id);
  }

  async function move(index: number, direction: "up" | "down") {
    const swap = computeSwap(items, index, direction);
    if (!swap) return;
    await Promise.all(swap.map((s) => tableRepository.update(s.id, { sortOrder: s.sortOrder })));
  }

  return (
    <AdminSection
      title="โต๊ะ"
      description="จำนวนและชื่อโต๊ะแก้ได้ตลอด ไม่ผูกกับโค้ด — ปัจจุบันมีเท่าไรก็ได้"
      actionLabel="+ เพิ่มโต๊ะ"
      onAction={openCreate}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>ชื่อโต๊ะ</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead className="text-right">จัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((table, index) => (
            <TableRow key={table.id}>
              <TableCell>
                <SortButtons
                  disabledUp={index === 0}
                  disabledDown={index === items.length - 1}
                  onUp={() => move(index, "up")}
                  onDown={() => move(index, "down")}
                />
              </TableCell>
              <TableCell className="font-medium">{table.name}</TableCell>
              <TableCell>
                <Badge variant={table.active ? "success" : "muted"}>
                  {table.active ? "เปิดใช้งาน" : "ปิดชั่วคราว"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Switch checked={table.active} onCheckedChange={() => toggleActive(table)} />
                  <Button variant="outline" size="sm" onClick={() => openEdit(table)}>
                    แก้ไข
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => handleDelete(table)}>
                    ลบ
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                ยังไม่มีโต๊ะ
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "แก้ไขโต๊ะ" : "เพิ่มโต๊ะ"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="table-name">ชื่อโต๊ะ</Label>
            <Input
              id="table-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น โต๊ะ 9"
              autoFocus
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleSave} disabled={saving || !name.trim()}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminSection>
  );
}
