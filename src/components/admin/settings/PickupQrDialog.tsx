"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/**
 * QR code for the self-order takeaway link (`/order/pickup`) — one QR for the whole counter, not
 * per-table (contrast `TableQrDialog`). Same "draw entirely in the browser via `qrcode`, no
 * external QR-image service" approach as that dialog.
 */
export function PickupQrDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const url = open && typeof window !== "undefined" ? `${window.location.origin}/order/pickup` : "";

  useEffect(() => {
    if (!open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- synchronizing with the `qrcode` canvas draw below, not deriving from props; see TableQrDialog's identical comment
      setDataUrl(null);
      return;
    }
    let cancelled = false;
    QRCode.toDataURL(`${window.location.origin}/order/pickup`, { width: 480, margin: 2 }).then((result) => {
      if (!cancelled) setDataUrl(result);
    });
    return () => {
      cancelled = true;
    };
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>QR สั่งกลับบ้าน</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col items-center gap-3">
          {dataUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- a locally-generated data: URL, not a remote image Next's optimizer should handle
            <img src={dataUrl} alt="QR โค้ดสั่งกลับบ้าน" className="h-60 w-60 rounded-lg border border-border" />
          ) : (
            <div className="flex h-60 w-60 items-center justify-center rounded-lg border border-border text-sm text-muted-foreground">
              กำลังสร้าง QR...
            </div>
          )}
          <p className="break-all text-center text-xs text-muted-foreground">{url}</p>
          <p className="text-center text-sm text-muted-foreground">
            พิมพ์แล้ววางไว้ที่หน้าร้าน/เคาน์เตอร์ — ลูกค้าสแกนแล้วสั่งกลับบ้านเองได้ทันที ไม่ต้อง login
          </p>
        </div>

        <DialogFooter>
          {dataUrl ? (
            <a href={dataUrl} download="qr-สั่งกลับบ้าน.png">
              <Button variant="outline">ดาวน์โหลด</Button>
            </a>
          ) : null}
          <Button onClick={() => onOpenChange(false)}>ปิด</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
