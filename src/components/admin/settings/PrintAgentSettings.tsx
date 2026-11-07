"use client";

import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/useAuth";
import { formatTime } from "@/lib/format";
import { AGENT_OFFLINE_MS } from "@/lib/pos/printHealth";
import { printAgentRepository } from "@/repositories/printJobRepository";
import type { PrintAgent, PrintStation } from "@/types";

const STATION_LABEL: Record<PrintStation, string> = { cashier: "แคชเชียร์", kitchen: "ครัว" };

/**
 * Admin: background Print Agents for this shop (`print-agent/` in the repo) — the program that
 * prints from the shop PC with no browser open. Add one → get a pairing code once, plus the
 * one-line installer command for this shop; see each agent's live status; revoke a lost PC.
 */
export function PrintAgentSettings() {
  const { appUser } = useAuth();
  const [agents, setAgents] = useState<PrintAgent[]>([]);
  const [name, setName] = useState("คอมแคชเชียร์");
  const [stations, setStations] = useState<PrintStation[]>(["cashier"]);
  const [creating, setCreating] = useState(false);
  const [pairing, setPairing] = useState<{ code: string; command: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(0);

  useEffect(() => {
    if (!appUser?.shopId) return;
    return printAgentRepository.subscribeForShop(appUser.shopId, setAgents);
  }, [appUser?.shopId]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/print-agents", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, stations }),
      });
      const data = (await res.json()) as { ok?: boolean; pairingCode?: string; error?: string };
      if (!res.ok || !data.pairingCode) {
        setError(data.error ?? "สร้างไม่สำเร็จ");
        return;
      }
      setPairing({
        code: data.pairingCode,
        command: `powershell -NoProfile -ExecutionPolicy Bypass -Command "irm ${window.location.origin}/print-agent/install.ps1 | iex"`,
      });
    } catch {
      setError("สร้างไม่สำเร็จ ลองอีกครั้ง");
    } finally {
      setCreating(false);
    }
  }

  async function revoke(agent: PrintAgent) {
    if (!window.confirm(`ยกเลิกโปรแกรมพิมพ์ "${agent.name}"? คอมเครื่องนั้นจะพิมพ์ไม่ได้อีกจนกว่าจะติดตั้งใหม่`)) return;
    await fetch(`/api/admin/print-agents?id=${encodeURIComponent(agent.id)}`, { method: "DELETE" });
  }

  const active = agents.filter((a) => !a.revokedAt).sort((a, b) => a.createdAt - b.createdAt);

  return (
    <div className="grid gap-3 rounded-lg border border-border p-4">
      <div>
        <p className="font-medium">โปรแกรมพิมพ์เบื้องหลัง (แนะนำ)</p>
        <p className="text-sm text-muted-foreground">
          ติดตั้งครั้งเดียวบนคอมที่ต่อเครื่องพิมพ์ พิมพ์ได้เองแม้ปิดเบราว์เซอร์ และเปิดเองทุกครั้งที่เปิดคอม ใช้แทนหน้าสถานีพิมพ์
        </p>
      </div>

      {active.map((agent) => {
        const online = now > 0 && agent.lastSeenAt !== null && now - agent.lastSeenAt <= AGENT_OFFLINE_MS;
        return (
          <div key={agent.id} className="flex flex-wrap items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
            <span className={"h-2.5 w-2.5 rounded-full " + (online ? "bg-success" : "bg-destructive")} aria-hidden />
            <span className="font-medium">{agent.name}</span>
            <span className="text-muted-foreground">({agent.stations.map((s) => STATION_LABEL[s]).join(", ")})</span>
            <span className={online ? "text-success" : "text-destructive"}>
              {online
                ? "ออนไลน์"
                : agent.lastSeenAt
                  ? `ออฟไลน์ ตั้งแต่ ${formatTime(agent.lastSeenAt)}`
                  : "ยังไม่ได้ติดตั้ง/ยังไม่เคยเชื่อมต่อ"}
            </span>
            {Object.entries(agent.printers ?? {}).map(([station, p]) =>
              p ? (
                <span key={station} className={p.ready ? "text-muted-foreground" : "text-destructive"}>
                  · {STATION_LABEL[station as PrintStation]}: {p.name} {p.ready ? "พร้อม" : `ไม่พร้อม (${p.detail})`}
                </span>
              ) : null
            )}
            <Button size="sm" variant="ghost" className="ml-auto text-destructive" onClick={() => revoke(agent)}>
              ยกเลิก
            </Button>
          </div>
        );
      })}

      {pairing ? (
        <div className="grid gap-2 rounded-md border border-primary/40 bg-primary/5 p-3 text-sm">
          <p className="font-semibold">ติดตั้งบนคอมร้าน (รหัสนี้แสดงครั้งเดียว)</p>
          <p>1. บนคอมที่ต่อเครื่องพิมพ์ คลิกขวาปุ่ม Start → Windows PowerShell แล้ววางคำสั่งนี้ กด Enter</p>
          <Input readOnly value={pairing.command} onFocus={(e) => e.currentTarget.select()} />
          <p>2. เมื่อโปรแกรมถามรหัสเชื่อมต่อ ให้วางรหัสนี้</p>
          <Input readOnly value={pairing.code} onFocus={(e) => e.currentTarget.select()} />
          <p>3. เลือกเครื่องพิมพ์จากรายการ แล้วรอจนขึ้น “ติดตั้งเสร็จ” สถานะด้านบนจะเปลี่ยนเป็นออนไลน์</p>
          <Button size="sm" variant="outline" className="justify-self-start" onClick={() => setPairing(null)}>
            ซ่อน
          </Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
          <div className="grid gap-1">
            <Label htmlFor="agent-name">ชื่อเครื่อง</Label>
            <Input id="agent-name" value={name} onChange={(e) => setName(e.target.value)} />
          </div>
          <div className="flex gap-3 pb-2">
            {(["cashier", "kitchen"] as PrintStation[]).map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <Checkbox
                  checked={stations.includes(s)}
                  onCheckedChange={(v) =>
                    setStations((prev) => (v ? [...prev.filter((x) => x !== s), s] : prev.filter((x) => x !== s)))
                  }
                />
                {STATION_LABEL[s]}
              </label>
            ))}
          </div>
          <Button onClick={create} disabled={creating || stations.length === 0}>
            {creating ? "กำลังสร้าง..." : "เพิ่มโปรแกรมพิมพ์"}
          </Button>
          {error ? <p className="text-sm text-destructive sm:col-span-3">{error}</p> : null}
        </div>
      )}
    </div>
  );
}
