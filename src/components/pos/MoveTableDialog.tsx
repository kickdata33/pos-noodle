"use client";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Table } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentTableName: string | null;
  /** Active tables that currently have no open order — the only valid move targets. Computed by
   * the caller (`OrderScreen`) from the same `orderRepository.subscribeOpenForShop` list the POS
   * home grid uses for occupancy, so "empty" here means exactly what "ว่าง" means on that grid. */
  emptyTables: Table[];
  onConfirm: (table: Table) => void;
}

/**
 * Moves a saved, still-open dine-in order to a different (currently empty) table — e.g. a
 * customer asks to switch seats mid-meal. Only ever offered for an already-persisted order with
 * a table (`OrderScreen`'s guard); a takeaway/Grab/etc. order or an unsaved draft has no table to
 * move from. Only *empty* tables are offered — moving onto an occupied one would silently merge
 * two unrelated bills together, which is never what "ย้ายโต๊ะ" means here (that's a distinct,
 * unbuilt "merge bills" feature, not this one).
 *
 * Not a reason-gated action like item removal/cancellation (item 18-19) — nothing about the bill
 * itself changes, only which table it's attached to — but it still writes an `ORDER_TABLE_MOVED`
 * audit log entry (see `OrderScreen.confirmMoveTable`) so "why is table 3 empty but table 5 has
 * an old total" is always traceable after the fact.
 */
export function MoveTableDialog({ open, onOpenChange, currentTableName, emptyTables, onConfirm }: Props) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>ย้ายโต๊ะ {currentTableName ? `จากโต๊ะ ${currentTableName}` : ""}</DialogTitle>
        </DialogHeader>

        <div className="grid gap-2">
          <p className="text-sm text-muted-foreground">เลือกโต๊ะว่างที่จะย้ายบิลนี้ไป — บิล/รายการทั้งหมดย้ายตามไปด้วย</p>
          {emptyTables.length === 0 ? (
            <p className="rounded-lg border border-border p-3 text-sm text-muted-foreground">
              ตอนนี้ไม่มีโต๊ะว่างให้ย้าย
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {emptyTables.map((table) => (
                <button
                  key={table.id}
                  type="button"
                  onClick={() => onConfirm(table)}
                  className="rounded-lg border border-border bg-card px-3 py-3 text-center font-medium hover:bg-accent"
                >
                  {table.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            ปิด
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
