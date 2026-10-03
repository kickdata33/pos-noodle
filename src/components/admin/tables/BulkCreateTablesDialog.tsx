"use client";

import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { generateBulkTables } from "@/lib/admin/bulkTableNames";
import { tableRepository } from "@/repositories/tableRepository";

const MAX_COUNT = 300;

function previewText(names: string[]): string {
  if (names.length <= 12) return names.join(", ");
  return `${names.slice(0, 6).join(", ")}, ... , ${names.slice(-3).join(", ")}`;
}

/**
 * Bulk-create tables (item 13 follow-up: "สร้างจำนวนโต๊ะทีละหลายใบ แทนการเพิ่มทีละใบ") —
 * sits next to the regular "+ เพิ่มโต๊ะ" button (see `AdminSection`'s `extraActions`), for a shop
 * that wants to set up 10/20/50 tables at once instead of one dialog per table.
 *
 * The "เรียงแบบงู" (snake/boustrophedon) option exists because a real floor plan is often two
 * rows of tables facing each other — numbering straight through (row 1: 1-10, row 2: 11-20)
 * leaves table 1 physically next to table 20, not 11. Snaking (row 2 reads 20-11 instead)
 * matches how the tables actually sit. See `generateBulkTables`'s own comment for the exact
 * algorithm — this only reorders *which number lands where*, every table is still numbered
 * sequentially from `startNumber`.
 */
export function BulkCreateTablesDialog({
  open,
  onOpenChange,
  shopId,
  existingCount,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shopId: string;
  /** Current table count — new tables are appended after these in sort order, and the default
   * starting number continues on from here. */
  existingCount: number;
}) {
  const [count, setCount] = useState("10");
  const [startNumber, setStartNumber] = useState(String(existingCount + 1));
  const [nameTemplate, setNameTemplate] = useState("{n}");
  const [perRow, setPerRow] = useState("");
  const [snake, setSnake] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const parsedCount = Number(count);
  const parsedStart = Number(startNumber);
  const parsedPerRow = perRow.trim() ? Number(perRow) : null;
  const countValid = Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= MAX_COUNT;
  const startValid = Number.isInteger(parsedStart);
  const perRowValid = parsedPerRow === null || (Number.isInteger(parsedPerRow) && parsedPerRow >= 1);
  const canSnake = snake && parsedPerRow !== null && perRowValid;
  const valid = countValid && startValid && perRowValid;

  const preview = useMemo(() => {
    if (!valid) return [];
    return generateBulkTables({
      count: parsedCount,
      startNumber: parsedStart,
      nameTemplate: nameTemplate.trim() || "{n}",
      perRow: parsedPerRow,
      snake: canSnake,
    }).map((t) => t.name);
  }, [valid, parsedCount, parsedStart, nameTemplate, parsedPerRow, canSnake]);

  function reset() {
    setCount("10");
    setStartNumber(String(existingCount + 1));
    setNameTemplate("{n}");
    setPerRow("");
    setSnake(false);
    setError(null);
  }

  async function handleCreate() {
    if (!valid) return;
    setSaving(true);
    setError(null);
    try {
      const generated = generateBulkTables({
        count: parsedCount,
        startNumber: parsedStart,
        nameTemplate: nameTemplate.trim() || "{n}",
        perRow: parsedPerRow,
        snake: canSnake,
      });
      await Promise.all(
        generated.map((t) =>
          tableRepository.create({
            shopId,
            name: t.name,
            sortOrder: existingCount + t.sortOrderOffset,
            active: true,
            createdAt: Date.now(),
          })
        )
      );
      reset();
      onOpenChange(false);
    } catch {
      setError("สร้างโต๊ะไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>สร้างหลายโต๊ะพร้อมกัน</DialogTitle>
        </DialogHeader>

        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-count">จำนวนโต๊ะ</Label>
              <Input
                id="bulk-count"
                type="number"
                min={1}
                max={MAX_COUNT}
                value={count}
                onChange={(e) => setCount(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="bulk-start">เลขโต๊ะเริ่มต้น</Label>
              <Input
                id="bulk-start"
                type="number"
                value={startNumber}
                onChange={(e) => setStartNumber(e.target.value)}
              />
            </div>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bulk-template">รูปแบบชื่อ</Label>
            <Input
              id="bulk-template"
              value={nameTemplate}
              onChange={(e) => setNameTemplate(e.target.value)}
              placeholder="{n}"
            />
            <p className="text-xs text-muted-foreground">
              ใช้ {"{n}"} แทนเลขโต๊ะ เช่น &quot;โต๊ะ {"{n}"}&quot; หรือ &quot;A{"{n}"}&quot; — เว้นว่างหรือไม่มี{" "}
              {"{n}"} จะใช้แค่ตัวเลขเฉยๆ
            </p>
          </div>

          <div className="grid gap-1.5">
            <Label htmlFor="bulk-per-row">จำนวนโต๊ะต่อแถว (ไม่บังคับ)</Label>
            <Input
              id="bulk-per-row"
              type="number"
              min={1}
              value={perRow}
              onChange={(e) => setPerRow(e.target.value)}
              placeholder="เช่น 10"
            />
            <p className="text-xs text-muted-foreground">
              ใส่ถ้าจัดโต๊ะเป็นแถวๆ จริง — ใช้คู่กับตัวเลือก &quot;เรียงแบบงู&quot; ด้านล่าง ให้เลขโต๊ะที่อยู่ติดกันจริง
              (เช่น แถวแรก 10 ไปสุดแถวติดกับโต๊ะ 11 ของแถวถัดไปพอดี) ไม่ใช่กระโดดจากโต๊ะ 10 ไปโต๊ะ 20
            </p>
          </div>

          {parsedPerRow ? (
            <label className="flex items-center justify-between gap-2">
              <span className="text-sm">เรียงแบบงู (สลับทิศทุกแถวคู่)</span>
              <Switch checked={snake} onCheckedChange={setSnake} />
            </label>
          ) : null}

          <div className="rounded-md border border-border bg-secondary/50 p-3 text-sm">
            <p className="mb-1 font-medium">ตัวอย่างที่จะสร้าง{countValid ? ` (${parsedCount} โต๊ะ)` : ""}</p>
            {valid ? (
              <p className="text-muted-foreground">{previewText(preview)}</p>
            ) : (
              <p className="text-muted-foreground">กรอกข้อมูลให้ครบถูกต้องก่อน</p>
            )}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button onClick={handleCreate} disabled={!valid || saving}>
            {saving ? "กำลังสร้าง..." : `สร้าง ${countValid ? parsedCount : ""} โต๊ะ`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
