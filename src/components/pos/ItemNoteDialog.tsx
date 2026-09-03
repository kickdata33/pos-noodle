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

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  itemName: string;
  initialNote: string;
  onConfirm: (note: string) => void;
}

/**
 * The only way to attach a free-text special request (e.g. "ไม่งอก", "ไม่ผัก") to a cart line
 * that has no modifier groups configured — `ModifierPickerDialog`'s note field only appears for
 * products that have at least one modifier group attached, so a plain product had no note UI at
 * all before this. Opens from tapping "หมายเหตุ" on any cart line, saved or not, letting staff
 * add or edit a note after the fact too (no need to remove and re-add just to fix a note).
 *
 * No reset effect needed — same reasoning as `ModifierPickerDialog`: the parent only mounts
 * this component while a target line is picked (keyed by that item's id, see the JSX below), so
 * every open is a fresh mount and `note` starts clean by construction.
 */
export function ItemNoteDialog({ open, onOpenChange, itemName, initialNote, onConfirm }: Props) {
  const [note, setNote] = useState(initialNote);

  function handleConfirm() {
    onConfirm(note.trim());
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>หมายเหตุ — {itemName}</DialogTitle>
        </DialogHeader>

        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="เช่น ไม่ผัก, ไม่งอก, เผ็ดน้อย"
          autoFocus
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ยกเลิก
          </Button>
          <Button onClick={handleConfirm}>บันทึกหมายเหตุ</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
