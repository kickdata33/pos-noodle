import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { runBillingCron } from "@/lib/billing/billingCron";

/**
 * The daily billing sweep endpoint (SaaS roadmap Phase 3), invoked by Vercel Cron per
 * `vercel.json`'s `crons` entry (Vercel issues a GET request with
 * `Authorization: Bearer $CRON_SECRET` automatically when a `CRON_SECRET` env var is set).
 * Also callable manually (e.g. `curl -H "Authorization: Bearer $CRON_SECRET" .../api/cron/billing`)
 * for testing without waiting for the schedule.
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

  const result = await runBillingCron(getAdminDb());
  return NextResponse.json(result);
}
