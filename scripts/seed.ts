/**
 * One-time setup script — creates the default shop, shop settings, 8 tables, sales channels,
 * payment methods, and one admin login, so there's something to log into on a fresh Firebase
 * project (item 20 database concept, item 33 Phase-1 step 1 "Project Setup").
 *
 * Safe to re-run: it upserts by fixed doc id / matching email, it won't create duplicates.
 *
 * Usage:
 *   1. Fill in .env.local (see .env.example) with your Firebase Admin service account values
 *      and NEXT_PUBLIC_SHOP_ID (any short slug, e.g. "champ-noodle").
 *   2. Set PIN_PEPPER and SEED_ADMIN_PIN in .env.local (the first Admin login).
 *   3. npm run seed
 */
import { computePinLookup, isValidPinFormat, PIN_LENGTH } from "../src/lib/auth/pin";
import { getAdminAuth, getAdminDb } from "../src/lib/firebase/admin";
import { COLLECTIONS } from "../src/lib/firebase/collections";
import { DEFAULT_SHOP_ID } from "../src/lib/firebase/config";

// Called here (a standalone script, not a Next.js build step) so a missing/invalid
// FIREBASE_ADMIN_* env var fails fast with a clear message instead of partway through seeding.
const adminAuth = getAdminAuth();
const adminDb = getAdminDb();

const SHOP_ID = DEFAULT_SHOP_ID;
const DEFAULT_SHOP_NAME = "ร้านลูกชิ้นแชมป์ x นายฮังเพ้ง"; // seeded default only — editable from Admin (item 16, 34)

async function seedShopAndSettings() {
  const now = Date.now();

  await adminDb.collection(COLLECTIONS.shops).doc(SHOP_ID).set(
    { name: DEFAULT_SHOP_NAME, createdAt: now },
    { merge: true }
  );

  const settingsRef = adminDb.collection(COLLECTIONS.shopSettings).doc(SHOP_ID);
  const existing = await settingsRef.get();
  if (!existing.exists) {
    await settingsRef.set({
      shopId: SHOP_ID,
      name: DEFAULT_SHOP_NAME,
      logoUrl: null,
      phone: "",
      address: "",
      taxId: "",
      receiptFooterText: "ขอบคุณที่ใช้บริการ",
      currency: "THB",
      theme: "light",
      vatEnabled: false,
      vatRate: 7,
      serviceChargeEnabled: false,
      serviceChargeRate: 0,
      updatedAt: now,
    });
    console.log("✓ shopSettings created");
  } else {
    console.log("· shopSettings already exists, skipped");
  }
}

async function seedTables() {
  const existing = await adminDb
    .collection(COLLECTIONS.tables)
    .where("shopId", "==", SHOP_ID)
    .limit(1)
    .get();
  if (!existing.empty) {
    console.log("· tables already exist, skipped");
    return;
  }

  const now = Date.now();
  const batch = adminDb.batch();
  for (let i = 1; i <= 8; i++) {
    const ref = adminDb.collection(COLLECTIONS.tables).doc();
    batch.set(ref, {
      shopId: SHOP_ID,
      name: `โต๊ะ ${i}`,
      sortOrder: i,
      active: true,
      createdAt: now,
    });
  }
  await batch.commit();
  console.log("✓ 8 tables created");
}

async function seedChannels() {
  const existing = await adminDb
    .collection(COLLECTIONS.salesChannels)
    .where("shopId", "==", SHOP_ID)
    .limit(1)
    .get();
  if (!existing.empty) {
    console.log("· salesChannels already exist, skipped");
    return;
  }

  const now = Date.now();
  const channels: Array<{
    name: string;
    code: "dineIn" | "takeaway" | "grab" | "lineman" | "shopeeFood";
    requiresTable: boolean;
    color: string;
  }> = [
    { name: "หน้าร้าน", code: "dineIn", requiresTable: true, color: "#16a34a" },
    { name: "กลับบ้าน", code: "takeaway", requiresTable: false, color: "#2563eb" },
    { name: "Grab", code: "grab", requiresTable: false, color: "#00b14f" },
    { name: "LINE MAN", code: "lineman", requiresTable: false, color: "#00b900" },
    { name: "ShopeeFood", code: "shopeeFood", requiresTable: false, color: "#ee4d2d" },
  ];

  const batch = adminDb.batch();
  channels.forEach((channel, index) => {
    const ref = adminDb.collection(COLLECTIONS.salesChannels).doc();
    batch.set(ref, {
      shopId: SHOP_ID,
      name: channel.name,
      code: channel.code,
      requiresTable: channel.requiresTable,
      color: channel.color,
      icon: null,
      active: true,
      sortOrder: index + 1,
      createdAt: now,
    });
  });
  await batch.commit();
  console.log("✓ sales channels created");
}

async function seedPaymentMethods() {
  const existing = await adminDb
    .collection(COLLECTIONS.paymentMethods)
    .where("shopId", "==", SHOP_ID)
    .limit(1)
    .get();
  if (!existing.empty) {
    console.log("· paymentMethods already exist, skipped");
    return;
  }

  const now = Date.now();
  const methods: Array<{ name: string; code: "cash" | "qr" | "delivery" }> = [
    { name: "เงินสด", code: "cash" },
    { name: "QR", code: "qr" },
    { name: "Delivery", code: "delivery" },
  ];

  const batch = adminDb.batch();
  methods.forEach((method, index) => {
    const ref = adminDb.collection(COLLECTIONS.paymentMethods).doc();
    batch.set(ref, {
      shopId: SHOP_ID,
      name: method.name,
      code: method.code,
      active: true,
      sortOrder: index + 1,
      createdAt: now,
    });
  });
  await batch.commit();
  console.log("✓ payment methods created");
}

async function seedAdminUser() {
  const pin = process.env.SEED_ADMIN_PIN;
  const name = process.env.SEED_ADMIN_NAME || "Admin";

  if (!pin) {
    console.log(
      "· SEED_ADMIN_PIN not set — skipping admin user creation. " +
        "Set it in .env.local and re-run to create the first login."
    );
    return;
  }

  if (!isValidPinFormat(pin)) {
    throw new Error(`SEED_ADMIN_PIN must be exactly ${PIN_LENGTH} digits.`);
  }

  const lookup = computePinLookup(pin, SHOP_ID);

  // A PIN identifies its user on its own, so two accounts sharing one would make login
  // ambiguous. Reject that here rather than silently creating an unreachable account.
  const clash = await adminDb
    .collection(COLLECTIONS.userSecrets)
    .where("shopId", "==", SHOP_ID)
    .where("pinLookup", "==", lookup)
    .limit(1)
    .get();

  let uid: string;
  if (!clash.empty) {
    uid = clash.docs[0].id;
    console.log("· a user with this PIN already exists, updating it instead of creating another");
  } else {
    // No email/password: the PIN is the only credential, verified server-side in /api/auth/pin,
    // which then mints a custom token for this uid.
    const created = await adminAuth.createUser({ displayName: name });
    uid = created.uid;
    console.log("✓ Firebase Auth user created");
  }

  await adminDb.collection(COLLECTIONS.users).doc(uid).set(
    {
      shopId: SHOP_ID,
      name,
      email: null,
      role: "admin",
      active: true,
      createdAt: Date.now(),
    },
    { merge: true }
  );

  await adminDb.collection(COLLECTIONS.userSecrets).doc(uid).set({
    shopId: SHOP_ID,
    pinLookup: lookup,
    updatedAt: Date.now(),
  });

  console.log(`✓ users/${uid} set as active admin (login with PIN ${pin.slice(0, 2)}****)`);
}

async function main() {
  console.log(`Seeding shop "${SHOP_ID}"...\n`);
  await seedShopAndSettings();
  await seedTables();
  await seedChannels();
  await seedPaymentMethods();
  await seedAdminUser();
  console.log("\nDone.");
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
