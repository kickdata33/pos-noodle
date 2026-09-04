"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { Table } from "@/types";

/**
 * QR code for one table's self-order link (`/order/table/[tableId]`) — printed/placed on the
 * table for customers to scan. Generated entirely in the browser (`qrcode` npm package draws to
 * a `<canvas>`), no external QR-image API call, matching this project's preference for not
 * depending on network services that don't need to be there (same reasoning as the offline
 * service-worker setup).
 */
export function TableQrDialog({ table, onOpenChange }: { table: Table | null; onOpenChange: (open: boolean) => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const url = table ? `${window.location.origin}/order/table/${table.id}` : "";

  useEffect(() => {
    if (!table) {
      // Dialog just closed (or hasn't opened yet) — clear the previous table's image so a
      // re-open of a *different* table never flashes the old QR before the new one renders.
      // This is synchronizing with an external system (the `qrcode` canvas draw below), not
      // deriving state from props, so it belongs in the effect rather than during render.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(`${window.location.origin}/order/table/${table.id}`, { width: 480, margin: 2 }).then(
      (result) => {
        if (!cancelled) setDataUrl(result);
      }
    );
    return () => {
      cancelled = true;
    };
  }, [table]);

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
            <div className="flex h-60 w-60 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
              กำลังสร้าง QR...
            </div>
          )}
          <p className="break-all text-center text-xs text-muted-foreground">{url}</p>
          <p className="text-center text-sm text-muted-foreground">
            พิมพ์แล้ววางไว้ที่โต๊ะ — ลูกค้าสแกนแล้วสั่งอาหารเข้าบิลโต๊ะนี้ได้ทันที ไม่ต้อง login
          </p>
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
