import { printTableQr } from "@/lib/pos/printQueue";
import type { AppUser, ShopSettings, Table } from "@/types";

/**
 * One-tap "พิมพ์ QR" for a table (item: "เลือกโต๊ะ แล้วกดปริ้น QR ได้เลย"): works out the table's
 * ordering link — asking the server for its session token when the table uses `qrMode:
 * "session"`, reusing the active one if there is one — and queues the slip at the cashier Print
 * Station. Throws a message suitable for showing to staff.
 */
export async function printQrForTable(
  table: Pick<Table, "id" | "name" | "qrMode">,
  settings: Pick<ShopSettings, "name">,
  user: Pick<AppUser, "id" | "shopId">
): Promise<void> {
  const sessionMode = table.qrMode === "session";
  let url = `${window.location.origin}/order/table/${table.id}`;
  if (sessionMode) {
    const res = await fetch(`/api/pos/tables/${table.id}/open-session?reuse=1`, { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; token?: string; error?: string };
    if (!res.ok || !data.ok || !data.token) throw new Error(data.error ?? "สร้าง QR ไม่สำเร็จ");
    url += `?s=${encodeURIComponent(data.token)}`;
  }
  await printTableQr(user.shopId, { shopName: settings.name, tableName: table.name, url, sessionMode }, user.id);
}
