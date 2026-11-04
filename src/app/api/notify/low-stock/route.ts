import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { notifyShop } from "@/lib/notifications/notifyShop";
import { buildLowStockText, isLowStock } from "@/lib/pos/stock";
import type { StockLevel } from "@/types";

/**
 * Fired by `deductStockForPaidOrder` when a sale pushes items to/under their low threshold.
 * The client only says *which* products — the message is built from the server's own read of
 * those stock docs, filtered to the caller's shop and to items actually still low, so a client
 * can't put arbitrary text into the owner's Telegram.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { productIds?: unknown } | null;
  const productIds = Array.isArray(body?.productIds)
    ? body.productIds.filter((id): id is string => typeof id === "string").slice(0, 30)
    : [];
  if (productIds.length === 0) return NextResponse.json({ ok: true });

  const db = getAdminDb();
  const shopId = session.appUser.shopId;
  const snaps = await db.getAll(...productIds.map((id) => db.collection(COLLECTIONS.stockLevels).doc(id)));
  const low = snaps
    .filter((s) => s.exists)
    .map((s) => s.data() as Omit<StockLevel, "id">)
    .filter((l) => l.shopId === shopId && isLowStock(l));
  if (low.length > 0) await notifyShop(db, shopId, buildLowStockText(low), "stock");
  return NextResponse.json({ ok: true });
}
