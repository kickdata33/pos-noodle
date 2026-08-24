"use client";

import { useEffect, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
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
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeSwap } from "@/lib/admin/sortOrder";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { categoryRepository } from "@/repositories/categoryRepository";
import { modifierGroupRepository } from "@/repositories/modifierRepository";
import { productRepository } from "@/repositories/productRepository";
import type { Category, ModifierGroup, Product } from "@/types";

interface FormState {
  name: string;
  categoryId: string;
  price: string;
  modifierGroupIds: string[];
}

const EMPTY_FORM: FormState = { name: "", categoryId: "", price: "", modifierGroupIds: [] };

/**
 * Product CRUD (item 11). Admin picks a category and any modifier groups this dish offers
 * (item 12's linkage — `Product.modifierGroupIds`). `channelPrices` (item 23) already exists on
 * the type from Milestone 1 but is intentionally not exposed here — the spec defers turning on
 * per-channel pricing past v1, it only asks that the schema be ready for it.
 */
export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => productRepository.subscribeForShop(DEFAULT_SHOP_ID, setItems), []);
  useEffect(() => categoryRepository.subscribeForShop(DEFAULT_SHOP_ID, setCategories), []);
  useEffect(() => modifierGroupRepository.subscribeForShop(DEFAULT_SHOP_ID, setGroups), []);

  const categoryName = (id: string) => categories.find((c) => c.id === id)?.name ?? "—";

  function openCreate() {
    setEditing(null);
    setForm({ ...EMPTY_FORM, categoryId: categories[0]?.id ?? "" });
    setDialogOpen(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setForm({
      name: product.name,
      categoryId: product.categoryId,
      price: String(product.price),
      modifierGroupIds: product.modifierGroupIds,
    });
    setDialogOpen(true);
  }

  function toggleGroup(groupId: string) {
    setForm((f) => ({
      ...f,
      modifierGroupIds: f.modifierGroupIds.includes(groupId)
        ? f.modifierGroupIds.filter((id) => id !== groupId)
        : [...f.modifierGroupIds, groupId],
    }));
  }

  async function handleSave() {
    const name = form.name.trim();
    const price = Number(form.price);
    if (!name || !form.categoryId || !Number.isFinite(price) || price < 0) return;

    setSaving(true);
    try {
      if (editing) {
        await productRepository.update(editing.id, {
          name,
          categoryId: form.categoryId,
          price,
          modifierGroupIds: form.modifierGroupIds,
          updatedAt: Date.now(),
        });
      } else {
        await productRepository.create({
          shopId: DEFAULT_SHOP_ID,
          name,
          categoryId: form.categoryId,
          price,
          modifierGroupIds: form.modifierGroupIds,
          active: true,
          sortOrder: items.length,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(product: Product) {
    // Event handler only (invoked from Switch's onCheckedChange below), never during render —
    // the purity rule can't trace that through the inline arrow wrapper, so it's a false positive.
    // eslint-disable-next-line react-hooks/purity
    const updatedAt = Date.now();
    await productRepository.update(product.id, { active: !product.active, updatedAt });
  }

  async function move(index: number, direction: "up" | "down") {
    const swap = computeSwap(items, index, direction);
    if (!swap) return;
    await Promise.all(swap.map((s) => productRepository.update(s.id, { sortOrder: s.sortOrder })));
  }

  return (
    <AdminSection
      title="เมนู"
      description="เพิ่ม/แก้ชื่อ/แก้ราคา/เปิดปิดเมนู/เปลี่ยนหมวดหมู่"
      actionLabel="+ เพิ่มเมนู"
      onAction={openCreate}
    >
      {categories.length === 0 ? (
        <p className="mb-4 text-sm text-muted-foreground">
          ยังไม่มีหมวดหมู่ — ไปสร้างที่หน้า &quot;หมวดหมู่&quot; ก่อน
        </p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>ชื่อเมนู</TableHead>
            <TableHead>หมวดหมู่</TableHead>
            <TableHead>ราคา</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead className="text-right">จัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((product, index) => (
            <TableRow key={product.id}>
              <TableCell>
                <SortButtons
                  disabledUp={index === 0}
                  disabledDown={index === items.length - 1}
                  onUp={() => move(index, "up")}
                  onDown={() => move(index, "down")}
                />
              </TableCell>
              <TableCell className="font-medium">{product.name}</TableCell>
              <TableCell className="text-muted-foreground">{categoryName(product.categoryId)}</TableCell>
              <TableCell>{product.price.toLocaleString("th-TH")} บาท</TableCell>
              <TableCell>
                <Badge variant={product.active ? "success" : "muted"}>
                  {product.active ? "เปิดขาย" : "ปิดขาย"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Switch checked={product.active} onCheckedChange={() => toggleActive(product)} />
                  <Button variant="outline" size="sm" onClick={() => openEdit(product)}>
                    แก้ไข
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={6} className="text-center text-muted-foreground">
                ยังไม่มีเมนู
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "แก้ไขเมนู" : "เพิ่มเมนู"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="product-name">ชื่อเมนู</Label>
              <Input
                id="product-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="เช่น ก๋วยเตี๋ยวลูกชิ้นน้ำตก"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label>หมวดหมู่</Label>
              <Select
                value={form.categoryId}
                onValueChange={(v) => setForm((f) => ({ ...f, categoryId: v }))}
              >
                <SelectTrigger>
                  <SelectValue placeholder="เลือกหมวดหมู่" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-2">
              <Label htmlFor="product-price">ราคา (บาท)</Label>
              <Input
                id="product-price"
                type="number"
                inputMode="decimal"
                min={0}
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                placeholder="0"
              />
            </div>

            {groups.length > 0 ? (
              <div className="grid gap-2">
                <Label>Modifier ที่ใช้กับเมนูนี้</Label>
                <div className="grid gap-2 rounded-lg border border-border p-3">
                  {groups.map((group) => (
                    <label key={group.id} className="flex items-center gap-2 text-sm">
                      <Checkbox
                        checked={form.modifierGroupIds.includes(group.id)}
                        onCheckedChange={() => toggleGroup(group.id)}
                      />
                      {group.name}
                      <span className="text-xs text-muted-foreground">
                        ({group.required ? "บังคับ" : "ไม่บังคับ"},{" "}
                        {group.selectionType === "single" ? "เลือก 1" : "เลือกได้หลายอัน"})
                      </span>
                    </label>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !form.name.trim() || !form.categoryId || form.price === ""}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminSection>
  );
}
