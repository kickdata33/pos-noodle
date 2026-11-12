import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { pushConfigured, sendTestToUser } from "@/lib/push/webPush";

/**
 * "ทดสอบแจ้งเตือน" on a staff phone: waits a few seconds (time to lock the screen), then sends a
 * test notification to the signed-in user's own subscribed devices and returns what each push
 * service answered.
 */
export async function POST() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: "push not configured" }, { status: 503 });
  await new Promise((r) => setTimeout(r, 6000));
  const results = await sendTestToUser(session.appUser.shopId, session.appUser.id);
  return NextResponse.json({ ok: true, results });
}
