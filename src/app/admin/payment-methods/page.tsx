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
import { paymentMethodRepository } from "@/repositories/paymentMethodRepository";
import type { PaymentMethod } from "@/types";

/** Payment Method CRUD (item 15) — เงินสด / QR / Delivery / อื่น ๆ, admin-editable, DB-backed. */
export default function PaymentMethodsPage() {
  const [items, setItems] = useState<PaymentMethod[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PaymentMethod | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => paymentMethodRepository.subscribeForShop(DEFAULT_SHOP_ID, setItems), []);

  function openCreate() {
    setEditing(null);
    setName("");
    setDialogOpen(true);
  }

  function openEdit(method: PaymentMethod) {
    setEditing(method);
    setName(method.name);
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      if (editing) {
        await paymentMethodRepository.update(editing.id, { name: trimmed });
      } else {
        await paymentMethodRepository.create({
          shopId: DEFAULT_SHOP_ID,
          name: trimmed,
          code: null,
          active: true,
          sortOrder: items.length,
          createdAt: Date.now(),
        });
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(method: PaymentMethod) {
    await paymentMethodRepository.update(method.id, { active: !method.active });
  }

  async function move(index: number, direction: "up" | "down") {
    const swap = computeSwap(items, index, direction);
    if (!swap) return;
    await Promise.all(
      swap.map((s) => paymentMethodRepository.update(s.id, { sortOrder: s.sortOrder }))
    );
  }

  return (
    <AdminSection
      title="วิธีชำระเงิน"
      description="เช่น เงินสด, QR, Delivery"
      actionLabel="+ เพิ่มวิธีชำระเงิน"
      onAction={openCreate}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>ชื่อ</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead className="text-right">จัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((method, index) => (
            <TableRow key={method.id}>
              <TableCell>
                <SortButtons
                  disabledUp={index === 0}
                  disabledDown={index === items.length - 1}
                  onUp={() => move(index, "up")}
                  onDown={() => move(index, "down")}
                />
              </TableCell>
              <TableCell className="font-medium">
                {method.name}
                {method.code ? (
                  <Badge variant="muted" className="ml-2 text-[10px]">
                    {method.code}
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge variant={method.active ? "success" : "muted"}>
                  {method.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Switch checked={method.active} onCheckedChange={() => toggleActive(method)} />
                  <Button variant="outline" size="sm" onClick={() => openEdit(method)}>
                    แก้ไข
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                ยังไม่มีวิธีชำระเงิน
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "แก้ไขวิธีชำระเงิน" : "เพิ่มวิธีชำระเงิน"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="pm-name">ชื่อ</Label>
            <Input
              id="pm-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น บัตรเครดิต"
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
