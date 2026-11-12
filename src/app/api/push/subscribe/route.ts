import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { pushConfigured, subscriptionDocId, type StoredPushSubscription } from "@/lib/push/webPush";

/**
 * A staff phone turning "รับเรียกเสิร์ฟ" on (POST) or off (DELETE) for lock-screen notifications.
 * Stored server-side only, tied to the signed-in staff member and their shop. GET tells the page
 * whether push is set up on this deployment at all.
 */
export async function GET() {
  return NextResponse.json({ configured: pushConfigured() });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: "push not configured" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as {
    endpoint?: unknown;
    keys?: { p256dh?: unknown; auth?: unknown };
  } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  const p256dh = typeof body?.keys?.p256dh === "string" ? body.keys.p256dh : "";
  const auth = typeof body?.keys?.auth === "string" ? body.keys.auth : "";
  if (!endpoint.startsWith("https://") || !p256dh || !auth) {
    return NextResponse.json({ error: "invalid subscription" }, { status: 400 });
  }

  const sub: StoredPushSubscription = {
    shopId: session.appUser.shopId,
    userId: session.appUser.id,
    userName: session.appUser.name,
    endpoint,
    keys: { p256dh, auth },
    createdAt: Date.now(),
    userAgent: request.headers.get("user-agent"),
  };
  await getAdminDb().collection(COLLECTIONS.pushSubscriptions).doc(subscriptionDocId(endpoint)).set(sub);
  return NextResponse.json({ ok: true });
}

export async function DELETE(request: NextRequest) {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  const endpoint = typeof body?.endpoint === "string" ? body.endpoint : "";
  if (!endpoint) return NextResponse.json({ ok: true });
  const ref = getAdminDb().collection(COLLECTIONS.pushSubscriptions).doc(subscriptionDocId(endpoint));
  const snap = await ref.get();
  if (snap.exists && (snap.data() as StoredPushSubscription).shopId === session.appUser.shopId) await ref.delete();
  return NextResponse.json({ ok: true });
}
