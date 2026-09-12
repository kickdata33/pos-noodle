import { createHash } from "node:crypto";

import { NextResponse, type NextRequest } from "next/server";

import { getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { getShopBySlug } from "@/lib/shop/shopLookupAdmin";
import { isSignupThrottled } from "@/lib/shop/signupThrottle";
import { isValidSlug } from "@/lib/shop/slug";
import type { ShopSignupRequest } from "@/types";

const MAX_SHOP_NAME_LENGTH = 80;
const MAX_OWNER_NAME_LENGTH = 60;
const MAX_NOTE_LENGTH = 500;
const PHONE_PATTERN = /^[0-9+()\- ]{6,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface RequestBody {
  shopName?: string;
  requestedSlug?: string;
  ownerName?: string;
  phone?: string;
  email?: string;
  note?: string;
  /** Honeypot — a real visitor never sees or fills this field (hidden via CSS on the form).
   * Any bot that fills every input blind trips this and gets a generic success response so it
   * doesn't learn the field is a trap. */
  website?: string;
}

/** Same hashed-IP-key pattern as `/api/auth/pin`'s `throttleKeyFor` — never store a raw IP. */
function throttleKeyFor(request: NextRequest): string {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || "unknown";
  return createHash("sha256").update(ip).digest("hex").slice(0, 32);
}

/**
 * Public, unauthenticated shop-signup application (SaaS roadmap Phase 2). Never creates a shop
 * directly — the user chose "fill a form, we approve/create it" over full self-serve account
 * creation, so this only ever writes a `shopSignupRequests` doc for the superadmin console
 * (`/superadmin`) to review.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as RequestBody | null;
  if (!body) {
    return NextResponse.json({ error: "ข้อมูลไม่ถูกต้อง" }, { status: 400 });
  }

  // Honeypot tripped — respond as if it worked so a bot filling every field blind learns nothing.
  if (body.website) {
    return NextResponse.json({ ok: true });
  }

  const shopName = (body.shopName ?? "").trim().slice(0, MAX_SHOP_NAME_LENGTH);
  const requestedSlug = (body.requestedSlug ?? "").trim().toLowerCase();
  const ownerName = (body.ownerName ?? "").trim().slice(0, MAX_OWNER_NAME_LENGTH);
  const phone = (body.phone ?? "").trim();
  const email = (body.email ?? "").trim() || null;
  const note = (body.note ?? "").trim().slice(0, MAX_NOTE_LENGTH) || null;

  if (!shopName) return NextResponse.json({ error: "กรุณากรอกชื่อร้าน" }, { status: 400 });
  if (!isValidSlug(requestedSlug)) {
    return NextResponse.json(
      { error: "ชื่อ URL ต้องเป็นตัวเล็ก a-z, 0-9 และขีดกลาง ยาว 3-40 ตัวอักษร" },
      { status: 400 }
    );
  }
  if (!ownerName) return NextResponse.json({ error: "กรุณากรอกชื่อผู้ติดต่อ" }, { status: 400 });
  if (!PHONE_PATTERN.test(phone)) {
    return NextResponse.json({ error: "กรุณากรอกเบอร์โทรให้ถูกต้อง" }, { status: 400 });
  }
  if (email && !EMAIL_PATTERN.test(email)) {
    return NextResponse.json({ error: "อีเมลไม่ถูกต้อง" }, { status: 400 });
  }

  const db = getAdminDb();
  const now = Date.now();
  const throttleRef = db.collection(COLLECTIONS.signupThrottle).doc(throttleKeyFor(request));

  const throttleSnap = await throttleRef.get();
  const lastSubmittedAt = throttleSnap.exists ? (throttleSnap.data()!.lastSubmittedAt as number) : null;
  if (isSignupThrottled(lastSubmittedAt, now)) {
    return NextResponse.json(
      { error: "เพิ่งส่งคำขอไปเมื่อครู่ กรุณารอสักครู่แล้วลองใหม่" },
      { status: 429 }
    );
  }

  // Best-effort only — re-checked authoritatively at approval time, since another request or
  // approval can claim the same slug in between.
  const existingShop = await getShopBySlug(db, requestedSlug);
  if (existingShop) {
    return NextResponse.json({ error: "ชื่อ URL นี้มีร้านอื่นใช้แล้ว กรุณาเลือกชื่ออื่น" }, { status: 409 });
  }

  const requestData: Omit<ShopSignupRequest, "id"> = {
    shopName,
    requestedSlug,
    ownerName,
    phone,
    email,
    note,
    status: "pending",
    createdAt: now,
    reviewedAt: null,
    approvedShopId: null,
    rejectionReason: null,
    finalSlug: null,
    assignedAdminUid: null,
    assignedAdminName: null,
  };

  await db.collection(COLLECTIONS.shopSignupRequests).add(requestData);
  await throttleRef.set({ lastSubmittedAt: now });

  return NextResponse.json({ ok: true });
}
