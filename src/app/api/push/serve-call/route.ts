import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { sendToShop } from "@/lib/push/webPush";
import type { ServeCall } from "@/types";

/**
 * Fans a "เรียกเสิร์ฟ" call out to every subscribed staff phone as a lock-screen notification —
 * called by the kitchen screen right after it raises the call, and again by whoever acknowledges
 * it (`event: "done"`), which replaces the alert on every phone with a quiet "รับแล้ว" note.
 * The notification text is built from the call document itself, never from the request.
 */
export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { callId?: unknown; event?: unknown } | null;
  const callId = typeof body?.callId === "string" ? body.callId : "";
  if (!callId) return NextResponse.json({ error: "missing callId" }, { status: 400 });

  const snap = await getAdminDb().collection(COLLECTIONS.serveCalls).doc(callId).get();
  if (!snap.exists) return NextResponse.json({ error: "not found" }, { status: 404 });
  const call = snap.data() as Omit<ServeCall, "id">;
  if (call.shopId !== session.appUser.shopId) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const items = call.items.map((i) => `${i.quantity}× ${i.name}`).join(", ");
  const result =
    body?.event === "done"
      ? await sendToShop(call.shopId, {
          kind: "serveCallDone",
          callId,
          title: `✅ ${call.label} มีคนรับแล้ว`,
          body: call.acknowledgedByName ? `โดย ${call.acknowledgedByName}` : items,
        })
      : await sendToShop(call.shopId, {
          kind: "serveCall",
          callId,
          title: `🔔 อาหารพร้อมเสิร์ฟ ${call.label}`,
          body: items,
        });
  return NextResponse.json({ ok: true, ...result });
}
