import { NextResponse, type NextRequest } from "next/server";

import { formatCurrency } from "@/lib/format";
import { notifyShop } from "@/lib/notifications/notifyShop";
import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";

/**
 * Fired by `OrderScreen` right after a checkout or cancel Firestore write succeeds (those writes
 * happen client-side via the Firestore client SDK — see `orderRepository` — so this is the only
 * server-side hook available to reach the shop's Telegram bot token, which must never reach the
 * browser). Called fire-and-forget (`void fetch(...)`, no `await`) the same way receipt printing
 * already is — an unreachable Telegram API is never worth delaying navigation away from the
 * order screen.
 *
 * `shopId` always comes from the caller's own session, never the request body — a client could
 * otherwise spam another shop's Telegram chat by guessing its shopId.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await request.json()) as {
    event?: "paid" | "cancelled";
    orderNumber?: string;
    total?: number;
    channelName?: string;
    tableName?: string | null;
  };

  if (body.event !== "paid" && body.event !== "cancelled") {
    return NextResponse.json({ error: "invalid event" }, { status: 400 });
  }

  const where = body.tableName ? `โต๊ะ ${body.tableName}` : body.channelName ?? "";
  const text =
    body.event === "paid"
      ? `💰 ชำระเงินแล้ว\nบิล ${body.orderNumber ?? "-"} · ${where}\nยอด ${formatCurrency(body.total ?? 0, "THB")}`
      : `❌ ยกเลิกบิล\nบิล ${body.orderNumber ?? "-"} · ${where}`;

  // Not awaited before responding — this route's own caller doesn't await it either, but this
  // still lets the request finish sending to Telegram even if the client navigates away first.
  await notifyShop(getAdminDb(), session.appUser.shopId, text);
  return NextResponse.json({ ok: true });
}
