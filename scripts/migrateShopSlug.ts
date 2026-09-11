/**
 * One-off migration (SaaS roadmap Phase 2): sets `slug` on the shop's own `shops/{DEFAULT_SHOP_ID}`
 * doc, so it becomes reachable at `champnoodles-bonkai.<app domain>` once the user's custom
 * domain is registered and connected. Safe to re-run — it just overwrites the field with the
 * same value each time.
 *
 * Usage:
 *   npm run migrate-shop-slug
 */
import { getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { DEFAULT_SHOP_ID } from "../src/lib/firebase/config";
import { isValidSlug } from "../src/lib/shop/slug";

const SLUG = "champnoodles-bonkai"; // from "Champ noodles บ่อนไก่", per the shop owner

async function main() {
  if (!isValidSlug(SLUG)) {
    throw new Error(`"${SLUG}" is not a valid slug — check lib/shop/slug.ts's format rules.`);
  }

  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.shops).doc(DEFAULT_SHOP_ID);
  const snap = await ref.get();
  if (!snap.exists) {
    throw new Error(`shops/${DEFAULT_SHOP_ID} doesn't exist — run \`npm run seed\` first.`);
  }

  const existing = await db.collection(COLLECTIONS.shops).where("slug", "==", SLUG).limit(1).get();
  if (!existing.empty && existing.docs[0].id !== DEFAULT_SHOP_ID) {
    throw new Error(`"${SLUG}" is already used by shop ${existing.docs[0].id} — pick a different slug.`);
  }

  await ref.set({ slug: SLUG }, { merge: true });
  console.log(`✓ shops/${DEFAULT_SHOP_ID} now has slug "${SLUG}"`);
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
