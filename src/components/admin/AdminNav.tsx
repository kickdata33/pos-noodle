"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";

import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/admin", label: "ภาพรวม" },
  { href: "/admin/categories", label: "หมวดหมู่" },
  { href: "/admin/products", label: "เมนู" },
  { href: "/admin/modifiers", label: "Modifier" },
  { href: "/admin/tables", label: "โต๊ะ" },
  { href: "/admin/channels", label: "ช่องทางขาย" },
  { href: "/admin/payment-methods", label: "วิธีชำระเงิน" },
  { href: "/admin/staff", label: "พนักงาน" },
  { href: "/admin/settings", label: "ตั้งค่าร้าน" },
] as const;

export function AdminNav() {
  const pathname = usePathname();

  return (
    <nav className="flex shrink-0 flex-col gap-1 border-r border-border bg-card p-3 sm:w-52">
      {NAV_ITEMS.map((item) => {
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
