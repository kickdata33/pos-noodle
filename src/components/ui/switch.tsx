"use client";

import * as SwitchPrimitive from "@radix-ui/react-switch";
import * as React from "react";

import { cn } from "@/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-7 w-12 shrink-0 items-center rounded-full border border-transparent " +
          "transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-muted " +
          "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block size-5 translate-x-1 rounded-full bg-card shadow-sm " +
            "transition-transform data-[state=checked]:translate-x-6"
        )}
      />
    </SwitchPrimitive.Root>
  );
}

export { Switch };
