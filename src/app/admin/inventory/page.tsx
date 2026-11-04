"use client";

import { useEffect, useMemo, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { formatDelta, isLowStock, parseStockInput } from "@/lib/pos/stock";
import { startTrackingProduct } from "@/lib/pos/stockService";
import { productRepository } from "@/repositories/productRepository";
import { stockLevelRepository, stockMovementRepository } from "@/repositories/stockRepository";
import type { Product, StockLevel, StockMovement, StockMovementType } from "@/types";

const HISTORY_LIMIT = 300;

const TYPE_LABEL: Record<StockMovementType, string> = {
  sale: "ขาย",
  receive: "รับเข้า",
  count: "นับ",
};

function formatDateTime(ms: number): string {
  return new Date(ms).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" });
}

/**
 * สต๊อกสินค้า (Admin): choose which piece-sold products are counted, set each one's low-stock
 * alert level, and read the full history — every sale, delivery and count, with the count
 * differences (เกิน/ขาด) called out. Staff do the day-to-day counting at `/pos/inventory`.
 */
export default function AdminInventoryPage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;
  const [products, setProducts] = useState<Product[]>([]);
  const [levels, setLevels] = useState<StockLevel[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [typeFilter, setTypeFilter] = useState<StockMovementType | "all" | "diff">("all");
  const [productFilter, setProductFilter] = useState<string>("all");

  const [newProductId, setNewProductId] = useState("");
  const [newQty, setNewQty] = useState("");
  const [newThreshold, setNewThreshold] = useState("5");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!shopId) return;
    return productRepository.subscribeForShop(shopId, setProducts);
  }, [shopId]);
  useEffect(() => {
    if (!shopId) return;
    return stockLevelRepository.subscribeForShop(shopId, setLevels);
  }, [shopId]);
  useEffect(() => {
    if (!shopId) return;
    return stockMovementRepository.subscribeRecentForShop(shopId, HISTORY_LIMIT, setMovements);
  }, [shopId]);

  // Keep the stored name snapshot in step with menu renames (it's what Telegram messages use).
  useEffect(() => {
    for (const level of levels) {
      const product = products.find((p) => p.id === level.productId);
      if (product && product.name !== level.productName) {
        void stockLevelRepository.update(level.id, { productName: product.name });
      }
    }
  }, [levels, products]);

  const trackedIds = useMemo(() => new Set(levels.map((l) => l.productId)), [levels]);
  const untracked = products.filter((p) => !trackedIds.has(p.id));

  const visibleMovements = movements.filter((m) => {
    if (productFilter !== "all" && m.productId !== productFilter) return false;
    if (typeFilter === "all") return true;
    if (typeFilter === "diff") return m.type === "count" && m.delta !== 0;
    return m.type === typeFilter;
  });

  async function handleAdd() {
    if (!shopId || !appUser) return;
    const product = products.find((p) => p.id === newProductId);
    const qty = parseStockInput(newQty);
    const threshold = parseStockInput(newThreshold);
    if (!product || !qty.ok || qty.value === null || !threshold.ok || threshold.value === null) {
      setError("เลือกสินค้า และกรอกจำนวนคงเหลือกับจุดแจ้งเตือนเป็นตัวเลข");
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await startTrackingProduct(shopId, { id: product.id, name: product.name }, qty.value, threshold.value, appUser);
      setNewProductId("");
      setNewQty("");
    } catch {
      setError("เพิ่มไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setAdding(false);
    }
  }

  async function handleThresholdChange(level: StockLevel, text: string) {
    const parsed = parseStockInput(text);
    if (!parsed.ok || parsed.value === null || parsed.value === level.lowThreshold) return;
    // Event handler only (onBlur below), never during render — same purity-rule false positive
    // annotated in `StockScreen.toggleProduct`.
    // eslint-disable-next-line react-hooks/purity
    const updatedAt = Date.now();
    await stockLevelRepository.update(level.id, { lowThreshold: parsed.value, updatedAt });
  }

  async function handleUntrack(level: StockLevel) {
    if (!window.confirm(`เลิกนับสต๊อก "${level.productName}"? ประวัติเดิมยังอยู่`)) return;
    await stockLevelRepository.remove(level.id);
  }

  return (
    <AdminSection
      title="สต๊อกสินค้า"
      description="สินค้าที่ขายเป็นชิ้น ตัดสต๊อกเองเมื่อคิดเงิน พนักงานนับปิดร้านและรับของเข้าที่หน้า POS → สต๊อก"
    >
      <div className="grid gap-8">
        <section className="grid gap-3">
          <h2 className="font-semibold">สินค้าที่นับสต๊อก</h2>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>สินค้า</TableHead>
                  <TableHead className="text-right">คงเหลือ</TableHead>
                  <TableHead>แจ้งเตือนเมื่อเหลือไม่เกิน</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {levels.map((level) => (
                  <TableRow key={level.id}>
                    <TableCell className="font-medium">{level.productName}</TableCell>
                    <TableCell
                      className={"text-right text-base " + (isLowStock(level) ? "font-semibold text-destructive" : "")}
                    >
                      {level.qty}
                    </TableCell>
                    <TableCell>
                      <Input
                        aria-label={`จุดแจ้งเตือน ${level.productName}`}
                        inputMode="numeric"
                        className="w-20"
                        defaultValue={level.lowThreshold}
                        onBlur={(e) => handleThresholdChange(level, e.target.value)}
                      />
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => handleUntrack(level)}>
                        เลิกนับ
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
                {levels.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      ยังไม่มี เพิ่มสินค้าที่ต้องการนับด้านล่าง
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>

          <div className="grid gap-3 rounded-lg border border-border p-4 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div className="grid gap-1">
              <Label>เพิ่มสินค้า</Label>
              <Select value={newProductId} onValueChange={setNewProductId}>
                <SelectTrigger>
                  <SelectValue placeholder="เลือกจากเมนู" />
                </SelectTrigger>
                <SelectContent>
                  {untracked.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-1">
              <Label htmlFor="inv-qty">มีอยู่ตอนนี้</Label>
              <Input id="inv-qty" inputMode="numeric" className="w-24" value={newQty} onChange={(e) => setNewQty(e.target.value)} />
            </div>
            <div className="grid gap-1">
              <Label htmlFor="inv-threshold">เตือนเมื่อเหลือ</Label>
              <Input
                id="inv-threshold"
                inputMode="numeric"
                className="w-24"
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
              />
            </div>
            <Button onClick={handleAdd} disabled={adding || !newProductId}>
              เริ่มนับสต๊อก
            </Button>
            {error ? <p className="text-sm text-destructive sm:col-span-4">{error}</p> : null}
          </div>
        </section>

        <section className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-semibold">ประวัติ</h2>
            <div className="flex flex-wrap gap-2">
              <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as typeof typeFilter)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกประเภท</SelectItem>
                  <SelectItem value="diff">นับแล้วไม่ตรง</SelectItem>
                  <SelectItem value="count">นับ</SelectItem>
                  <SelectItem value="receive">รับเข้า</SelectItem>
                  <SelectItem value="sale">ขาย</SelectItem>
                </SelectContent>
              </Select>
              <Select value={productFilter} onValueChange={setProductFilter}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">ทุกสินค้า</SelectItem>
                  {levels.map((l) => (
                    <SelectItem key={l.productId} value={l.productId}>
                      {l.productName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>เวลา</TableHead>
                  <TableHead>สินค้า</TableHead>
                  <TableHead>ประเภท</TableHead>
                  <TableHead className="text-right">เปลี่ยน</TableHead>
                  <TableHead className="text-right">คงเหลือ</TableHead>
                  <TableHead>โดย</TableHead>
                  <TableHead>หมายเหตุ</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visibleMovements.map((m) => (
                  <TableRow key={m.id}>
                    <TableCell className="whitespace-nowrap">{formatDateTime(m.createdAt)}</TableCell>
                    <TableCell>{m.productName}</TableCell>
                    <TableCell>{TYPE_LABEL[m.type]}</TableCell>
                    <TableCell
                      className={
                        "text-right " +
                        (m.type === "count" && m.delta !== 0 && m.note === "" ? "font-semibold text-destructive" : "")
                      }
                    >
                      {m.type === "count" && m.note === "" ? formatDelta(m.delta) : m.delta > 0 ? `+${m.delta}` : m.delta}
                    </TableCell>
                    <TableCell className="text-right">{m.qtyAfter}</TableCell>
                    <TableCell>{m.createdByName}</TableCell>
                    <TableCell className="text-muted-foreground">{m.note}</TableCell>
                  </TableRow>
                ))}
                {visibleMovements.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      ไม่มีรายการ
                    </TableCell>
                  </TableRow>
                ) : null}
              </TableBody>
            </Table>
          </div>
          <p className="text-xs text-muted-foreground">แสดง {HISTORY_LIMIT} รายการล่าสุด</p>
        </section>
      </div>
    </AdminSection>
  );
}
