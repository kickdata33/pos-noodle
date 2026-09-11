import { NextResponse, type NextRequest } from "next/server";

import {
  issueSessionToken,
  SUPERADMIN_COOKIE_NAME,
  SUPERADMIN_SESSION_MAX_AGE_SECONDS,
  verifyAccessKey,
} from "@/lib/superadmin/session";

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { accessKey?: string } | null;
  const accessKey = body?.accessKey;

  if (!accessKey || !verifyAccessKey(accessKey)) {
    return NextResponse.json({ error: "รหัสไม่ถูกต้อง" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(SUPERADMIN_COOKIE_NAME, issueSessionToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SUPERADMIN_SESSION_MAX_AGE_SECONDS,
    path: "/",
  });
  return response;
}

/** Logout. */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(SUPERADMIN_COOKIE_NAME);
  return response;
}
