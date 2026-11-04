import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { notifyShop } from "@/lib/notifications/notifyShop";
import { buildCountSummaryText, isLowStock } from "@/lib/pos/stock";
import type { StockLevel, StockMovement } from "@/types";

/**
 * Fired by `submitStockCount` after a closing count is saved. Builds the summary from the
 * count's own movement rows (by `countId`, filtered to the caller's shop) — never from text the
 * client sends.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { countId?: unknown } | null;
  if (typeof body?.countId !== "string" || !body.countId) {
    return NextResponse.json({ error: "invalid countId" }, { status: 400 });
  }

  const db = getAdminDb();
  const shopId = session.appUser.shopId;
  const [movementSnap, levelSnap] = await Promise.all([
    db.collection(COLLECTIONS.stockMovements).where("countId", "==", body.countId).get(),
    db.collection(COLLECTIONS.stockLevels).where("shopId", "==", shopId).get(),
  ]);
  const movements = movementSnap.docs
    .map((d) => d.data() as Omit<StockMovement, "id">)
    .filter((m) => m.shopId === shopId)
    .sort((a, b) => a.productName.localeCompare(b.productName, "th"));
  if (movements.length === 0) return NextResponse.json({ ok: true });
  const low = levelSnap.docs.map((d) => d.data() as Omit<StockLevel, "id">).filter(isLowStock);

  await notifyShop(db, shopId, buildCountSummaryText(movements, low), "stock");
  return NextResponse.json({ ok: true });
}
