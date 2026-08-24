"use client";

import { onAuthStateChanged, type User as FirebaseUser } from "firebase/auth";
import { createContext, useEffect, useState, type ReactNode } from "react";

import { auth } from "@/lib/firebase/client";
import { userRepository } from "@/repositories/userRepository";
import type { AppUser } from "@/types";

interface AuthContextValue {
  /** Raw Firebase Auth user, or undefined while the initial auth state is still loading. */
  firebaseUser: FirebaseUser | null | undefined;
  /** The matching Firestore `users` doc (role/active/name) — display-only on the client. */
  appUser: AppUser | null | undefined;
  loading: boolean;
}

export const AuthContext = createContext<AuthContextValue>({
  firebaseUser: undefined,
  appUser: undefined,
  loading: true,
});

/**
 * Client-side auth state for UI purposes only (showing the signed-in user's name, a sign-out
 * button, etc). This is *not* what protects `/admin` and `/pos` — that happens server-side in
 * their layouts via the httpOnly session cookie (see `lib/auth/session.ts`), since a client
 * context can always be bypassed by anyone editing JS in the browser.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [firebaseUser, setFirebaseUser] = useState<FirebaseUser | null | undefined>(undefined);
  const [appUser, setAppUser] = useState<AppUser | null | undefined>(undefined);

  useEffect(() => {
    return onAuthStateChanged(auth, async (user) => {
      setFirebaseUser(user);
      if (!user) {
        setAppUser(null);
        return;
      }
      setAppUser(await userRepository.getByUid(user.uid));
    });
  }, []);

  const loading = firebaseUser === undefined;

  return (
    <AuthContext.Provider value={{ firebaseUser, appUser, loading }}>
      {children}
    </AuthContext.Provider>
  );
}
