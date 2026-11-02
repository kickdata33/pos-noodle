import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { runDailySummaryCron } from "@/lib/notifications/dailySummaryCron";
import { runWeeklySummaryCron } from "@/lib/notifications/weeklySummaryCron";

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
 * `Authorization: Bearer $CRON_SECRET` automatically. Also callable manually for testing, or to
 * force-send an already-closed business day's summary that got missed for some reason (e.g. the
 * hour-mismatch bug above, or the server being down at the scheduled time) without waiting for
 * tomorrow's fire — `?force=1` skips the "is this my hour" check but not the "already sent
 * today" dedupe, so it's safe to run any time and can never double-send:
 *   curl -H "Authorization: Bearer $CRON_SECRET" "https://<domain>/api/cron/daily-summary?force=1"
 *
 * Also runs `runWeeklySummaryCron` on this same fire, despite the route's name — deliberately,
 * not an oversight. See that function's file comment for the full reasoning: this shop's Vercel
 * plan caps both the frequency *and* the number of cron jobs a project can register, this project
 * already uses both of its slots, and a 3rd `vercel.json` entry risks the exact same silent-
 * failure shape that already bit the hour-matching logic above. Piggybacking the weekly summary
 * on this one proven-reliable daily fire sidesteps that risk entirely — it independently checks
 * its own "is today my chosen weekday" and "already sent this week" conditions; the same `force`
 * flag bypasses its weekday check the same way `force` bypasses the daily summary's hour check.
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

  const force = request.nextUrl.searchParams.get("force") === "1";
  const db = getAdminDb();
  const [daily, weekly] = await Promise.all([
    runDailySummaryCron(db, { force }),
    runWeeklySummaryCron(db, { force }),
  ]);
  return NextResponse.json({ daily, weekly });
}
