"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const NAV_ITEMS = [
  { href: "/superadmin", label: "คำขอสมัคร" },
  { href: "/superadmin/subscriptions", label: "สถานะร้าน / บิล" },
  { href: "/superadmin/billing-config", label: "ตั้งค่าราคา" },
];

/**
 * Shared tab bar across the superadmin console's three authenticated pages — see
 * `app/superadmin/layout.tsx`'s own comment for why this exists (feedback: "ไม่ควรแยกหลายลิงก์
 * จำไม่ได้" — each page used to be an unlinked island reachable only by typing/remembering its
 * URL directly).
 */
export function SuperadminNav() {
  const pathname = usePathname();
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await fetch("/api/superadmin/login", { method: "DELETE" });
      router.push("/superadmin/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  return (
    <nav className="sticky top-0 z-10 flex flex-wrap items-center justify-between gap-2 border-b border-border bg-card px-4 py-2 sm:px-6">
      <div className="flex flex-wrap gap-1">
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/superadmin" ? pathname === "/superadmin" : pathname?.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                active ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-accent"
              )}
            >
              {item.label}
            </Link>
          );
        })}
      </div>
      <Button size="sm" variant="ghost" disabled={loggingOut} onClick={logout}>
        {loggingOut ? "กำลังออก..." : "ออกจากระบบ"}
      </Button>
    </nav>
  );
}
