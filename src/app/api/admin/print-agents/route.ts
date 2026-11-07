import { NextResponse, type NextRequest } from "next/server";

import { getServerSession } from "@/lib/auth/session";
import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { agentUid, encodePairingCode, generateAgentSecret, hashAgentSecret } from "@/lib/printAgent/pairing";
import type { PrintAgent, PrintStation } from "@/types";

const STATIONS: PrintStation[] = ["kitchen", "cashier"];

async function requireAdmin() {
  const session = await getServerSession();
  if (!session || session.appUser.role !== "admin") return null;
  return session;
}

/**
 * Admin: add a background Print Agent for this shop. Returns the pairing code exactly once —
 * only its hash is stored, so a lost code means revoking and adding a new agent.
 */
export async function POST(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });

  const body = (await request.json().catch(() => null)) as { name?: unknown; stations?: unknown } | null;
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim().slice(0, 60) : "คอมแคชเชียร์";
  const stations = Array.isArray(body?.stations)
    ? STATIONS.filter((s) => (body!.stations as unknown[]).includes(s))
    : [];
  if (stations.length === 0) return NextResponse.json({ error: "เลือกอย่างน้อย 1 สถานี" }, { status: 400 });

  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.printAgents).doc();
  const secret = generateAgentSecret();
  const agent: Omit<PrintAgent, "id"> = {
    shopId: session.appUser.shopId,
    name,
    stations,
    createdAt: Date.now(),
    createdByName: session.appUser.name,
    revokedAt: null,
    lastSeenAt: null,
    printers: {},
    hostname: null,
    version: null,
  };
  const batch = db.batch();
  batch.set(ref, agent);
  batch.set(db.collection(COLLECTIONS.printAgentSecrets).doc(ref.id), {
    shopId: session.appUser.shopId,
    secretHash: hashAgentSecret(secret),
  });
  await batch.commit();

  return NextResponse.json({
    ok: true,
    agentId: ref.id,
    pairingCode: encodePairingCode({ origin: request.nextUrl.origin, agentId: ref.id, secret }),
  });
}

/** Admin: revoke an agent — its secret is deleted and its sign-in sessions are cut off. */
export async function DELETE(request: NextRequest) {
  const session = await requireAdmin();
  if (!session) return NextResponse.json({ error: "ไม่มีสิทธิ์เข้าถึง" }, { status: 403 });

  const agentId = request.nextUrl.searchParams.get("id") ?? "";
  if (!agentId) return NextResponse.json({ error: "missing id" }, { status: 400 });
  const db = getAdminDb();
  const ref = db.collection(COLLECTIONS.printAgents).doc(agentId);
  const snap = await ref.get();
  if (!snap.exists || (snap.data() as PrintAgent).shopId !== session.appUser.shopId) {
    return NextResponse.json({ error: "ไม่พบโปรแกรมพิมพ์นี้" }, { status: 404 });
  }
  const batch = db.batch();
  batch.update(ref, { revokedAt: Date.now() });
  batch.delete(db.collection(COLLECTIONS.printAgentSecrets).doc(agentId));
  await batch.commit();
  // The agent's custom token itself is short-lived, but its refresh token isn't — revoke it so
  // a stolen config stops working within the hour, not whenever the PC next restarts.
  await getAdminAuth()
    .revokeRefreshTokens(agentUid(agentId))
    .catch(() => undefined);
  return NextResponse.json({ ok: true });
}
