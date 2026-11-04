"use client";

import { useEffect, useState } from "react";

import { PosBackLink } from "@/components/pos/PosBackLink";
import { usePosCatalog } from "@/components/pos/PosCatalogContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { formatDelta, isLowStock, parseStockInput } from "@/lib/pos/stock";
import { receiveStock, submitStockCount } from "@/lib/pos/stockService";
import { stockLevelRepository } from "@/repositories/stockRepository";
import type { StockLevel } from "@/types";

type Mode = "count" | "receive";

/**
 * Staff stock screen (item: "อยากได้หน้าเช็คสต๊อกเหมือน G2") — two jobs, one list:
 * - นับปิดร้าน: type what's physically on the shelf; the difference from the system shows live,
 *   and saving sends the owner a summary on Telegram.
 * - รับของเข้า: type how many arrived; added on top of the current count, never overwriting it.
 * Sales come off automatically at checkout, so staff never touch this for a normal sale.
 */
export function InventoryScreen() {
  const { shopId } = usePosCatalog();
  const { appUser } = useAuth();
  const [levels, setLevels] = useState<StockLevel[] | null>(null);
  const [mode, setMode] = useState<Mode>("count");
  const [inputs, setInputs] = useState<Record<string, string>>({});
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => stockLevelRepository.subscribeForShop(shopId, setLevels), [shopId]);

  function switchMode(next: Mode) {
    setMode(next);
    setInputs({});
    setMessage(null);
  }

  const parsed = (levels ?? []).map((level) => ({ level, input: parseStockInput(inputs[level.id] ?? "") }));
  const invalid = parsed.some((p) => !p.input.ok);
  const entered = parsed.filter((p) => p.input.ok && p.input.value !== null);
  const notEntered = (levels?.length ?? 0) - entered.length;

  async function handleSave() {
    if (!appUser || invalid || entered.length === 0) return;
    setSaving(true);
    setMessage(null);
    try {
      if (mode === "count") {
        await submitStockCount(
          shopId,
          entered.map((p) => ({ productId: p.level.productId, counted: (p.input as { value: number }).value })),
          appUser
        );
        setMessage({ ok: true, text: `บันทึกผลนับ ${entered.length} รายการแล้ว` });
      } else {
        await receiveStock(
          shopId,
          entered.map((p) => ({ productId: p.level.productId, qty: (p.input as { value: number }).value })),
          note.trim(),
          appUser
        );
        setMessage({ ok: true, text: `บันทึกรับของ ${entered.length} รายการแล้ว` });
        setNote("");
      }
      setInputs({});
    } catch {
      setMessage({ ok: false, text: "บันทึกไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองอีกครั้ง" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4 pb-32 sm:p-6 sm:pb-32">
      <PosBackLink />
      <h1 className="mb-3 text-lg font-semibold">สต๊อกสินค้า</h1>

      <div className="mb-4 grid grid-cols-2 gap-2" role="tablist">
        {(
          [
            ["count", "นับปิดร้าน"],
            ["receive", "รับของเข้า"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            role="tab"
            aria-selected={mode === value}
            onClick={() => switchMode(value)}
            className={cn(
              "rounded-lg border-2 px-4 py-3 text-base font-semibold",
              mode === value ? "border-primary bg-primary text-primary-foreground" : "border-border bg-card"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      <p className="mb-4 text-sm text-muted-foreground">
        {mode === "count"
          ? "นับของบนชั้นจริง แล้วกรอกจำนวนที่นับได้ ช่องที่เว้นว่างจะไม่เปลี่ยน"
          : "กรอกจำนวนที่รับเข้ามา ระบบจะบวกเพิ่มจากยอดที่มีอยู่"}
      </p>

      {levels === null ? <p className="text-muted-foreground">กำลังโหลด...</p> : null}
      {levels?.length === 0 ? (
        <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted-foreground">
          ยังไม่มีสินค้าที่นับสต๊อก ให้เจ้าของร้านเพิ่มที่ Admin → สต๊อกสินค้า
        </p>
      ) : null}

      <ul className="grid gap-2">
        {parsed.map(({ level, input }) => {
          const low = isLowStock(level);
          const value = input.ok ? input.value : null;
          return (
            <li
              key={level.id}
              className={cn(
                "flex items-center gap-3 rounded-lg border bg-card px-4 py-3",
                low ? "border-destructive" : "border-border"
              )}
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-medium">{level.productName}</p>
                <p className={cn("text-sm", low ? "font-semibold text-destructive" : "text-muted-foreground")}>
                  ในระบบ {level.qty}
                  {low ? " · ใกล้หมด" : ""}
                </p>
                {mode === "count" && value !== null ? (
                  <p
                    className={cn(
                      "text-sm font-semibold",
                      value === level.qty ? "text-success" : "text-destructive"
                    )}
                  >
                    {formatDelta(value - level.qty)}
                  </p>
                ) : null}
                {mode === "receive" && value !== null && value > 0 ? (
                  <p className="text-sm font-semibold text-success">รวมเป็น {level.qty + value}</p>
                ) : null}
                {!input.ok ? <p className="text-sm text-destructive">กรอกเป็นตัวเลขจำนวนเต็ม</p> : null}
              </div>
              <Input
                aria-label={`${mode === "count" ? "นับได้" : "รับเข้า"} ${level.productName}`}
                inputMode="numeric"
                pattern="[0-9]*"
                className="h-14 w-24 text-center text-xl"
                placeholder={mode === "count" ? "นับได้" : "+"}
                value={inputs[level.id] ?? ""}
                onChange={(e) => setInputs((prev) => ({ ...prev, [level.id]: e.target.value }))}
              />
            </li>
          );
        })}
      </ul>

      {levels && levels.length > 0 ? (
        <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card p-3">
          <div className="mx-auto grid max-w-2xl gap-2">
            {mode === "receive" ? (
              <Input placeholder="หมายเหตุ เช่น ร้านส่ง/เลขบิล (ไม่บังคับ)" value={note} onChange={(e) => setNote(e.target.value)} />
            ) : null}
            {message ? (
              <p className={cn("text-sm", message.ok ? "text-success" : "text-destructive")}>{message.text}</p>
            ) : mode === "count" && entered.length > 0 && notEntered > 0 ? (
              <p className="text-sm text-muted-foreground">ยังไม่ได้นับ {notEntered} รายการ (จะไม่เปลี่ยน)</p>
            ) : null}
            <Button className="h-12 text-base" onClick={handleSave} disabled={saving || invalid || entered.length === 0}>
              {saving
                ? "กำลังบันทึก..."
                : mode === "count"
                  ? `บันทึกผลนับ (${entered.length})`
                  : `บันทึกรับของ (${entered.length})`}
            </Button>
          </div>
        </div>
      ) : null}
    </main>
  );
}
