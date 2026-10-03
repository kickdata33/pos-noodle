"use client";

import { useEffect, useState } from "react";

import { useAuth } from "@/hooks/useAuth";
import { shopRepository } from "@/repositories/shopRepository";
import { type EnabledModules, resolveEnabledModules } from "@/lib/shop/modules";

/**
 * Which optional Admin modules (`lib/shop/modules.ts`) the signed-in user's shop has enabled.
 * `modules` is `null` while loading — callers should treat that as "don't know yet" rather than
 * "all disabled", so a gated page doesn't flash a redirect before its shop's real settings load.
 *
 * One-time fetch, same as every other `/admin` page's own `shopRepository.getSettings` call
 * (`ShopSettings` has no live-subscribe method — see `PosCatalogContext`'s identical comment).
 */
export function useEnabledModules(): { modules: EnabledModules | null; loading: boolean } {
  const { appUser } = useAuth();
  const [modules, setModules] = useState<EnabledModules | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const shopId = appUser?.shopId;
    if (!shopId) return;
    let cancelled = false;
    shopRepository.getSettings(shopId).then((settings) => {
      if (cancelled) return;
      setModules(resolveEnabledModules(settings?.enabledModules));
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [appUser?.shopId]);

  return { modules, loading };
}
