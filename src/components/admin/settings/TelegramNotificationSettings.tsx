"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";

/**
 * Self-contained (own fetch/save, not part of `ShopSettings`) because the bot token lives in the
 * server-only `notificationSettings` collection, never in the client-readable `ShopSettings`
 * doc this page otherwise edits directly via the Firestore client SDK — see
 * `notificationSettings.ts`'s comment for why. Every read/write here goes through
 * `/api/admin/notifications` instead.
 */
export function TelegramNotificationSettings() {
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [chatId, setChatId] = useState("");
  const [hasToken, setHasToken] = useState(false);
  const [tokenInput, setTokenInput] = useState("");
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    fetch("/api/admin/notifications")
      .then((res) => res.json())
      .then((data: { enabled: boolean; telegramChatId: string; hasToken: boolean }) => {
        setEnabled(data.enabled);
        setChatId(data.telegramChatId);
        setHasToken(data.hasToken);
        setLoading(false);
      });
  }, []);

  async function handleSave() {
    setSaving(true);
    setMessage(null);
    try {
      await fetch("/api/admin/notifications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, telegramChatId: chatId, telegramBotToken: tokenInput || undefined }),
      });
      if (tokenInput) {
        setHasToken(true);
        setTokenInput("");
      }
      setMessage({ ok: true, text: "บันทึกแล้ว" });
    } catch {
      setMessage({ ok: false, text: "บันทึกไม่สำเร็จ" });
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/notifications/test", { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; error?: string };
      setMessage(res.ok ? { ok: true, text: "ส่งข้อความทดสอบแล้ว เช็คที่แชท Telegram" } : { ok: false, text: data.error ?? "ส่งไม่สำเร็จ" });
    } catch {
      setMessage({ ok: false, text: "เชื่อมต่อไม่ได้" });
    } finally {
      setTesting(false);
    }
  }

  if (loading) return null;

  return (
    <div className="rounded-lg border border-border p-4">
      <div className="mb-3 flex items-center justify-between">
        <div>
          <p className="font-medium">แจ้งเตือนผ่าน Telegram</p>
          <p className="text-sm text-muted-foreground">บิลชำระเงินแล้ว บิลรอตรวจสอบ บิลยกเลิก และสรุปยอดทุกตี 4</p>
        </div>
        <Switch checked={enabled} onCheckedChange={setEnabled} />
      </div>

      <details className="mb-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">ยังไม่มีบอท? วิธีสร้าง (ทำครั้งเดียว)</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-4">
          <li>เปิดแอป Telegram ค้นหา @BotFather แล้วเริ่มแชท</li>
          <li>พิมพ์ /newbot แล้วตั้งชื่อบอทตามที่ถาม จะได้ &quot;Bot Token&quot; มา (เก็บไว้ ห้ามให้คนอื่น)</li>
          <li>สร้างกลุ่ม Telegram (หรือใช้แชทส่วนตัวกับบอทก็ได้) แล้วเพิ่มบอทเข้ากลุ่ม</li>
          <li>
            หา &quot;Chat ID&quot;: ส่งข้อความอะไรก็ได้ในกลุ่มนั้น แล้วเปิด
            https://api.telegram.org/bot&lt;BOT_TOKEN&gt;/getUpdates ในเบราว์เซอร์ — จะเห็นเลข chat id ในผลลัพธ์
          </li>
          <li>เอา Bot Token กับ Chat ID มาใส่ด้านล่างนี้ แล้วกด &quot;ทดสอบส่งข้อความ&quot;</li>
        </ol>
      </details>

      <div className="grid gap-3">
        <div className="grid gap-1">
          <Label htmlFor="tg-token">Bot Token</Label>
          <Input
            id="tg-token"
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder={hasToken ? "ตั้งไว้แล้ว — ใส่ใหม่เฉพาะตอนต้องการเปลี่ยน" : "เช่น 123456:AAExxxxxxxxxxxxxxxxxxxxxxx"}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="tg-chat">Chat ID</Label>
          <Input id="tg-chat" value={chatId} onChange={(e) => setChatId(e.target.value)} placeholder="เช่น -1001234567890" />
        </div>

        {message ? (
          <p className={message.ok ? "text-sm text-success" : "text-sm text-destructive"}>{message.text}</p>
        ) : null}

        <div className="flex gap-2">
          <Button size="sm" onClick={handleSave} disabled={saving}>
            บันทึก
          </Button>
          <Button size="sm" variant="outline" onClick={handleTest} disabled={testing || !hasToken}>
            ทดสอบส่งข้อความ
          </Button>
        </div>
        {!hasToken ? <p className="text-xs text-muted-foreground">กด &quot;บันทึก&quot; ก่อน ถึงจะกดทดสอบได้</p> : null}
      </div>
    </div>
  );
}
