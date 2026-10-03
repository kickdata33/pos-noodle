"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

import { useEnabledModules } from "@/hooks/useEnabledModules";
import type { ShopModuleKey } from "@/lib/shop/modules";
import { cn } from "@/lib/utils";

/**
 * `moduleKey` marks the four shop-specific modules (`lib/shop/modules.ts`) — built for this
 * app's original shop's own K SHOP wallet/Grab-LINE MAN-ShopeeFood/payroll workflow, not
 * universal POS. Everything without a `moduleKey` is core and always shown. See `ModuleGate`
 * for the matching route-level guard on each of these four pages.
 */
interface NavItem {
  href: string;
  label: string;
  moduleKey?: ShopModuleKey;
}

const NAV_ITEMS: NavItem[] = [
  { href: "/admin", label: "ภาพรวม" },
  { href: "/admin/reports", label: "รายงานสรุปยอด" },
  { href: "/admin/accounting", label: "บัญชีรายรับ-รายจ่าย", moduleKey: "accounting" },
  { href: "/admin/cash-safe", label: "ตัดเงินสดออก", moduleKey: "cashSafe" },
  { href: "/admin/delivery", label: "ยอดขาย Delivery", moduleKey: "delivery" },
  { href: "/admin/payroll", label: "เงินเดือนพนักงาน", moduleKey: "payroll" },
  { href: "/admin/orders", label: "รายการบิล" },
  { href: "/admin/categories", label: "หมวดหมู่" },
  { href: "/admin/products", label: "เมนู" },
  { href: "/admin/modifiers", label: "Modifier" },
  { href: "/admin/tables", label: "โต๊ะ" },
  { href: "/admin/channels", label: "ช่องทางขาย" },
  { href: "/admin/payment-methods", label: "วิธีชำระเงิน" },
  { href: "/admin/staff", label: "พนักงาน" },
  { href: "/admin/settings", label: "ตั้งค่าร้าน" },
];

export function AdminNav() {
  const pathname = usePathname();
  const { modules } = useEnabledModules();
  // While modules are still loading (`modules === null`), hide the gated items rather than
  // flashing them — the universal items above/below are unaffected either way.
  const items = NAV_ITEMS.filter((item) => !item.moduleKey || modules?.[item.moduleKey]);

  return (
    <nav className="flex shrink-0 flex-col gap-1 border-r border-border bg-card p-3 sm:w-52">
      {items.map((item) => {
        const active = item.href === "/admin" ? pathname === "/admin" : pathname?.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={cn(
              "rounded-md px-3 py-2 text-sm font-medium transition-colors",
              active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
