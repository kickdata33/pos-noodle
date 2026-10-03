import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** Consistent page header for every /admin/* section: title, short description, add button. */
export function AdminSection({
  title,
  description,
  actionLabel,
  onAction,
  extraActions,
  children,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  /** Optional extra buttons rendered before the main action (e.g. Tables' "สร้างหลายโต๊ะ" bulk-
   * create, alongside its regular "+ เพิ่มโต๊ะ") — every other page just omits this and gets the
   * exact same header as before. */
  extraActions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {extraActions}
          {actionLabel && onAction ? (
            <Button size="sm" onClick={onAction}>
              {actionLabel}
            </Button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  );
}
