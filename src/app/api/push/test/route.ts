import { NextResponse } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { pushConfigured, sendTestToUser } from "@/lib/push/webPush";

/**
 * "ทดสอบแจ้งเตือน" on a staff phone: sends a test notification to the signed-in user's own
 * subscribed devices right away and returns what each push service answered. (No delay: a phone
 * locked while waiting drops the request, and the answer is what matters for diagnosis — the
 * notification itself also shows while the app is open.)
 */
export async function POST() {
  const session = await getServerSession();
  if (!session) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!pushConfigured()) return NextResponse.json({ error: "push not configured" }, { status: 503 });
  const results = await sendTestToUser(session.appUser.shopId, session.appUser.id);
  return NextResponse.json({ ok: true, results });
}
