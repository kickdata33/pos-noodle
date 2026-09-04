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
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { computeSwap } from "@/lib/admin/sortOrder";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { channelRepository } from "@/repositories/channelRepository";
import type { SalesChannel } from "@/types";

const DEFAULT_COLOR = "#16a34a";

/**
 * Sales Channel CRUD (item 14). `code` only exists on the 5 seeded defaults for the future
 * delivery-API integration layer (item 30) — Admin-created channels leave it null and this UI
 * never lets you set it, so a component can never grow a hardcoded dependency on "Grab" etc.
 * beyond what's already isolated to the seed script.
 */
export default function ChannelsPage() {
  const [items, setItems] = useState<SalesChannel[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SalesChannel | null>(null);
  const [name, setName] = useState("");
  const [color, setColor] = useState(DEFAULT_COLOR);
  const [requiresTable, setRequiresTable] = useState(false);
  const [markupPercent, setMarkupPercent] = useState("0");
  const [saving, setSaving] = useState(false);

  useEffect(() => channelRepository.subscribeForShop(DEFAULT_SHOP_ID, setItems), []);

  function openCreate() {
    setEditing(null);
    setName("");
    setColor(DEFAULT_COLOR);
    setRequiresTable(false);
    setMarkupPercent("0");
    setDialogOpen(true);
  }

  function openEdit(channel: SalesChannel) {
    setEditing(channel);
    setName(channel.name);
    setColor(channel.color);
    setRequiresTable(channel.requiresTable);
    setMarkupPercent(String(channel.markupPercent ?? 0));
    setDialogOpen(true);
  }

  async function handleSave() {
    const trimmed = name.trim();
    const markup = Number(markupPercent);
    if (!trimmed || !Number.isFinite(markup) || markup < 0) return;
    setSaving(true);
    try {
      if (editing) {
        await channelRepository.update(editing.id, { name: trimmed, color, requiresTable, markupPercent: markup });
      } else {
        await channelRepository.create({
          shopId: DEFAULT_SHOP_ID,
          name: trimmed,
          code: null,
          requiresTable,
          color,
          icon: null,
          active: true,
          sortOrder: items.length,
          createdAt: Date.now(),
          markupPercent: markup,
        });
      }
      setDialogOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(channel: SalesChannel) {
    await channelRepository.update(channel.id, { active: !channel.active });
  }

  async function move(index: number, direction: "up" | "down") {
    const swap = computeSwap(items, index, direction);
    if (!swap) return;
    await Promise.all(swap.map((s) => channelRepository.update(s.id, { sortOrder: s.sortOrder })));
  }

  return (
    <AdminSection
      title="ช่องทางขาย"
      description="เช่น หน้าร้าน, กลับบ้าน, Grab, LINE MAN, ShopeeFood"
      actionLabel="+ เพิ่มช่องทาง"
      onAction={openCreate}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10" />
            <TableHead>ช่องทาง</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead className="text-right">จัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((channel, index) => (
            <TableRow key={channel.id}>
              <TableCell>
                <SortButtons
                  disabledUp={index === 0}
                  disabledDown={index === items.length - 1}
                  onUp={() => move(index, "up")}
                  onDown={() => move(index, "down")}
                />
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span
                    className="size-3 rounded-full"
                    style={{ backgroundColor: channel.color }}
                    aria-hidden
                  />
                  <span className="font-medium">{channel.name}</span>
                  {channel.requiresTable ? (
                    <span className="text-xs text-muted-foreground">(ใช้โต๊ะ)</span>
                  ) : null}
                  {channel.markupPercent ? (
                    <Badge variant="muted">+{channel.markupPercent}%</Badge>
                  ) : null}
                  {channel.code ? (
                    <Badge variant="muted" className="text-[10px]">
                      {channel.code}
                    </Badge>
                  ) : null}
                </div>
              </TableCell>
              <TableCell>
                <Badge variant={channel.active ? "success" : "muted"}>
                  {channel.active ? "เปิดใช้งาน" : "ปิดใช้งาน"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Switch checked={channel.active} onCheckedChange={() => toggleActive(channel)} />
                  <Button variant="outline" size="sm" onClick={() => openEdit(channel)}>
                    แก้ไข
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                ยังไม่มีช่องทางขาย
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? "แก้ไขช่องทาง" : "เพิ่มช่องทาง"}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="channel-name">ชื่อช่องทาง</Label>
              <Input
                id="channel-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="เช่น Robinhood"
                autoFocus
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="channel-color">สี</Label>
              <input
                id="channel-color"
                type="color"
                value={color}
                onChange={(e) => setColor(e.target.value)}
                className="h-10 w-16 rounded border border-input"
              />
            </div>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox checked={requiresTable} onCheckedChange={(v) => setRequiresTable(v === true)} />
              เป็นช่องทางที่ใช้โต๊ะ (เช่น หน้าร้าน)
            </label>
            <div className="grid gap-2">
              <Label htmlFor="channel-markup">บวกราคาอัตโนมัติ (%)</Label>
              <Input
                id="channel-markup"
                type="number"
                inputMode="decimal"
                min={0}
                value={markupPercent}
                onChange={(e) => setMarkupPercent(e.target.value)}
                placeholder="0"
              />
              <p className="text-xs text-muted-foreground">
                เช่น Grab ใส่ 20 = บวกราคาเมนู 20% แล้วปัดขึ้นเป็นเลขลงท้าย 5 บาท — ใส่ 0
                ถ้าไม่ต้องการบวกราคา (เช่น หน้าร้าน, กลับบ้าน) ตั้งราคาเฉพาะบางเมนูเองได้ที่หน้า
                &quot;เมนู&quot;
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              ยกเลิก
            </Button>
            <Button
              onClick={handleSave}
              disabled={saving || !name.trim() || !Number.isFinite(Number(markupPercent)) || Number(markupPercent) < 0}
            >
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminSection>
  );
}
