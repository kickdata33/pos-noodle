import { createHash } from "node:crypto";

import webpush from "web-push";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";

/**
 * Web Push for the kitchen's "เรียกเสิร์ฟ" (item: "แจ้งเตือนเข้ามือถือส่วนตัว แม้ล็อกจอ"). Server-only.
 *
 * Needs three env vars on Vercel (generate the pair once with `npx web-push generate-vapid-keys`):
 *   NEXT_PUBLIC_VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. "mailto:you@example.com").
 * Without them push is simply off — the in-app full-screen alarm still works.
 */

export interface StoredPushSubscription {
  shopId: string;
  userId: string;
  userName: string;
  endpoint: string;
  keys: { p256dh: string; auth: string };
  createdAt: number;
  userAgent: string | null;
}

export function pushConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY && process.env.VAPID_PRIVATE_KEY && process.env.VAPID_SUBJECT
  );
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );
  configured = true;
}

export function subscriptionDocId(endpoint: string): string {
  return createHash("sha256").update(endpoint).digest("hex").slice(0, 40);
}

export interface ServeCallPushPayload {
  kind: "serveCall" | "serveCallDone";
  callId: string;
  title: string;
  body: string;
}

/**
 * Sends one notification to every subscribed phone of the shop. Subscriptions the push service
 * reports as gone (404/410: app uninstalled, permission revoked) are deleted so the list stays
 * clean. Never throws — push is best-effort next to the in-app alarm.
 */
export async function sendToShop(shopId: string, payload: ServeCallPushPayload): Promise<{ sent: number; removed: number }> {
  if (!pushConfigured()) return { sent: 0, removed: 0 };
  ensureConfigured();
  const db = getAdminDb();
  const snap = await db.collection(COLLECTIONS.pushSubscriptions).where("shopId", "==", shopId).get();
  let sent = 0;
  let removed = 0;
  await Promise.all(
    snap.docs.map(async (doc) => {
      const sub = doc.data() as StoredPushSubscription;
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify(payload),
          // A serve call is stale after a few minutes; "high" wakes a sleeping phone. (No Topic
          // header: not every push service accepts it, and the notification tag already
          // collapses repeats on the phone.)
          { TTL: 300, urgency: "high" }
        );
        sent++;
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode;
        // Visible in Vercel → Logs: the push service's own reason (e.g. Apple's BadJwtToken).
        console.error("web push failed", {
          host: safeHost(sub.endpoint),
          user: sub.userName,
          status,
          body: (err as { body?: string }).body,
        });
        if (status === 404 || status === 410) {
          await doc.ref.delete().catch(() => undefined);
          removed++;
        }
      }
    })
  );
  return { sent, removed };
}

function safeHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return "?";
  }
}

/**
 * Diagnostic: sends one test notification to the given user's own phones only, and reports what
 * each push service answered — so "ไม่เด้ง" can be told apart from "Apple rejected it".
 */
export async function sendTestToUser(
  shopId: string,
  userId: string
): Promise<{ host: string; ok: boolean; status: number | null; detail: string }[]> {
  if (!pushConfigured()) return [];
  ensureConfigured();
  const db = getAdminDb();
  const snap = await db
    .collection(COLLECTIONS.pushSubscriptions)
    .where("shopId", "==", shopId)
    .where("userId", "==", userId)
    .get();
  return Promise.all(
    snap.docs.map(async (doc) => {
      const sub = doc.data() as StoredPushSubscription;
      const host = safeHost(sub.endpoint);
      try {
        const res = await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: sub.keys },
          JSON.stringify({
            kind: "serveCall",
            callId: "test-" + Date.now(),
            title: "🔔 ทดสอบแจ้งเตือน",
            body: "ถ้าเห็นข้อความนี้ตอนล็อกจอ แปลว่าใช้ได้",
          } satisfies ServeCallPushPayload),
          { TTL: 120, urgency: "high" }
        );
        return { host, ok: true, status: res.statusCode, detail: "ส่งถึงผู้ให้บริการแจ้งเตือนแล้ว" };
      } catch (err) {
        const status = (err as { statusCode?: number }).statusCode ?? null;
        if (status === 404 || status === 410) await doc.ref.delete().catch(() => undefined);
        return { host, ok: false, status, detail: String((err as { body?: string }).body ?? (err as Error).message ?? "") };
      }
    })
  );
}
