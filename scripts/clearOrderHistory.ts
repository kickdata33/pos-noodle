/**
 * One-off pre-launch reset: wipes only order/payment/audit history for a shop — everything a
 * real customer would see as "our order came from a test run" — while leaving the menu, tables,
 * staff, channels, payment methods, and shop settings exactly as configured. Requested by the
 * shop owner right before going live for real ("เคลียร์ประวัติออกทั้งหมด จะเริ่มใช้งานจริงแล้ว"),
 * scoped to history only per their explicit choice (not a full shop reset).
 *
 * Deletes, all filtered to one shopId:
 *   - orders, payments, auditLogs (every doc with that shopId)
 *   - orderCounters/{shopId} and pickupQueueCounters/{shopId} (so today's first real order and
 *     first real pickup ticket both start over at 0001, not continue from test numbers)
 *
 * Does NOT touch: shops, shopSettings, tables, categories, products, modifierGroups/Options,
 * salesChannels, paymentMethods, users/userSecrets, subscriptions, billingConfig,
 * shopSignupRequests — anything that isn't order/bill history.
 *
 * Safety: refuses to run unless CONFIRM=YES is set, and always prints counts before deleting so
 * this is never run blind against production data by accident.
 *
 * Usage:
 *   TARGET_SHOP_ID=<shopId> CONFIRM=YES npm run clear-order-history
 *   (TARGET_SHOP_ID defaults to NEXT_PUBLIC_SHOP_ID / DEFAULT_SHOP_ID if omitted — fine for a
 *   single-shop deployment, but double-check it on a multi-tenant one.)
 */
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { DEFAULT_SHOP_ID } from "../src/lib/firebase/config";

const SHOP_ID = process.env.TARGET_SHOP_ID || DEFAULT_SHOP_ID;
const HISTORY_COLLECTIONS = [COLLECTIONS.orders, COLLECTIONS.payments, COLLECTIONS.auditLogs] as const;

async function main() {
  if (process.env.CONFIRM !== "YES") {
    console.error(
      `Refusing to run without confirmation. This PERMANENTLY deletes all orders/payments/` +
        `audit logs for shopId="${SHOP_ID}".\n\nRe-run as:\n` +
        `  TARGET_SHOP_ID=${SHOP_ID} CONFIRM=YES npm run clear-order-history`
    );
    process.exit(1);
  }

  const db = getAdminDb();

  const counts: Record<string, number> = {};
  for (const collection of HISTORY_COLLECTIONS) {
    const snap = await db.collection(collection).where("shopId", "==", SHOP_ID).count().get();
    counts[collection] = snap.data().count;
  }
  console.log(`About to permanently delete for shopId="${SHOP_ID}":`);
  for (const [collection, count] of Object.entries(counts)) {
    console.log(`  ${collection}: ${count} doc(s)`);
  }

  const writer = db.bulkWriter();
  for (const collection of HISTORY_COLLECTIONS) {
    const snap = await db.collection(collection).where("shopId", "==", SHOP_ID).get();
    for (const doc of snap.docs) writer.delete(doc.ref);
  }
  await writer.close();

  // Counters are singleton docs keyed by shopId, not queried collections — deleting them resets
  // numbering to start fresh (date rolls over, seq starts at 1) on the next real order/ticket.
  await db.collection(COLLECTIONS.orderCounters).doc(SHOP_ID).delete();
  await db.collection(COLLECTIONS.pickupQueueCounters).doc(SHOP_ID).delete();

  console.log(`✓ Cleared order/payment/audit history for shopId="${SHOP_ID}". Numbering will restart at 0001.`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
