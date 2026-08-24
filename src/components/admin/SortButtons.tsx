"use client";

import { ChevronDown, ChevronUp } from "lucide-react";

import { Button } from "@/components/ui/button";

export function SortButtons({
  disabledUp,
  disabledDown,
  onUp,
  onDown,
}: {
  disabledUp: boolean;
  disabledDown: boolean;
  onUp: () => void;
  onDown: () => void;
}) {
  return (
    <div className="flex flex-col">
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={disabledUp}
        onClick={onUp}
        aria-label="เลื่อนขึ้น"
      >
        <ChevronUp className="size-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6"
        disabled={disabledDown}
        onClick={onDown}
        aria-label="เลื่อนลง"
      >
        <ChevronDown className="size-4" />
      </Button>
    </div>
  );
}
