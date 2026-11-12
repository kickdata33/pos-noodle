"use client";

import { useEffect, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { SortButtons } from "@/components/admin/SortButtons";
import { BulkCreateTablesDialog } from "@/components/admin/tables/BulkCreateTablesDialog";
import { TableQrDialog } from "@/components/shared/TableQrDialog";
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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useAuth } from "@/hooks/useAuth";
import { computeSwap } from "@/lib/admin/sortOrder";
import { printQrForTable } from "@/lib/pos/tableQrPrint";
import { shopRepository } from "@/repositories/shopRepository";
import { tableRepository } from "@/repositories/tableRepository";
import type { Table as PosTable, ShopSettings } from "@/types";
import { tableLabel } from "@/lib/tableLabel";

/**
 * Table CRUD (item 13). Unlike Categories/Products, item 13 explicitly asks for real delete
 * ("เพิ่มโต๊ะ / ลบโต๊ะ") alongside "ปิดโต๊ะชั่วคราว" (temporary close) as a *separate* concept —
 * so this page has both a delete button and an active/inactive switch. Count/names are never
 * hardcoded (item 34) — this page is the only place table data comes from.
 */
export default function TablesPage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;
  const [items, setItems] = useState<PosTable[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<PosTable | null>(null);
  const [name, setName] = useState("");
  // Item: "ลูกค้าแอบถ่ายรูป QR แล้วสั่งทีหลังได้ไหม" — see `Table.qrMode`'s own comment for what
  // "session" actually changes. Admin-only (this whole dialog already is), same as every other
  // table field; staff just (re)generate the current token from `TableQrDialog`'s own button.
  const [qrMode, setQrMode] = useState<"static" | "session">("static");
  const [saving, setSaving] = useState(false);
  const [qrTable, setQrTable] = useState<PosTable | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  // Multi-select (item: "เลือกโต๊ะได้หลายๆ โต๊ะพร้อมกัน แล้วแก้ไข") — change QR mode, open/close or
  // print QR for many tables in one go instead of one "แก้ไข" at a time.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkMessage, setBulkMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [settings, setSettings] = useState<ShopSettings | null>(null);

  useEffect(() => {
    if (!shopId) return;
    return tableRepository.subscribeForShop(shopId, setItems);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    shopRepository.getSettings(shopId).then(setSettings).catch(() => undefined);
  }, [shopId]);

  // Drop selections for tables that were deleted elsewhere, so counts never include ghosts.
  const selectedTables = items.filter((t) => selected.has(t.id));
  const allSelected = items.length > 0 && selectedTables.length === items.length;

  function toggleSelected(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
    setBulkMessage(null);
  }

  function toggleSelectAll() {
    setSelected(allSelected ? new Set() : new Set(items.map((t) => t.id)));
    setBulkMessage(null);
  }

  async function runBulk(label: string, action: (table: PosTable) => Promise<unknown>) {
    if (selectedTables.length === 0) return;
    setBulkBusy(true);
    setBulkMessage(null);
    const results = await Promise.allSettled(selectedTables.map(action));
    const failed = results.filter((r) => r.status === "rejected").length;
    setBulkBusy(false);
    setBulkMessage(
      failed === 0
        ? { ok: true, text: `${label} ${selectedTables.length} โต๊ะแล้ว` }
        : { ok: false, text: `${label}ไม่สำเร็จ ${failed} จาก ${selectedTables.length} โต๊ะ ลองอีกครั้ง` }
    );
  }

  const bulkSetQrMode = (mode: "static" | "session") =>
    runBulk(mode === "session" ? "ตั้ง QR เปลี่ยนทุกรอบ" : "ตั้ง QR ถาวร", (t) =>
      // Same rule as the single-table form: going static clears any leftover session token.
      tableRepository.update(t.id, { qrMode: mode, ...(mode === "static" ? { sessionToken: null } : {}) })
    );
  const bulkSetActive = (active: boolean) =>
    runBulk(active ? "เปิดใช้งาน" : "ปิดชั่วคราว", (t) => tableRepository.update(t.id, { active }));
  const bulkPrintQr = () =>
    runBulk("ส่งพิมพ์ QR", (t) =>
      settings && appUser ? printQrForTable(t, settings, appUser) : Promise.reject(new Error("no settings"))
    );

  function openCreate() {
    setEditing(null);
    setName("");
    setQrMode("static");
    setDialogOpen(true);
  }

  function openEdit(table: PosTable) {
    setEditing(table);
    setName(table.name);
    setQrMode(table.qrMode === "session" ? "session" : "static");
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmed = name.trim();
    if (!trimmed || !shopId) return;
    setSaving(true);
    try {
      if (editing) {
        // Turning session mode off clears any leftover token too — otherwise a table switched
        // back to "static" would still have a stale `sessionToken` sitting unused in Firestore
        // (harmless since `qrMode !== "session"` means nothing ever reads it, but confusing to
        // leave around).
        await tableRepository.update(editing.id, {
          name: trimmed,
          qrMode,
          ...(qrMode === "static" ? { sessionToken: null } : {}),
        });
      } else {
        await tableRepository.create({
          shopId,
          name: trimmed,
          sortOrder: items.length,
          active: true,
          createdAt: Date.now(),
          qrMode,
          sessionToken: null,
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
      extraActions={
        <Button size="sm" variant="outline" onClick={() => setBulkOpen(true)}>
          สร้างหลายโต๊ะ
        </Button>
      }
    >
      {selectedTables.length > 0 ? (
        <div className="sticky top-0 z-10 mb-3 flex flex-wrap items-center gap-2 rounded-lg border border-primary/40 bg-card p-3 shadow-sm">
          <span className="mr-1 font-semibold">เลือก {selectedTables.length} โต๊ะ</span>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkSetQrMode("session")}>
            QR เปลี่ยนทุกรอบ
          </Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkSetQrMode("static")}>
            QR ถาวร
          </Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkSetActive(true)}>
            เปิดใช้งาน
          </Button>
          <Button size="sm" variant="outline" disabled={bulkBusy} onClick={() => bulkSetActive(false)}>
            ปิดชั่วคราว
          </Button>
          {settings?.printStation?.tableQrEnabled ? (
            <Button size="sm" disabled={bulkBusy} onClick={bulkPrintQr}>
              พิมพ์ QR
            </Button>
          ) : null}
          <Button
            size="sm"
            variant="ghost"
            disabled={bulkBusy}
            onClick={() => {
              setSelected(new Set());
              setBulkMessage(null);
            }}
          >
            ยกเลิกการเลือก
          </Button>
          {bulkMessage ? (
            <span className={"w-full text-sm " + (bulkMessage.ok ? "text-success" : "text-destructive")}>
              {bulkMessage.text}
            </span>
          ) : null}
        </div>
      ) : bulkMessage ? (
        <p className={"mb-3 text-sm " + (bulkMessage.ok ? "text-success" : "text-destructive")}>{bulkMessage.text}</p>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10">
              <Checkbox
                aria-label="เลือกทุกโต๊ะ"
                checked={allSelected ? true : selectedTables.length > 0 ? "indeterminate" : false}
                onCheckedChange={toggleSelectAll}
              />
            </TableHead>
            <TableHead className="w-10" />
            <TableHead>ชื่อโต๊ะ</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead className="text-right">จัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((table, index) => (
            <TableRow key={table.id} data-state={selected.has(table.id) ? "selected" : undefined}>
              <TableCell>
                <Checkbox
                  aria-label={`เลือก${tableLabel(table.name)}`}
                  checked={selected.has(table.id)}
                  onCheckedChange={() => toggleSelected(table.id)}
                />
              </TableCell>
              <TableCell>
                <SortButtons
                  disabledUp={index === 0}
                  disabledDown={index === items.length - 1}
                  onUp={() => move(index, "up")}
                  onDown={() => move(index, "down")}
                />
              </TableCell>
              <TableCell className="font-medium">
                {table.name}
                {table.qrMode === "session" ? (
                  <Badge variant="muted" className="ml-2">
                    QR เปลี่ยนใหม่
                  </Badge>
                ) : null}
              </TableCell>
              <TableCell>
                <Badge variant={table.active ? "success" : "muted"}>
                  {table.active ? "เปิดใช้งาน" : "ปิดชั่วคราว"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Switch checked={table.active} onCheckedChange={() => toggleActive(table)} />
                  <Button variant="outline" size="sm" onClick={() => setQrTable(table)}>
                    QR
                  </Button>
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
              <TableCell colSpan={5} className="text-center text-muted-foreground">
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
          <div className="flex items-center justify-between gap-2 rounded-md border border-border p-3">
            <div>
              <p className="text-sm font-medium">QR แบบเปลี่ยนใหม่ทุกรอบ</p>
              <p className="text-xs text-muted-foreground">
                ปลอดภัยขึ้น — กันลูกค้าถ่ายรูป QR แล้วสั่งซ้ำหลังเช็คบิลแล้ว แต่พนักงานต้องกด &quot;สร้าง
                QR ใหม่&quot; ทุกครั้งที่มีลูกค้านั่งโต๊ะนี้ (ปกติเปิดไว้คือ QR ถาวร ไม่ต้องทำอะไรเพิ่ม)
              </p>
            </div>
            <Switch
              checked={qrMode === "session"}
              onCheckedChange={(checked) => setQrMode(checked ? "session" : "static")}
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

      <TableQrDialog table={qrTable} onOpenChange={(open) => !open && setQrTable(null)} />

      {shopId ? (
        <BulkCreateTablesDialog
          open={bulkOpen}
          onOpenChange={setBulkOpen}
          shopId={shopId}
          existingCount={items.length}
        />
      ) : null}
    </AdminSection>
  );
}
