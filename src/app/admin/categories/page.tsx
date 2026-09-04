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
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { computeSwap } from "@/lib/admin/sortOrder";
import { categoryRepository } from "@/repositories/categoryRepository";
import { productRepository } from "@/repositories/productRepository";
import type { Category, Product } from "@/types";

/**
 * Category CRUD (item 11: "หมวดหมู่ ... สามารถสร้างเองได้ทั้งหมด"). Real delete is offered
 * (the shop asked for it — "ทำให้สามารถลบรายการได้ด้วย"), but only once no `Product` still
 * points at this category — deleting from under one would leave it with a dangling
 * `categoryId` and no tab to appear under on the POS/QR ordering screens (unlike Products,
 * where deleting is always safe: see that page's comment on `OrderItem` snapshotting).
 */
export default function CategoriesPage() {
  const [items, setItems] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => categoryRepository.subscribeForShop(DEFAULT_SHOP_ID, setItems), []);
  useEffect(() => productRepository.subscribeForShop(DEFAULT_SHOP_ID, setProducts), []);

  function openCreate() {
    setEditing(null);
    setName("");
    setDialogOpen(true);
  }

  function openEdit(category: Category) {
    setEditing(category);
    setName(category.name);
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed) return;
    setSaving(true);
    try {
      if (editing) {
        await categoryRepository.update(editing.id, { name: trimmed });
      } else {
        await categoryRepository.create({
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

  async function toggleActive(category: Category) {
    await categoryRepository.update(category.id, { active: !category.active });
  }

  async function move(index: number, direction: "up" | "down") {
    const swap = computeSwap(items, index, direction);
    if (!swap) return;
    await Promise.all(swap.map((s) => categoryRepository.update(s.id, { sortOrder: s.sortOrder })));
  }

  async function handleDelete(category: Category) {
    const productCount = products.filter((p) => p.categoryId === category.id).length;
    if (productCount > 0) {
      alert(`ลบไม่ได้ — ยังมีเมนู ${productCount} รายการอยู่ในหมวดหมู่นี้ ย้ายหรือลบเมนูเหล่านั้นก่อน`);
      return;
    }
    if (!confirm(`ลบหมวดหมู่ "${category.name}" ใช่หรือไม่? ลบแล้วกู้คืนไม่ได้`)) return;
    await categoryRepository.remove(category.id);
  }

  return (
    <AdminSection
      title="หมวดหมู่"
      description="เช่น ก๋วยเตี๋ยว, เกาเหลา, ลูกชิ้น, ของทานเล่น, เครื่องดื่ม"
      actionLabel="+ เพิ่มหมวดหมู่"
      onAction={openCreate}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>ชื่อหมวดหมู่</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead className="text-right">จัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((category, index) => (
            <TableRow key={category.id}>
              <TableCell>
                <SortButtons
                  disabledUp={index === 0}
                  disabledDown={index === items.length - 1}
                  onUp={() => move(index, "up")}
                  onDown={() => move(index, "down")}
                />
              </TableCell>
              <TableCell className="font-medium">{category.name}</TableCell>
              <TableCell>
                <Badge variant={category.active ? "success" : "muted"}>
                  {category.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Switch checked={category.active} onCheckedChange={() => toggleActive(category)} />
                  <Button variant="outline" size="sm" onClick={() => openEdit(category)}>
                    แก้ไข
                  </Button>
                  <Button variant="destructive" size="sm" onClick={() => handleDelete(category)}>
                    ลบ
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                ยังไม่มีหมวดหมู่
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "แก้ไขหมวดหมู่" : "เพิ่มหมวดหมู่"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="category-name">ชื่อหมวดหมู่</Label>
            <Input
              id="category-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="เช่น ก๋วยเตี๋ยว"
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
