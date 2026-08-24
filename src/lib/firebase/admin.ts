import "server-only";

import { cert, getApps, initializeApp, type App } from "firebase-admin/app";
import { getAuth, type Auth } from "firebase-admin/auth";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

/**
 * Server-only Firebase Admin SDK singleton (privileged access — bypasses Security Rules).
 * Used by: the seed script, API routes that must act as an admin (e.g. creating staff Auth
 * accounts), and session verification. Never imported from a Client Component — the
 * `server-only` import above makes that a build error if it happens by accident.
 *
 * Initialization is lazy (only runs the first time `getAdminAuth()`/`getAdminDb()` is actually
 * called) rather than at module load. Next.js executes route-module top-level code while
 * collecting page data at build time, so an eager `initializeApp()` here would make
 * `npm run build` fail without real Firebase Admin credentials present.
 */
let adminApp: App | undefined;

function getAdminApp(): App {
  if (adminApp) return adminApp;

  const existing = getApps();
  if (existing.length > 0) {
    adminApp = existing[0];
    return adminApp;
  }

  const projectId = process.env.FIREBASE_ADMIN_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  const privateKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error(
      "Missing Firebase Admin env vars (FIREBASE_ADMIN_PROJECT_ID / FIREBASE_ADMIN_CLIENT_EMAIL / FIREBASE_ADMIN_PRIVATE_KEY). " +
        "Generate a service account key in Firebase Console > Project settings > Service accounts, and copy the values into .env.local."
    );
  }

  adminApp = initializeApp({
    credential: cert({ projectId, clientEmail, privateKey }),
  });
  return adminApp;
}

export function getAdminAuth(): Auth {
  return getAuth(getAdminApp());
}

export function getAdminDb(): Firestore {
  return getFirestore(getAdminApp());
}
