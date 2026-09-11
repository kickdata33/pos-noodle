"use client";

import { useEffect, useState } from "react";

import { AdminSection } from "@/components/admin/AdminSection";
import { PickupQrDialog } from "@/components/admin/settings/PickupQrDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/hooks/useAuth";
import { printReceiptViaEpos } from "@/lib/pos/eposPrint";
import { buildOrderReceipt } from "@/lib/pos/receipt";
import { shopRepository } from "@/repositories/shopRepository";
import type { Order, ShopSettings } from "@/types";

/**
 * Shop Settings (item 16) — every field an Admin should be able to change without touching
 * code (item 34). `name` here is the live, editable value; the string in the spec
 * ("ร้านลูกชิ้นแชมป์ x นายฮังเพ้ง") only ever exists as the seed script's default (item 16, 34)
 * — this page is the only place that value can change from here on.
 */
export default function SettingsPage() {
  const { appUser } = useAuth();
  const shopId = appUser?.shopId;
  const [settings, setSettings] = useState<ShopSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [pickupQrOpen, setPickupQrOpen] = useState(false);
  const [testPrinting, setTestPrinting] = useState(false);
  const [testPrintResult, setTestPrintResult] = useState<{ ok: boolean; message: string } | null>(null);

  useEffect(() => {
    if (!shopId) return;
    shopRepository.getSettings(shopId).then((s) => {
      // Backfill for a settings doc saved before this feature existed — normalized here, at the
      // moment it enters local state, so an unrelated save elsewhere on this page never writes
      // back `undefined` for these fields (Firestore's client SDK rejects that outright).
      setSettings(
        s
          ? {
              ...s,
              promptPayId: s.promptPayId ?? null,
              pickupIdentificationMode: s.pickupIdentificationMode ?? "queue",
              receiptPrinterIp: s.receiptPrinterIp ?? null,
            }
          : s
      );
      setLoading(false);
    });
  }, [shopId]);

  function update<K extends keyof ShopSettings>(key: K, value: ShopSettings[K]) {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  }

  /**
   * Sends a sample receipt straight to the configured printer — the fastest way to confirm the
   * IP/network setup actually works before relying on it at checkout (item: this shop hasn't
   * bought its printer yet, so this is also the first real smoke test of `eposPrint.ts` once
   * they do). Builds a fake `Order` locally rather than requiring a real one just to test
   * connectivity.
   */
  async function handleTestPrint() {
    if (!settings?.receiptPrinterIp) return;
    setTestPrinting(true);
    setTestPrintResult(null);
    try {
      const now = Date.now();
      const sampleOrder: Order = {
        id: "test",
        orderNumber: "TEST-0000",
        shopId: settings.shopId,
        orderType: "dineIn",
        channelId: "test",
        channelName: "ทดสอบ",
        tableId: "test",
        tableName: "ทดสอบ",
        status: "PAID",
        items: [
          {
            id: "test-item",
            productId: "test-product",
            productName: "รายการทดสอบ",
            quantity: 1,
            unitPrice: 10,
            modifiers: [],
            note: "",
            lineTotal: 10,
          },
        ],
        subtotal: 10,
        discount: 0,
        serviceCharge: 0,
        tax: 0,
        total: 10,
        paymentStatus: "PAID",
        paymentMethodId: "test",
        paymentMethodName: "ทดสอบ",
        cashReceived: 10,
        changeDue: 0,
        createdBy: "test",
        createdByName: "ทดสอบระบบ",
        createdAt: now,
        updatedAt: now,
        paidAt: now,
      };
      const result = await printReceiptViaEpos(settings.receiptPrinterIp, buildOrderReceipt(sampleOrder, settings));
      setTestPrintResult(
        result.ok ? { ok: true, message: "ส่งงานพิมพ์แล้ว — เช็คที่เครื่องพิมพ์" } : { ok: false, message: result.error ?? "พิมพ์ไม่สำเร็จ" }
      );
    } finally {
      setTestPrinting(false);
    }
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    try {
      const { id: _id, ...data } = settings;
      void _id;
      await shopRepository.setSettings(settings.shopId, { ...data, updatedAt: Date.now() });
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
          <Label htmlFor="s-printer-ip">IP เครื่องพิมพ์ใบเสร็จ (เครือข่าย/LAN)</Label>
          <div className="flex gap-2">
            <Input
              id="s-printer-ip"
              value={settings.receiptPrinterIp ?? ""}
              onChange={(e) => update("receiptPrinterIp", e.target.value.trim() || null)}
              placeholder="เช่น 192.168.1.50"
              className="max-w-xs"
            />
            <Button
              type="button"
              variant="outline"
              onClick={handleTestPrint}
              disabled={!settings.receiptPrinterIp || testPrinting}
            >
              {testPrinting ? "กำลังพิมพ์..." : "ทดสอบพิมพ์"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            รองรับเครื่องพิมพ์ที่มี ePOS-Print (เช่น EPSON TM-m30II / TM-T82III รุ่น Ethernet/WiFi) — ตั้ง IP ให้เครื่องพิมพ์คงที่แล้วใส่ที่นี่
            ใบเสร็จจะพิมพ์อัตโนมัติทุกครั้งที่กด &quot;คิดเงิน&quot; เสร็จ ถ้าเว้นว่างจะไม่พิมพ์
          </p>
          {testPrintResult ? (
            <p className={"text-sm " + (testPrintResult.ok ? "text-success" : "text-destructive")}>
              {testPrintResult.message}
            </p>
          ) : null}
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

        <div className="grid gap-2">
          <Label htmlFor="s-promptpay">PromptPay ID (เบอร์โทรหรือเลขประจำตัวผู้เสียภาษี)</Label>
          <Input
            id="s-promptpay"
            value={settings.promptPayId ?? ""}
            onChange={(e) => update("promptPayId", e.target.value.trim() || null)}
            placeholder="เช่น 0812345678"
          />
          <p className="text-xs text-muted-foreground">
            ใส่แล้วหน้าสั่งกลับบ้าน (สแกน QR เอง) จะมีตัวเลือก &quot;โอนพร้อมเพย์&quot; ให้ลูกค้า — ถ้าเว้นว่างจะมีแต่ &quot;เงินสด&quot;
          </p>
        </div>

        <div className="grid gap-2">
          <Label htmlFor="s-pickup-id-mode">ระบุตัวลูกค้าออเดอร์กลับบ้าน (สแกน QR เอง) แบบไหน</Label>
          <Select
            value={settings.pickupIdentificationMode}
            onValueChange={(v) => update("pickupIdentificationMode", v as "queue" | "name")}
          >
            <SelectTrigger id="s-pickup-id-mode" className="w-64">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="queue">ออกเลขคิวอัตโนมัติ (เช่น คิว 12)</SelectItem>
              <SelectItem value="name">ให้ลูกค้ากรอกชื่อ</SelectItem>
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground">สลับได้ตลอด ไม่กระทบออเดอร์เก่าที่สั่งไปแล้ว</p>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-border p-4">
          <div>
            <p className="font-medium">QR สั่งกลับบ้าน</p>
            <p className="text-sm text-muted-foreground">QR เดียวสำหรับทั้งร้าน — พิมพ์วางไว้ที่เคาน์เตอร์</p>
          </div>
          <Button variant="outline" onClick={() => setPickupQrOpen(true)}>
            แสดง QR
          </Button>
        </div>
        <PickupQrDialog open={pickupQrOpen} onOpenChange={setPickupQrOpen} />

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
