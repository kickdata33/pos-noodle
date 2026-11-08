/**
 * Pre-launch reset for ONE shop: wipes test-run history (bills, payments, print queue, stock
 * movements, audit log...) while leaving everything the shop configured exactly as it is —
 * menu, categories, options, promotions, tables, channels, payment methods, staff, settings,
 * Print Agents, stock items. Owner request: "เคลียร์ประวัติทั้งหมด เพื่อเริ่มใช้จริง".
 *
 * Multi-shop safe: the shop must be named explicitly by its subdomain (TARGET_SHOP_SLUG, e.g.
 * `yodnk` for yodnk.ranpos.online) or id (TARGET_SHOP_ID) — there is no default, so the other
 * shops on the same database can't be hit by accident. Without CONFIRM=YES it only prints what it
 * WOULD delete (dry run).
 *
 * Deletes, every doc with that shopId:
 *   orders, payments, auditLogs, printJobs, stockMovements, tableOccupancy
 * and the per-shop counters orderCounters/{shopId}, pickupQueueCounters/{shopId} (so the first
 * real bill and pickup ticket are 0001 again); clears every table's open QR session / "รอสั่ง"
 * mark. With ALSO_ACCOUNTING=YES also: expenses, bankTransfers, dailyFloats, deliveryPayouts,
 * deliveryFloatTopUps, cashSafeCounts, cashSafeWithdrawals, payrollAdvances, payrollAbsences,
 * payrollSettlements (only matters for shops using those Admin modules).
 *
 * Stock QUANTITIES are not reset (the stock items stay tracked) — do a closing count
 * (POS → สต๊อก → นับปิดร้าน) right after, so the real starting stock is what's on the shelf.
 *
 * Usage (from the repo, with .env.local holding the Firebase Admin credentials):
 *   TARGET_SHOP_SLUG=yodnk npm run clear-order-history                 # dry run: counts only
 *   TARGET_SHOP_SLUG=yodnk CONFIRM=YES npm run clear-order-history      # really delete
 */
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";

const HISTORY = [
  COLLECTIONS.orders,
  COLLECTIONS.payments,
  COLLECTIONS.auditLogs,
  COLLECTIONS.printJobs,
  COLLECTIONS.stockMovements,
  COLLECTIONS.tableOccupancy,
];
const ACCOUNTING = [
  COLLECTIONS.expenses,
  COLLECTIONS.bankTransfers,
  COLLECTIONS.dailyFloats,
  COLLECTIONS.deliveryPayouts,
  COLLECTIONS.deliveryFloatTopUps,
  COLLECTIONS.cashSafeCounts,
  COLLECTIONS.cashSafeWithdrawals,
  COLLECTIONS.payrollAdvances,
  COLLECTIONS.payrollAbsences,
  COLLECTIONS.payrollSettlements,
];

type Db = ReturnType<typeof getAdminDb>;

async function resolveShop(db: Db): Promise<{ id: string; slug: string; name: string }> {
  const slug = process.env.TARGET_SHOP_SLUG?.trim();
  const id = process.env.TARGET_SHOP_ID?.trim();
  if (slug) {
    const snap = await db.collection(COLLECTIONS.shops).where("slug", "==", slug).limit(1).get();
    if (snap.empty) throw new Error(`No shop with slug "${slug}".`);
    const d = snap.docs[0];
    return { id: d.id, slug, name: String(d.data().name ?? "") };
  }
  if (id) {
    const d = await db.collection(COLLECTIONS.shops).doc(id).get();
    if (!d.exists) throw new Error(`No shop with id "${id}".`);
    return { id, slug: String(d.data()?.slug ?? ""), name: String(d.data()?.name ?? "") };
  }
  throw new Error("Name the shop: TARGET_SHOP_SLUG=<subdomain> (e.g. yodnk) or TARGET_SHOP_ID=<id>.");
}

async function main() {
  const db = getAdminDb();
  const shop = await resolveShop(db);
  const confirm = process.env.CONFIRM === "YES";
  const collections = process.env.ALSO_ACCOUNTING === "YES" ? [...HISTORY, ...ACCOUNTING] : HISTORY;

  console.log(`Shop: "${shop.name}"  slug=${shop.slug}  id=${shop.id}`);
  console.log(confirm ? "Deleting:" : "DRY RUN — would delete:");
  for (const c of collections) {
    const n = (await db.collection(c).where("shopId", "==", shop.id).count().get()).data().count;
    console.log(`  ${c}: ${n}`);
  }
  const tables = await db.collection(COLLECTIONS.tables).where("shopId", "==", shop.id).get();
  console.log(`  tables: clear QR session / รอสั่ง on ${tables.size} table(s) (tables themselves kept)`);
  console.log(`  orderCounters/${shop.id}, pickupQueueCounters/${shop.id} (numbering restarts at 0001)`);

  if (!confirm) {
    console.log(`\nNothing deleted. To really delete, re-run with CONFIRM=YES:`);
    console.log(`  TARGET_SHOP_SLUG=${shop.slug || "<slug>"} CONFIRM=YES npm run clear-order-history`);
    process.exit(0);
  }

  const writer = db.bulkWriter();
  for (const c of collections) {
    const snap = await db.collection(c).where("shopId", "==", shop.id).get();
    for (const doc of snap.docs) writer.delete(doc.ref);
  }
  for (const t of tables.docs) writer.update(t.ref, { sessionToken: null, seatedAt: null });
  await writer.close();
  await db.collection(COLLECTIONS.orderCounters).doc(shop.id).delete();
  await db.collection(COLLECTIONS.pickupQueueCounters).doc(shop.id).delete();

  console.log(`\n✓ History cleared for "${shop.name}". Next bill number starts at 0001.`);
  console.log("  Do a closing stock count (POS → สต๊อก → นับปิดร้าน) so stock starts from what's on the shelf.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
