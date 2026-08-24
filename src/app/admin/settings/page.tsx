"use client";

import { useEffect, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { shopRepository } from "@/repositories/shopRepository";
import type { ShopSettings } from "@/types";

/**
 * Shop Settings (item 16) — every field an Admin should be able to change without touching
 * code (item 34). `name` here is the live, editable value; the string in the spec
 * ("ร้านลูกชิ้นแชมป์ x นายฮังเพ้ง") only ever exists as the seed script's default (item 16, 34)
 * — this page is the only place that value can change from here on.
 */
export default function SettingsPage() {
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    shopRepository.getSettings(DEFAULT_SHOP_ID).then((s) => {
      setSettings(s);
      setLoading(false);
    });
  }, []);

  function update<K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      const { id: _id, ...data } = settings;
      void _id;
      await shopRepository.setSettings(DEFAULT_SHOP_ID, { ...data, updatedAt: Date.now() });
      setSavedAt(Date.now());
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AdminSection title="ตั้งค่าร้าน">
        <p className="text-muted-foreground">กำลังโหลด...</p>
      </AdminSection>
    );
  }

  if (!settings) {
    return (
      <AdminSection title="ตั้งค่าร้าน">
        <p className="text-muted-foreground">
          ไม่พบข้อมูลตั้งค่าร้าน — รัน <code>npm run seed</code> ก่อนเพื่อสร้างค่าเริ่มต้น
        </p>
      </AdminSection>
    );
  }

  return (
    <AdminSection title="ตั้งค่าร้าน" description="ข้อมูลทั้งหมดที่นี่แก้ได้เสมอ ไม่ผูกกับโค้ด">
      <div className="grid max-w-xl gap-5">
        <div className="grid gap-2">
          <Label htmlFor="s-name">ชื่อร้าน</Label>
          <Input id="s-name" value={settings.name} onChange={(e) => update("name", e.target.value)} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="s-logo">Logo URL</Label>
          <Input
            id="s-logo"
            value={settings.logoUrl ?? ""}
            onChange={(e) => update("logoUrl", e.target.value || null)}
            placeholder="https://..."
          />
          <p className="text-xs text-muted-foreground">
            อัปโหลดไฟล์โดยตรงยังไม่รองรับในเวอร์ชันนี้ — ใส่ลิงก์รูปที่มีอยู่แล้วแทน
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="s-phone">เบอร์โทร</Label>
          <Input id="s-phone" value={settings.phone} onChange={(e) => update("phone", e.target.value)} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="s-address">ที่อยู่</Label>
          <Textarea
            id="s-address"
            value={settings.address}
            onChange={(e) => update("address", e.target.value)}
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="s-tax">เลขประจำตัวผู้เสียภาษี</Label>
          <Input id="s-tax" value={settings.taxId} onChange={(e) => update("taxId", e.target.value)} />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="s-footer">ข้อความท้ายใบเสร็จ</Label>
          <Textarea
            id="s-footer"
            value={settings.receiptFooterText}
            onChange={(e) => update("receiptFooterText", e.target.value)}
            placeholder="เช่น ขอบคุณที่อุดหนุนครับ"
          />
        </div>

        <div className="grid gap-2">
          <Label htmlFor="s-currency">สกุลเงิน (ISO code)</Label>
          <Input
            id="s-currency"
            value={settings.currency}
            onChange={(e) => update("currency", e.target.value.toUpperCase())}
            maxLength={3}
            className="w-24"
          />
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="font-medium">คิด VAT</p>
            <p className="text-sm text-muted-foreground">เปิดแล้วตั้งอัตรา % ด้านล่าง</p>
          </div>
          <Switch
            checked={settings.vatEnabled}
            onCheckedChange={(v) => update("vatEnabled", v)}
          />
        </div>
        {settings.vatEnabled ? (
          <div className="grid gap-2">
            <Label htmlFor="s-vat-rate">อัตรา VAT (%)</Label>
            <Input
              id="s-vat-rate"
              type="number"
              className="w-32"
              value={settings.vatRate}
              onChange={(e) => update("vatRate", Number(e.target.value) || 0)}
            />
          </div>
        ) : null}

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="font-medium">คิด Service Charge</p>
            <p className="text-sm text-muted-foreground">เปิดแล้วตั้งอัตรา % ด้านล่าง</p>
          </div>
          <Switch
            checked={settings.serviceChargeEnabled}
            onCheckedChange={(v) => update("serviceChargeEnabled", v)}
          />
        </div>
        {settings.serviceChargeEnabled ? (
          <div className="grid gap-2">
            <Label htmlFor="s-sc-rate">อัตรา Service Charge (%)</Label>
            <Input
              id="s-sc-rate"
              type="number"
              className="w-32"
              value={settings.serviceChargeRate}
              onChange={(e) => update("serviceChargeRate", Number(e.target.value) || 0)}
            />
          </div>
        ) : null}

        <div className="flex items-center gap-3">
          <Button onClick={handleSave} disabled={saving}>
            บันทึกการตั้งค่า
          </Button>
          {savedAt ? <span className="text-sm text-muted-foreground">บันทึกแล้ว</span> : null}
        </div>
      </div>
    </AdminSection>
  );
}
