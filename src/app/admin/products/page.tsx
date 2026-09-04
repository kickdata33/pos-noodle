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
import { channelRepository } from "@/repositories/channelRepository";
import { modifierGroupRepository } from "@/repositories/modifierRepository";
import { productRepository } from "@/repositories/productRepository";
import type { Category, ModifierGroup, Product, SalesChannel } from "@/types";

interface FormState {
  name: string;
  categoryId: string;
  price: string;
  modifierGroupIds: string[];
  /** One string per channel id — blank means "no override, use the channel's automatic markup
   * (or plain price)". Kept as strings in form state the same way `price` is, converted to
   * numbers only on save. */
  channelPrices: Record<string, string>;
}

const EMPTY_FORM: FormState = { name: "", categoryId: "", price: "", modifierGroupIds: [], channelPrices: {} };

/**
 * Product CRUD (item 11). Admin picks a category and any modifier groups this dish offers
 * (item 12's linkage — `Product.modifierGroupIds`). `channelPrices` (item 23, turned on per the
 * shop's request) lets a specific menu item get an exact price on a specific channel — it always
 * wins over that channel's automatic `markupPercent` (set on the "ช่องทางขาย" page), see
 * `resolveChannelPrice`'s comment for the full resolution order.
 *
 * Real delete is safe here (unlike Categories, see that page's comment): `OrderItem` snapshots
 * `productName`/`unitPrice`/etc at add-time, so a past order never actually reads a live
 * `Product` doc again — deleting one only removes it from future ordering, exactly like the
 * shop asked for ("ทำให้สามารถลบรายการได้ด้วย").
 */
export default function ProductsPage() {
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  useEffect(() => productRepository.subscribeForShop(DEFAULT_SHOP_ID, setItems), []);
  useEffect(() => categoryRepository.subscribeForShop(DEFAULT_SHOP_ID, setCategories), []);
  useEffect(() => modifierGroupRepository.subscribeForShop(DEFAULT_SHOP_ID, setGroups), []);
  useEffect(() => channelRepository.subscribeForShop(DEFAULT_SHOP_ID, setChannels), []);

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
      channelPrices: Object.fromEntries(
        Object.entries(product.channelPrices ?? {}).map(([channelId, p]) => [channelId, String(p)])
      ),
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

  function setChannelPriceInput(channelId: string, value: string) {
    setForm((f) => ({ ...f, channelPrices: { ...f.channelPrices, [channelId]: value } }));
  }

  async function handleSave() {
    const name = form.name.trim();
    const price = Number(form.price);
    if (!name || !form.categoryId || !Number.isFinite(price) || price < 0) return;

    // Blank input = no override for that channel; anything else must parse as a non-negative
    // number or the whole save is rejected (never silently drop a typo'd override).
    const channelPrices: Record<string, number> = {};
    for (const [channelId, raw] of Object.entries(form.channelPrices)) {
      if (raw.trim() === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return;
      channelPrices[channelId] = value;
    }

    setSaving(true);
    try {
      if (editing) {
        await productRepository.update(editing.id, {
          name,
          categoryId: form.categoryId,
          price,
          modifierGroupIds: form.modifierGroupIds,
          channelPrices,
          updatedAt: Date.now(),
        });
      } else {
        await productRepository.create({
          shopId: DEFAULT_SHOP_ID,
          name,
          categoryId: form.categoryId,
          price,
          modifierGroupIds: form.modifierGroupIds,
          channelPrices,
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

  async function handleDelete(product: Product) {
    if (!confirm(`ลบเมนู "${product.name}" ใช่หรือไม่? ลบแล้วกู้คืนไม่ได้`)) return;
    await productRepository.remove(product.id);
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
                  <Button variant="destructive" size="sm" onClick={() => handleDelete(product)}>
                    ลบ
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

            {channels.length > 0 ? (
              <div className="grid gap-2">
                <Label>ราคาเฉพาะช่องทาง (ไม่บังคับ)</Label>
                <p className="text-xs text-muted-foreground">
                  เว้นว่าง = ใช้ราคาปกติบวก % อัตโนมัติของช่องทางนั้น (ตั้งที่หน้า &quot;ช่องทางขาย&quot;)
                  — ใส่ตัวเลขถ้าอยากกำหนดราคาของเมนูนี้เองสำหรับช่องทางนั้นโดยเฉพาะ
                </p>
                <div className="grid gap-2 rounded-lg border border-border p-3">
                  {channels.map((channel) => (
                    <div key={channel.id} className="flex items-center gap-2">
                      <span className="w-28 shrink-0 truncate text-sm">{channel.name}</span>
                      <Input
                        type="number"
                        inputMode="decimal"
                        min={0}
                        value={form.channelPrices[channel.id] ?? ""}
                        onChange={(e) => setChannelPriceInput(channel.id, e.target.value)}
                        placeholder={channel.markupPercent ? `อัตโนมัติ (+${channel.markupPercent}%)` : "ราคาปกติ"}
                      />
                    </div>
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
