"use client";

import { Fragment, useEffect, useState } from "react";

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
import { useAuth } from "@/hooks/useAuth";
import { computeSwap } from "@/lib/admin/sortOrder";
import { compressImageFile } from "@/lib/billing/compressImage";
import { dealWindowLabel, dealWindowsOverlap, parseClock } from "@/lib/pos/pricing";
import { categoryRepository } from "@/repositories/categoryRepository";
import { channelRepository } from "@/repositories/channelRepository";
import { modifierGroupRepository, modifierOptionRepository } from "@/repositories/modifierRepository";
import { productRepository } from "@/repositories/productRepository";
import type { BundleDeal, Category, ModifierGroup, ModifierOption, Product, ProductQuickPreset, SalesChannel } from "@/types";
import { QuickPresetEditor } from "./QuickPresetEditor";

/** One promotion row in the form — all text inputs; `fromTime`/`toTime` are "HH:MM" or "". */
interface DealRow {
  qty: string;
  price: string;
  fromTime: string;
  toTime: string;
}

interface FormState {
  name: string;
  categoryId: string;
  price: string;
  /** Text field state for `Product.imageUrl` — blank means no photo, same convention as
   * `ShopSettings.logoUrl`'s own form field. */
  imageUrl: string;
  /** `Product.menuNameBase` — blank means "don't build the line name from options". */
  menuNameBase: string;
  /** `Product.staffOnly` — hidden from customer QR menus. */
  staffOnly: boolean;
  /** `Product.bundleDeals` as text inputs; rows left fully blank are dropped on save. */
  deals: DealRow[];
  modifierGroupIds: string[];
  /** One string per channel id — blank means "no override, use the channel's automatic markup
   * (or plain price)". Kept as strings in form state the same way `price` is, converted to
   * numbers only on save. */
  channelPrices: Record<string, string>;
  /** See `Product.posQuickPresets`. */
  presets: ProductQuickPreset[];
}

const EMPTY_FORM: FormState = {
  name: "",
  categoryId: "",
  price: "",
  imageUrl: "",
  menuNameBase: "",
  staffOnly: false,
  deals: [],
  modifierGroupIds: [],
  channelPrices: {},
  presets: [],
};

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
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;
  const [items, setItems] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [groups, setGroups] = useState<ModifierGroup[]>([]);
  const [modifierOptions, setModifierOptions] = useState<ModifierOption[]>([]);
  const [channels, setChannels] = useState<SalesChannel[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [imageError, setImageError] = useState<string | null>(null);
  const [dealsError, setDealsError] = useState<string | null>(null);
  // Category chip above the list ("all" = every category, each as its own section).
  const [categoryFilter, setCategoryFilter] = useState<string>("all");

  useEffect(() => {
    if (!shopId) return;
    return productRepository.subscribeForShop(shopId, setItems);
  }, [shopId]);
  useEffect(() => {
    if (!shopId) return;
    return categoryRepository.subscribeForShop(shopId, setCategories);
  }, [shopId]);
  useEffect(() => {
    if (!shopId) return;
    return modifierGroupRepository.subscribeForShop(shopId, setGroups);
  }, [shopId]);
  useEffect(() => {
    if (!shopId) return;
    return modifierOptionRepository.subscribeForShop(shopId, setModifierOptions);
  }, [shopId]);
  useEffect(() => {
    if (!shopId) return;
    return channelRepository.subscribeForShop(shopId, setChannels);
  }, [shopId]);

  // The list, one section per category in category order (or just the chosen one). Products
  // whose category was deleted get their own section at the end so they can't go missing.
  const sections = [
    ...categories.map((c) => ({ id: c.id, name: c.name, items: items.filter((p) => p.categoryId === c.id) })),
    {
      id: "__none",
      name: "ไม่มีหมวดหมู่",
      items: items.filter((p) => !categories.some((c) => c.id === p.categoryId)),
    },
  ].filter((section) =>
    categoryFilter === "all" ? section.items.length > 0 || section.id !== "__none" : section.id === categoryFilter
  );

  function openCreate() {
    setEditing(null);
    // Adding while a category chip is selected → the new item lands in that category.
    setDealsError(null);
    setForm({
      ...EMPTY_FORM,
      categoryId: categoryFilter !== "all" ? categoryFilter : (categories[0]?.id ?? ""),
    });
    setImageError(null);
    setDialogOpen(true);
  }

  function openEdit(product: Product) {
    setEditing(product);
    setDealsError(null);
    setForm({
      name: product.name,
      categoryId: product.categoryId,
      price: String(product.price),
      imageUrl: product.imageUrl ?? "",
      menuNameBase: product.menuNameBase ?? "",
      staffOnly: product.staffOnly ?? false,
      deals: (product.bundleDeals ?? []).map((d) => ({
        qty: String(d.qty),
        price: String(d.price),
        fromTime: d.fromTime ?? "",
        toTime: d.toTime ?? "",
      })),
      modifierGroupIds: product.modifierGroupIds,
      channelPrices: Object.fromEntries(
        Object.entries(product.channelPrices ?? {}).map(([channelId, p]) => [channelId, String(p)])
      ),
      presets: product.posQuickPresets ?? [],
    });
    setImageError(null);
    setDialogOpen(true);
  }

  /** Same `compressImageFile` (canvas resize + JPEG quality step-down until it fits a Firestore
   * field, used for the superadmin's QR upload and a shop's own payment QR in Settings) — picking
   * a menu photo from a phone/computer is the same "one small image, uploaded rarely" case, and
   * means an admin no longer has to find somewhere else to host the file first just to paste a
   * URL here. The URL field right below still works too, for anyone who already has one hosted. */
  async function handleImageFileChange(file: File | null) {
    if (!file) return;
    setImageError(null);
    try {
      const dataUrl = await compressImageFile(file);
      setForm((f) => ({ ...f, imageUrl: dataUrl }));
    } catch (err) {
      setImageError(err instanceof Error ? err.message : "อ่านรูปภาพไม่สำเร็จ");
    }
  }

  function toggleGroup(groupId: string) {
    setForm((f) => ({
      ...f,
      modifierGroupIds: f.modifierGroupIds.includes(groupId)
        ? f.modifierGroupIds.filter((id) => id !== groupId)
        : [...f.modifierGroupIds, groupId],
    }));
  }

  function updateDeal(index: number, patch: Partial<DealRow>) {
    setForm((f) => ({ ...f, deals: f.deals.map((d, i) => (i === index ? { ...d, ...patch } : d)) }));
  }

  function removeDeal(index: number) {
    setForm((f) => ({ ...f, deals: f.deals.filter((_, i) => i !== index) }));
  }

  function setChannelPriceInput(channelId: string, value: string) {
    setForm((f) => ({ ...f, channelPrices: { ...f.channelPrices, [channelId]: value } }));
  }

  async function handleSave() {
    const name = form.name.trim();
    const price = Number(form.price);
    if (!name || !form.categoryId || !Number.isFinite(price) || price < 0 || !shopId) return;

    // Blank input = no override for that channel; anything else must parse as a non-negative
    // number or the whole save is rejected (never silently drop a typo'd override).
    const channelPrices: Record<string, number> = {};
    for (const [channelId, raw] of Object.entries(form.channelPrices)) {
      if (raw.trim() === "") continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return;
      channelPrices[channelId] = value;
    }

    const imageUrl = form.imageUrl.trim() || null;

    const parsedDeals = parseDeals(form.deals);
    if (!parsedDeals.ok) {
      setDealsError(parsedDeals.error);
      return;
    }
    const bundleDeals = parsedDeals.deals;
    setDealsError(null);

    // A preset only saves if it has a label and a selection for every currently-required group
    // on this product — same check `QuickPresetEditor` shows inline, enforced again here so a
    // half-filled preset (e.g. abandoned mid-edit) never silently reaches the POS grid as a
    // button that would fail to add a valid item.
    const activeGroups = form.modifierGroupIds
      .map((id) => groups.find((g) => g.id === id))
      .filter((g): g is ModifierGroup => Boolean(g));
    const presets = form.presets.filter(
      (p) => p.label.trim() && !activeGroups.some((g) => g.required && (p.selections[g.id] ?? []).length === 0)
    );

    setSaving(true);
    try {
      if (editing) {
        await productRepository.update(editing.id, {
          name,
          categoryId: form.categoryId,
          price,
          imageUrl,
          menuNameBase: form.menuNameBase.trim() || null,
          staffOnly: form.staffOnly,
          bundleDeals,
          modifierGroupIds: form.modifierGroupIds,
          channelPrices,
          posQuickPresets: presets,
          updatedAt: Date.now(),
        });
      } else {
        await productRepository.create({
          shopId,
          name,
          categoryId: form.categoryId,
          price,
          imageUrl,
          menuNameBase: form.menuNameBase.trim() || null,
          staffOnly: form.staffOnly,
          bundleDeals,
          modifierGroupIds: form.modifierGroupIds,
          channelPrices,
          posQuickPresets: presets,
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

  /** Moves within one category's section — order only matters inside a category (the POS and
   * customer menus both list by category), so each section is renumbered on its own. */
  async function move(sectionItems: Product[], index: number, direction: "up" | "down") {
    const swap = computeSwap(sectionItems, index, direction);
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

      {categories.length > 0 ? (
        <div className="mb-4 flex flex-wrap gap-2" role="tablist" aria-label="กรองตามหมวดหมู่">
          {[{ id: "all", name: "ทั้งหมด", count: items.length }, ...categories.map((c) => ({
            id: c.id,
            name: c.name,
            count: items.filter((p) => p.categoryId === c.id).length,
          }))].map((chip) => (
            <button
              key={chip.id}
              type="button"
              role="tab"
              aria-selected={categoryFilter === chip.id}
              onClick={() => setCategoryFilter(chip.id)}
              className={
                "rounded-full border px-4 py-2 text-sm font-medium " +
                (categoryFilter === chip.id
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card hover:bg-accent")
              }
            >
              {chip.name} <span className="opacity-70">({chip.count})</span>
            </button>
          ))}
        </div>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>ชื่อเมนู</TableHead>
            <TableHead>ราคา</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead className="text-right">จัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {sections.map((section) => (
            <Fragment key={section.id}>
              <TableRow className="bg-muted/60 hover:bg-muted/60">
                <TableCell colSpan={5} className="py-2 font-semibold">
                  {section.name} <span className="font-normal text-muted-foreground">({section.items.length})</span>
                </TableCell>
              </TableRow>
              {section.items.map((product, index) => (
                <TableRow key={product.id}>
                  <TableCell>
                    <SortButtons
                      disabledUp={index === 0}
                      disabledDown={index === section.items.length - 1}
                      onUp={() => move(section.items, index, "up")}
                      onDown={() => move(section.items, index, "down")}
                    />
                  </TableCell>
                  <TableCell className="font-medium">
                    <span className="flex flex-wrap items-center gap-2">
                      {product.name}
                      {product.bundleDeals && product.bundleDeals.length > 0 ? (
                        <Badge variant="success">
                          โปร{" "}
                          {product.bundleDeals
                            .map((d) => {
                              const window = dealWindowLabel(d);
                              return `${d.qty}/${d.price.toLocaleString("th-TH")}${window ? ` (${window})` : ""}`;
                            })
                            .join(", ")}
                        </Badge>
                      ) : null}
                      {product.staffOnly ? <Badge variant="muted">เฉพาะพนักงาน</Badge> : null}
                    </span>
                  </TableCell>
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
            </Fragment>
          ))}
          {sections.every((section) => section.items.length === 0) ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground">
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
                placeholder="เช่น กาแฟเย็น"
                autoFocus
              />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="product-name-base">ชื่อเมนูตามตัวเลือก (ไม่บังคับ)</Label>
              <Input
                id="product-name-base"
                value={form.menuNameBase}
                onChange={(e) => setForm((f) => ({ ...f, menuNameBase: e.target.value }))}
                placeholder="เช่น ก๋วยเตี๋ยว"
              />
              <p className="text-xs text-muted-foreground">
                ใส่ชื่อหลัก แล้วไปตั้ง &quot;คำต่อชื่อเมนู&quot; ที่ตัวเลือกใน Modifier เช่น หมูสด = หมู, เนื้อเปื่อย = เนื้อ
                ครัวและบิลจะขึ้นเป็น ก๋วยเตี๋ยวหมู หรือ ก๋วยเตี๋ยวเนื้อ ตามที่เลือก ถ้าเว้นว่างจะใช้ชื่อเมนูปกติ
              </p>
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

            <div className="grid gap-2">
              <Label htmlFor="product-image-file">รูปเมนู (ไม่บังคับ)</Label>
              <Input
                id="product-image-file"
                type="file"
                accept="image/*"
                onChange={(e) => handleImageFileChange(e.target.files?.[0] ?? null)}
              />
              <p className="text-xs text-muted-foreground">
                เลือกรูปจากเครื่อง/มือถือได้โดยตรง (แสดงเฉพาะหน้าสั่งของลูกค้า ไม่ขึ้นในหน้า POS ของพนักงาน) —
                หรือจะวางลิงก์รูปที่มีอยู่แล้วในช่องด้านล่างแทนก็ได้
              </p>
              {imageError ? <p className="text-xs text-destructive">{imageError}</p> : null}
              <Input
                id="product-image"
                value={form.imageUrl}
                onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                placeholder="https://..."
              />
              {form.imageUrl.trim() ? (
                // Either a data: URL from handleImageFileChange above, or an arbitrary admin-
                // pasted URL from any host (same as ShopSettings.logoUrl) — next/image would need
                // every possible host allow-listed in next.config.ts ahead of time, which defeats
                // the point of a free-text "paste any link" field.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={form.imageUrl.trim()}
                  alt="ตัวอย่างรูปเมนู"
                  className="h-24 w-24 rounded-lg border border-border object-cover"
                />
              ) : null}
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

            {form.modifierGroupIds.length > 0 ? (
              <div className="grid gap-2">
                <Label>ปุ่มลัดหน้า POS (ไม่บังคับ)</Label>
                <p className="text-xs text-muted-foreground">
                  สร้างปุ่มที่กดครั้งเดียวแล้วเลือก Modifier ให้เลย ไม่ต้องเปิด popup — เช่น ปุ่ม
                  &quot;ไซส์ใหญ่พิเศษ&quot; ที่เลือก &quot;ขนาด: ใหญ่&quot; ไว้ล่วงหน้า เฉพาะหน้า POS
                  พนักงานเท่านั้น หน้าสั่งของลูกค้ายังขึ้นให้เลือกเองตามปกติ
                </p>
                <QuickPresetEditor
                  groups={groups.filter((g) => form.modifierGroupIds.includes(g.id))}
                  modifierOptions={modifierOptions}
                  productId={editing?.id ?? ""}
                  presets={form.presets}
                  onChange={(presets) => setForm((f) => ({ ...f, presets }))}
                />
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-3">
              <div>
                <p className="text-sm font-medium">ซ่อนจากลูกค้า (สั่งผ่านพนักงานเท่านั้น)</p>
                <p className="text-xs text-muted-foreground">
                  ไม่ขึ้นในหน้าสั่งอาหารผ่าน QR ของลูกค้า แต่พนักงานยังกดขายที่หน้า POS ได้ตามปกติ
                </p>
              </div>
              <Switch
                checked={form.staffOnly}
                onCheckedChange={(v) => setForm((f) => ({ ...f, staffOnly: v }))}
                aria-label="ซ่อนจากลูกค้า"
              />
            </div>

            <div className="grid gap-2">
              <Label>โปรโมชั่นซื้อหลายชิ้น (ไม่บังคับ)</Label>
              <p className="text-xs text-muted-foreground">
                เช่น ซื้อ 3 ชิ้น ราคารวม 189 บาท หน้า POS จะมีปุ่มสีเขียว &quot;โปร 3 ชิ้น ฿189&quot; ให้พนักงานกดเลือก
                ได้ทีละชุด ใส่ช่วงเวลาได้ เช่น 16:00 ถึง 20:00 และ 20:00 ถึง 06:00 ปุ่มจะขึ้นเฉพาะช่วงเวลานั้น
                ใช้กับราคาหน้าร้านเท่านั้น และใช้ได้กับเมนูที่ไม่มีตัวเลือก (Modifier)
              </p>
              <div className="grid gap-2 rounded-lg border border-border p-3">
                {form.deals.map((deal, i) => {
                  const qty = Number(deal.qty);
                  const price = Number(deal.price);
                  const normal = Number(form.price) * qty;
                  const valid = Number.isInteger(qty) && qty >= 2 && deal.price.trim() !== "" && price >= 0;
                  return (
                    <div key={i} className="flex flex-wrap items-center gap-2">
                      <span className="text-sm">ซื้อ</span>
                      <Input
                        aria-label="จำนวนชิ้น"
                        inputMode="numeric"
                        className="w-20"
                        value={deal.qty}
                        onChange={(e) => updateDeal(i, { qty: e.target.value })}
                      />
                      <span className="text-sm">ชิ้น ราคารวม</span>
                      <Input
                        aria-label="ราคารวม"
                        inputMode="decimal"
                        className="w-28"
                        value={deal.price}
                        onChange={(e) => updateDeal(i, { price: e.target.value })}
                      />
                      <span className="text-sm">บาท</span>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => removeDeal(i)}>
                        ลบ
                      </Button>
                      <div className="flex w-full flex-wrap items-center gap-2">
                        <span className="text-sm text-muted-foreground">ช่วงเวลา</span>
                        <Input
                          aria-label="ตั้งแต่เวลา"
                          type="time"
                          className="w-32"
                          value={deal.fromTime}
                          onChange={(e) => updateDeal(i, { fromTime: e.target.value })}
                        />
                        <span className="text-sm">ถึง</span>
                        <Input
                          aria-label="ถึงเวลา"
                          type="time"
                          className="w-32"
                          value={deal.toTime}
                          onChange={(e) => updateDeal(i, { toTime: e.target.value })}
                        />
                        <span className="text-xs text-muted-foreground">
                          {deal.fromTime || deal.toTime ? dealWindowLabel(deal) : "เว้นว่าง = ทั้งวัน"}
                        </span>
                      </div>
                      {valid && Number.isFinite(normal) && normal > 0 ? (
                        <span className={"w-full text-xs " + (price < normal ? "text-success" : "text-destructive")}>
                          {price < normal
                            ? `ปกติ ${normal.toLocaleString("th-TH")} บาท ลูกค้าประหยัด ${(normal - price).toLocaleString("th-TH")} บาท`
                            : `แพงกว่าหรือเท่ากับซื้อแยก (${normal.toLocaleString("th-TH")} บาท) โปรนี้จะไม่ถูกใช้`}
                        </span>
                      ) : null}
                    </div>
                  );
                })}
                <Button
                  variant="outline"
                  size="sm"
                  className="justify-self-start"
                  onClick={() =>
                    setForm((f) => ({ ...f, deals: [...f.deals, { qty: "", price: "", fromTime: "", toTime: "" }] }))
                  }
                >
                  + เพิ่มโปรโมชั่น
                </Button>
                {dealsError ? <p className="text-sm text-destructive">{dealsError}</p> : null}
                {form.deals.length > 0 && form.modifierGroupIds.length > 0 ? (
                  <p className="text-sm text-destructive">
                    เมนูนี้มีตัวเลือก (Modifier) ปุ่มโปรจะไม่ขึ้นที่หน้า POS เอาตัวเลือกออก หรือสร้างเมนูโปรแยก
                  </p>
                ) : null}
              </div>
            </div>

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

/**
 * Form rows → `Product.bundleDeals`. Fully blank rows are dropped; anything half-filled or
 * invalid blocks the save with a message rather than being silently discarded. Two deals for the
 * same quantity would be ambiguous, so that's refused too.
 */
function parseDeals(rows: DealRow[]): { ok: true; deals: BundleDeal[] } | { ok: false; error: string } {
  const deals: BundleDeal[] = [];
  for (const row of rows) {
    if (row.qty.trim() === "" && row.price.trim() === "" && !row.fromTime && !row.toTime) continue;
    const qty = Number(row.qty);
    const price = Number(row.price);
    if (!Number.isInteger(qty) || qty < 2) return { ok: false, error: "จำนวนชิ้นของโปรโมชั่นต้องเป็นจำนวนเต็มตั้งแต่ 2 ขึ้นไป" };
    if (row.price.trim() === "" || !Number.isFinite(price) || price < 0) {
      return { ok: false, error: "กรอกราคารวมของโปรโมชั่นเป็นตัวเลข" };
    }
    if ((row.fromTime && parseClock(row.fromTime) === null) || (row.toTime && parseClock(row.toTime) === null)) {
      return { ok: false, error: "เวลาของโปรโมชั่นไม่ถูกต้อง" };
    }
    const deal: BundleDeal = { qty, price, fromTime: row.fromTime || null, toTime: row.toTime || null };
    // Same quantity twice is fine only when the two windows never run at the same time —
    // otherwise the till couldn't tell which price applies.
    if (deals.some((d) => d.qty === qty && dealWindowsOverlap(d, deal))) {
      return { ok: false, error: `โปรโมชั่นซื้อ ${qty} ชิ้นมีช่วงเวลาซ้อนกัน ตั้งเวลาให้ไม่ทับกัน เช่น ถึง 20:00 กับ ตั้งแต่ 20:00` };
    }
    deals.push(deal);
  }
  return { ok: true, deals: deals.sort((a, b) => a.qty - b.qty) };
}
