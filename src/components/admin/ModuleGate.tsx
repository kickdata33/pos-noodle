"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

import { useEnabledModules } from "@/hooks/useEnabledModules";
import type { ShopModuleKey } from "@/lib/shop/modules";

/**
 * Server-side route guard would need Proxy/layout plumbing that doesn't exist for a single
 * nested page today (see `src/app/admin/layout.tsx`'s comment on why `/admin` itself is the
 * role gate); this is the page-level equivalent for the four shop-specific modules
 * (`lib/shop/modules.ts`) — defense in depth so a shop that doesn't have a module enabled can't
 * reach it just by typing the URL, even though `AdminNav` already hides the link.
 *
 * Renders nothing while the shop's modules are still loading or once a redirect is underway, so
 * a disabled module's page never flashes its content before bouncing back to `/admin`.
 */
export function ModuleGate({ module, children }: { module: ShopModuleKey; children: React.ReactNode }) {
  const { modules, loading } = useEnabledModules();
  const router = useRouter();
  const allowed = modules?.[module] ?? false;

  useEffect(() => {
    if (!loading && modules && !allowed) router.replace("/admin");
  }, [loading, modules, allowed, router]);

  if (loading || !modules || !allowed) return null;
  return <>{children}</>;
}
