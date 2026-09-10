"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import type { AuditReason } from "@/types";

const REASONS: AuditReason[] = ["กดผิด", "ลูกค้ายกเลิก", "ทำผิด", "อื่น ๆ"];

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orderNumber: string;
  onConfirm: (reason: AuditReason, note: string) => void;
}

/**
 * Cancels a whole *saved* order (item: an order emptied out via line-by-line removal left the
 * table stuck "occupied" on the POS home grid forever, since the table's occupancy is derived
 * from any `status: "OPEN"` order for it — see `orderRepository.subscribeOpenForShop` — even
 * one with zero items). Confirming here sets the order to `CANCELLED` (freeing the table
 * immediately, same as a paid checkout does) and writes an `auditLogs` entry, mirroring
 * `RemoveItemDialog`'s reason-gate for item removal (item 18–19) since cancelling an entire
 * order is at least as significant as removing one line from it.
 *
 * Only ever shown for an order that's already been saved (`order.id` exists) — a draft that was
 * never saved has nothing to cancel, staff just navigate away (see `OrderScreen`'s cancel button
 * guard).
 */
export function CancelOrderDialog({ open, onOpenChange, orderNumber, onConfirm }: Props) {
  const [reason, setReason] = useState<AuditReason | null>(null);
  const [note, setNote] = useState("");

  function handleConfirm() {
    if (!reason) return;
    onConfirm(reason, note.trim());
    setReason(null);
    setNote("");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ยกเลิกออเดอร์ {orderNumber} — เลือกเหตุผล</DialogTitle>
        </DialogHeader>

        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">
            ออเดอร์นี้จะถูกยกเลิกทั้งหมด และโต๊ะ/ช่องทางนี้จะว่างทันที — ทำแล้วกู้คืนไม่ได้
          </p>
          {REASONS.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => setReason(r)}
              className={
                "rounded-lg border px-4 py-3 text-left " +
                (reason === r ? "border-primary bg-primary/10" : "border-border bg-card hover:bg-accent")
              }
            >
              {r}
            </button>
          ))}
          {reason === "อื่น ๆ" ? (
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="ระบุเหตุผล"
              autoFocus
            />
          ) : null}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ปิด
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!reason || (reason === "อื่น ๆ" && note.trim() === "")}
          >
            ยืนยันยกเลิกออเดอร์
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
