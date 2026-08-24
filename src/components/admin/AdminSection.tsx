import type { ReactNode } from "react";

import { Button } from "@/components/ui/button";

/** Consistent page header for every /admin/* section: title, short description, add button. */
export function AdminSection({
  title,
  description,
  actionLabel,
  onAction,
  children,
}: {
  title: string;
  description?: string;
  actionLabel?: string;
  onAction?: () => void;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          {description ? <p className="mt-1 text-sm text-muted-foreground">{description}</p> : null}
        </div>
        {actionLabel && onAction ? (
          <Button size="sm" onClick={onAction}>
            {actionLabel}
          </Button>
        ) : null}
      </div>
      {children}
    </div>
  );
}
