"use client";

import { useEffect, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { userRepository } from "@/repositories/userRepository";
import type { AppUser, UserRole } from "@/types";

/**
 * Staff management (item 17). Creating an account and resetting a PIN both need the Admin SDK
 * (PIN hashing + Firebase Auth user creation), so those two actions call the server routes from
 * Milestone 2's plan (`/api/admin/staff`, `/api/admin/staff/[id]/pin`); everything else
 * (name/role/active) is a plain client write, already scoped to `isAdmin()` by `firestore.rules`.
 */
export default function StaffPage() {
  const [items, setItems] = useState<AppUser[]>([]);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole>("staff");
  const [pin, setPin] = useState("");
  const [createError, setCreateError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [pinTarget, setPinTarget] = useState<AppUser | null>(null);
  const [resetPin, setResetPin] = useState("");
  const [resetError, setResetError] = useState<string | null>(null);

  useEffect(() => {
    userRepository.listForShop(DEFAULT_SHOP_ID).then(setItems);
  }, []);

  function refresh() {
    userRepository.listForShop(DEFAULT_SHOP_ID).then(setItems);
  }

  function openCreate() {
    setName("");
    setRole("staff");
    setPin("");
    setCreateError(null);
    setCreateOpen(true);
  }

  async function handleCreate() {
    setCreateError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/admin/staff", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), role, pin }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setCreateError(data.error ?? "เพิ่มพนักงานไม่สำเร็จ");
        return;
      }
      setCreateOpen(false);
      refresh();
    } finally {
      setSaving(false);
    }
  }

  async function toggleActive(user: AppUser) {
    await userRepository.update(user.id, { active: !user.active });
    refresh();
  }

  async function handleResetPin() {
    if (!pinTarget) return;
    setResetError(null);
    setSaving(true);
    try {
      const response = await fetch(`/api/admin/staff/${pinTarget.id}/pin`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pin: resetPin }),
      });
      const data = (await response.json()) as { error?: string };
      if (!response.ok) {
        setResetError(data.error ?? "รีเซ็ต PIN ไม่สำเร็จ");
        return;
      }
      setPinTarget(null);
      setResetPin("");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AdminSection
      title="พนักงาน"
      description="แต่ละคนล็อกอินด้วยรหัส PIN 6 หลัก"
      actionLabel="+ เพิ่มพนักงาน"
      onAction={openCreate}
    >
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>ชื่อ</TableHead>
            <TableHead>สิทธิ์</TableHead>
            <TableHead>สถานะ</TableHead>
            <TableHead className="text-right">จัดการ</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.map((user) => (
            <TableRow key={user.id}>
              <TableCell className="font-medium">{user.name}</TableCell>
              <TableCell>
                <Badge variant={user.role === "admin" ? "default" : "muted"}>
                  {user.role === "admin" ? "Admin" : "Staff"}
                </Badge>
              </TableCell>
              <TableCell>
                <Badge variant={user.active ? "success" : "muted"}>
                  {user.active ? "ใช้งานได้" : "ปิดใช้งาน"}
                </Badge>
              </TableCell>
              <TableCell className="text-right">
                <div className="flex justify-end gap-2">
                  <Switch checked={user.active} onCheckedChange={() => toggleActive(user)} />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setPinTarget(user);
                      setResetPin("");
                      setResetError(null);
                    }}
                  >
                    รีเซ็ต PIN
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className="text-center text-muted-foreground">
                ยังไม่มีพนักงาน
              </TableCell>
            </TableRow>
          ) : null}
        </TableBody>
      </Table>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>เพิ่มพนักงาน</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-2">
              <Label htmlFor="staff-name">ชื่อ</Label>
              <Input id="staff-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
            </div>
            <div className="grid gap-2">
              <Label>สิทธิ์</Label>
              <Select value={role} onValueChange={(v) => setRole(v as UserRole)}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="staff">Staff (เข้า POS เท่านั้น)</SelectItem>
                  <SelectItem value="admin">Admin (เข้าถึงทั้งหมด)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="staff-pin">รหัส PIN (6 หลัก)</Label>
              <Input
                id="staff-pin"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              />
            </div>
            {createError ? <p className="text-sm text-destructive">{createError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)}>
              ยกเลิก
            </Button>
            <Button onClick={handleCreate} disabled={saving || !name.trim() || pin.length !== 6}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={pinTarget !== null} onOpenChange={(open) => !open && setPinTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>รีเซ็ต PIN — {pinTarget?.name}</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            <Label htmlFor="reset-pin">รหัส PIN ใหม่ (6 หลัก)</Label>
            <Input
              id="reset-pin"
              inputMode="numeric"
              maxLength={6}
              value={resetPin}
              onChange={(e) => setResetPin(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
            {resetError ? <p className="text-sm text-destructive">{resetError}</p> : null}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPinTarget(null)}>
              ยกเลิก
            </Button>
            <Button onClick={handleResetPin} disabled={saving || resetPin.length !== 6}>
              บันทึก
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AdminSection>
  );
}
