/**
 * Reads the public Firebase Web App config from env vars. All `NEXT_PUBLIC_*` vars are safe to
 * ship to the browser — they identify the project, they are not secrets (security is enforced
 * by Firestore Security Rules + Auth, see `firestore.rules`).
 */
export const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
} as const;

export function assertFirebaseConfigured() {
  const missing = Object.entries(firebaseConfig)
    .filter(([, value]) => !value)
    .map(([key]) => key);

  if (missing.length > 0) {
    throw new Error(
      `Missing Firebase env vars: ${missing.join(", ")}. Copy .env.example to .env.local and fill in your Firebase Web App config.`
    );
  }
}

/**
 * Single shared `shopId` for this milestone — the app is built to be multi-tenant-ready
 * (item 36: "ต่อยอดเป็น POS สำหรับร้านอื่นได้"), but v1 only ever runs one shop, so we pin it
 * via env instead of building shop-selection UI that nothing needs yet.
 */
export const DEFAULT_SHOP_ID = process.env.NEXT_PUBLIC_SHOP_ID || "default-shop";
