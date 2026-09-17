import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { runDailySummaryCron } from "@/lib/notifications/dailySummaryCron";

/**
 * Runs every hour on the hour (see `vercel.json`) — each shop picks its own send hour now, so
 * `runDailySummaryCron` itself decides who's actually due this run. Same auth pattern as
 * `/api/cron/billing`: Vercel Cron sends `Authorization: Bearer $CRON_SECRET` automatically.
 * Also callable manually for testing:
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
