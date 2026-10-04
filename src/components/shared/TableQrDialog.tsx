"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Table } from "@/types";

function buildUrl(tableId: string, token?: string | null): string {
  const base = `${window.location.origin}/order/table/${tableId}`;
  return token ? `${base}?s=${encodeURIComponent(token)}` : base;
}

/**
 * QR code for one table's self-order link — printed/placed on the table for customers to scan.
 * Generated entirely in the browser (`qrcode` npm package draws to a `<canvas>`), no external
 * QR-image API call, matching this project's preference for not depending on network services
 * that don't need to be there.
 *
 * Shared between `/admin/tables` and the POS floor view (`PosHome`) — moved out of `admin/`
 * once the POS side also needed it (item: "ลูกค้าแอบถ่ายรูป QR แล้วสั่งทีหลังได้ไหม"), since seating a
 * party and handing them a QR is a day-to-day staff task, not an admin-only one.
 *
 * Branches on `table.qrMode`:
 * - `"static"` (or unset — every table before this field existed): unchanged original
 *   behavior — a permanent link, shown immediately, no server round trip.
 * - `"session"`: the link needs the table's *current* one-time token (`?s=`). If one's already
 *   active (`table.sessionToken`, kept live by the caller's subscription), that QR is shown
 *   immediately; either way, "สร้าง QR ใหม่" asks the server for a fresh token — which
 *   invalidates whatever QR was printed before, including one a customer may have photographed.
 */
export function TableQrDialog({ table, onOpenChange }: { table: Table | null; onOpenChange: (open: boolean) => void }) {
  const sessionMode = table?.qrMode === "session";
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [url, setUrl] = useState<string>("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function renderQr(targetUrl: string) {
    setUrl(targetUrl);
    const result = await QRCode.toDataURL(targetUrl, { width: 480, margin: 2 });
    setDataUrl(result);
  }

  useEffect(() => {
    // Resetting UI state to match a new/closed `table` prop (or its live `sessionToken`
    // changing underneath us) — synchronizing with the external QR-canvas draw below, same
    // reasoning the original dialog this was built from already documented for `setDataUrl`.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setError(null);
    if (!table) {
      // Dialog just closed (or hasn't opened yet) — clear the previous table's image so a
      // re-open of a *different* table never flashes the old QR before the new one renders.
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    if (sessionMode) {
      // Already-active token (live from the caller's subscription) → show it immediately, no
      // API call. No active token → nothing to show yet until staff taps "สร้าง QR ใหม่" below.
      if (table.sessionToken) {
        renderQr(buildUrl(table.id, table.sessionToken)).catch(() => {
          if (!cancelled) setError("สร้าง QR ไม่สำเร็จ");
        });
      } else {
        setDataUrl(null);
      }
    } else {
      renderQr(buildUrl(table.id)).catch(() => {
        if (!cancelled) setError("สร้าง QR ไม่สำเร็จ");
      });
    }
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-runs on table identity + its live sessionToken, not `sessionMode`/`renderQr` (derived from `table`, not independent inputs)
  }, [table?.id, table?.sessionToken, sessionMode]);

  async function generateNew() {
    if (!table) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/pos/tables/${table.id}/open-session`, { method: "POST" });
      const data = (await res.json()) as { ok?: boolean; token?: string; error?: string };
      if (!res.ok || !data.ok || !data.token) {
        setError(data.error ?? "สร้าง QR ไม่สำเร็จ");
        return;
      }
      await renderQr(buildUrl(table.id, data.token));
    } catch {
      setError("สร้าง QR ไม่สำเร็จ กรุณาลองใหม่");
    } finally {
      setGenerating(false);
    }
  }

  return (
    <Dialog open={Boolean(table)} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>QR สั่งอาหาร — {table?.name}</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a locally-generated data: URL, not a remote image Next's optimizer should handle
            <img src={dataUrl} alt={`QR โค้ดสั่งอาหารสำหรับ ${table?.name}`} className="h-60 w-60 rounded-lg border border-border" />
          ) : (
            <div className="flex h-60 w-60 items-center justify-center rounded-lg border border-border p-4 text-center text-sm text-muted-foreground">
              {sessionMode ? "โต๊ะนี้ยังไม่เปิดรับออเดอร์ QR — กด \"สร้าง QR ใหม่\" ด้านล่าง" : "กำลังสร้าง QR..."}
            </div>
          )}
          {dataUrl ? <p className="break-all text-center text-xs text-muted-foreground">{url}</p> : null}
          {error ? <p className="text-center text-sm text-destructive">{error}</p> : null}

          {sessionMode ? (
            <>
              <p className="text-center text-sm text-muted-foreground">
                QR แบบเปลี่ยนใหม่ทุกรอบ — ใช้ได้จนกว่าจะเช็คบิล/ยกเลิกบิลโต๊ะนี้ จากนั้นต้องกดสร้างใหม่ให้ลูกค้ารอบถัดไป
              </p>
              <Button variant="outline" onClick={generateNew} disabled={generating}>
                {generating ? "กำลังสร้าง..." : "สร้าง QR ใหม่"}
              </Button>
            </>
          ) : (
            <p className="text-center text-sm text-muted-foreground">
              พิมพ์แล้ววางไว้ที่โต๊ะ — ลูกค้าสแกนแล้วสั่งอาหารเข้าบิลโต๊ะนี้ได้ทันที ไม่ต้อง login
            </p>
          )}
        </div>

        <DialogFooter>
          {dataUrl ? (
            <a href={dataUrl} download={`qr-${table?.name}.png`}>
              <Button variant="outline">ดาวน์โหลด</Button>
            </a>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>ปิด</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
