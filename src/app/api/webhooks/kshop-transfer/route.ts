import { timingSafeEqual } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { DEFAULT_SHOP_ID } from "@/lib/firebase/config";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { bangkokDateKeyWithCutoff } from "@/lib/pos/dateRange";
import { parseKShopNotificationText } from "@/lib/pos/kshopNotification";
import type { BankTransfer } from "@/types";

/**
 * Receives K SHOP's plain-text payment notification, forwarded here by a notification->webhook
 * Android app (MacroDroid, Tasker, "Webhook Push Notifications", ...) running on whichever phone
 * gets the shop's K SHOP alerts — no bank API, no OCR (item: "ดักจับข้อความแจ้งเตือน"; see
 * `lib/pos/kshopNotification.ts`'s comment for the full reasoning and confirmed real notification
 * text this parses). Turns a per-payment notification straight into a `BankTransfer`, tagged with
 * the same auto-derived business day `TransferQuickAddRow` computes when a person types the same
 * information in by hand — the two paths produce identical data, this one just skips the typing.
 *
 * Auth is a shared secret in the URL (`?secret=...`) rather than an `Authorization` header,
 * because most of these forwarder apps only let you configure a plain URL + POST body, not custom
 * headers — same tradeoff every inbound webhook from a third-party no-code tool makes. Treat this
 * URL (with its secret) like a password: anyone who has it can log fake transfers for this shop.
 *
 * Setup on the phone (once): install a notification-forwarder app, grant it notification access,
 * add a rule that matches K SHOP's notifications (app: LINE, or whatever app posts them) and POST
 * the notification text as JSON to:
 *   https://<domain>/api/webhooks/kshop-transfer?secret=<KSHOP_NOTIFY_SECRET>
 * with the notification's text in a `text` field (works with either JSON body: {"text": "..."},
 * a plain-text body, or a `text` query parameter — whichever the app supports).
 */

const DEFAULT_BUSINESS_DAY_CUTOFF_HOUR = 16; // matches every other page's own default (see `/admin/accounting`)
const DEDUPE_WINDOW_MS = 5 * 60 * 1000; // a forwarder app retrying a failed delivery shouldn't double-log

function constantTimeEquals(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

async function extractText(request: NextRequest): Promise<string | null> {
  const fromQuery = request.nextUrl.searchParams.get("text");
  if (fromQuery) return fromQuery;

  const contentType = request.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await request.json().catch(() => null)) as { text?: unknown } | null;
    return typeof body?.text === "string" ? body.text : null;
  }
  // Plain-text or form-encoded body — accept the raw body as-is rather than requiring a specific
  // forwarder-app template.
  const raw = await request.text().catch(() => "");
  return raw || null;
}

async function handle(request: NextRequest) {
  const secret = process.env.KSHOP_NOTIFY_SECRET;
  const provided = request.nextUrl.searchParams.get("secret") ?? "";
  if (!secret || !provided || !constantTimeEquals(provided, secret)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const text = await extractText(request);
  if (!text) {
    return NextResponse.json({ error: "missing text" }, { status: 400 });
  }

  const parsed = parseKShopNotificationText(text);
  if (!parsed) {
    // Not every K SHOP notification is a payment (there's also the daily-summary one) — 200 so
    // the forwarder app doesn't treat every non-payment notification as a delivery failure and
    // retry it forever.
    return NextResponse.json({ ok: true, skipped: "did not look like a payment notification" });
  }

  // `?timestamp=` lets the forwarder app pass the notification's own post time (in epoch ms) if
  // it supports that — falls back to "now" (received time), which is off by at most a few
  // seconds/minutes for a real-time push, plenty accurate for day-bucketing except right at a
  // cutoff-hour boundary.
  const timestampParam = request.nextUrl.searchParams.get("timestamp");
  const transferredAt = timestampParam && Number.isFinite(Number(timestampParam)) ? Number(timestampParam) : Date.now();
  const businessDayKey = bangkokDateKeyWithCutoff(transferredAt, DEFAULT_BUSINESS_DAY_CUTOFF_HOUR);

  const db = getAdminDb();
  const shopId = DEFAULT_SHOP_ID;

  // Dedupe: the same notification delivered twice (a retry, or two forwarder rules both firing)
  // would otherwise double-count real sales.
  const existingSnap = await db
    .collection(COLLECTIONS.bankTransfers)
    .where("shopId", "==", shopId)
    .where("businessDayKey", "==", businessDayKey)
    .where("amount", "==", parsed.amount)
    .get();
  const isDuplicate = existingSnap.docs.some((d) => {
    const existing = d.data() as BankTransfer;
    return Math.abs(existing.transferredAt - transferredAt) <= DEDUPE_WINDOW_MS;
  });
  if (isDuplicate) {
    return NextResponse.json({ ok: true, skipped: "duplicate notification" });
  }

  const ref = db.collection(COLLECTIONS.bankTransfers).doc();
  const transfer: Omit<BankTransfer, "id"> = {
    shopId,
    transferredAt,
    amount: parsed.amount,
    businessDayKey,
    note: `จาก ${parsed.payer} (ดักจับข้อความแจ้งเตือนอัตโนมัติ)`,
    createdBy: "kshop-notification-webhook",
    createdByName: "ระบบดักจับแจ้งเตือน K SHOP",
    createdAt: Date.now(),
  };
  await ref.set(transfer);

  return NextResponse.json({ ok: true, transferId: ref.id, amount: parsed.amount, businessDayKey });
}

export async function POST(request: NextRequest) {
  return handle(request);
}

// Some forwarder apps only support GET requests with everything in the query string.
export async function GET(request: NextRequest) {
  return handle(request);
}
