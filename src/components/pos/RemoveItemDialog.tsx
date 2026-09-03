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
  itemName: string;
  onConfirm: (reason: AuditReason, note: string) => void;
}

/**
 * Only shown for a line already persisted to Firestore (item 18: before the first save, removal
 * is free). Confirming here both removes the line and writes an `auditLogs` entry (item 19).
 */
export function RemoveItemDialog({ open, onOpenChange, itemName, onConfirm }: Props) {
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
          <DialogTitle>ลบ &quot;{itemName}&quot; — เลือกเหตุผล</DialogTitle>
        </DialogHeader>

        <div className="grid gap-2">
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
            ยกเลิก
          </Button>
          <Button
            variant="destructive"
            onClick={handleConfirm}
            disabled={!reason || (reason === "อื่น ๆ" && note.trim() === "")}
          >
            ยืนยันลบ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
