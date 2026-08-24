import { NextResponse, type NextRequest } from "next/server";

import { getAdminAuth } from "@/lib/firebase/admin";
import { SESSION_COOKIE_NAME, SESSION_MAX_AGE_SECONDS } from "@/lib/auth/session";

/**
 * Exchanges a freshly-signed-in client Firebase ID token for an httpOnly session cookie.
 * Called by the login page right after `signInWithEmailAndPassword` succeeds. Keeping the
 * cookie httpOnly means the server layouts (and, cheaply, `middleware.ts`) can gate access
 * without any Firebase auth state needing to reach the browser's JS on protected routes.
 */
export async function POST(request: NextRequest) {
  const { idToken } = (await request.json()) as { idToken?: string };
  if (!idToken) {
    return NextResponse.json({ error: "Missing idToken" }, { status: 400 });
  }

  try {
    const sessionCookie = await getAdminAuth().createSessionCookie(idToken, {
      expiresIn: SESSION_MAX_AGE_SECONDS * 1000,
    });

    const response = NextResponse.json({ ok: true });
    response.cookies.set(SESSION_COOKIE_NAME, sessionCookie, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: SESSION_MAX_AGE_SECONDS,
      path: "/",
    });
    return response;
  } catch {
    return NextResponse.json({ error: "Invalid or expired sign-in" }, { status: 401 });
  }
}

/** Logout: clears the session cookie. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SESSION_COOKIE_NAME);
  return response;
}
