"use client";

import { getApps, initializeApp, type FirebaseApp } from "firebase/app";
import { getAuth, type Auth } from "firebase/auth";
import { getFirestore, type Firestore } from "firebase/firestore";

import { firebaseConfig } from "./config";

/**
 * Browser-side Firebase SDK singletons. Import `db`/`auth` from here in repositories and
 * client components — never call `initializeApp` anywhere else.
 */
function getClientApp(): FirebaseApp {
  const existing = getApps();
  if (existing.length > 0) return existing[0];
  return initializeApp(firebaseConfig);
}

export const app = getClientApp();
export const auth: Auth = getAuth(app);
export const db: Firestore = getFirestore(app);
