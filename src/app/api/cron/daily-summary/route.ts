import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { runDailySummaryCron } from "@/lib/notifications/dailySummaryCron";

/**
 * Fires once a day at whatever single UTC time `vercel.json`'s cron entry says (Vercel's Hobby
 * plan — what this shop is on — caps a cron job at once per day; an hourly schedule either gets
 * rejected at deploy or silently capped, so don't "fix" this to run hourly without first
 * confirming an upgrade to Pro). `runDailySummaryCron` compares that one fixed fire time against
 * each shop's own `NotificationSettings.dailySummaryHour` — which only ever actually matches if
 * it equals *exactly* the hour `vercel.json` fires at. This bit a real shop before (chose 06:00
 * in the settings UI while the cron only ever fired at 04:00 Bangkok, so the summary silently
 * never sent) — if a shop's chosen hour ever changes, `vercel.json`'s schedule has to change
 * with it, in the same commit. Same auth pattern as `/api/cron/billing`: Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET` automatically. Also callable manually for testing:
 *   curl -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron/daily-summary
 */
function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const auth = request.headers.get("authorization");
  const expected = secret ? `Bearer ${secret}` : null;

  if (!expected || !auth || !constantTimeEquals(auth, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await runDailySummaryCron(getAdminDb());
  return NextResponse.json(result);
}
