import { NextResponse, type NextRequest } from "next/server";

import { getAdminAuth, getAdminDb } from "@/lib/firebase/admin";
import { COLLECTIONS } from "@/lib/firebase/collections";
import { agentUid, verifyAgentSecret } from "@/lib/printAgent/pairing";
import type { PrintAgent } from "@/types";

/**
 * The background Print Agent's sign-in: agent id + secret (from the pairing code stored on the
 * shop PC) in, a Firebase custom token out. The token's claims are what the Firestore rules use
 * to limit the agent to its own shop and stations (`isPrintAgent`/`agentMayPrint`) — it gets no
 * `users/` doc, so none of the staff rules apply to it. Also hands back the public Firebase web
 * config, so the agent's local config never needs it.
 */
export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { agentId?: unknown; secret?: unknown } | null;
  const agentId = typeof body?.agentId === "string" ? body.agentId : "";
  const secret = typeof body?.secret === "string" ? body.secret : "";
  if (!agentId || !secret) return NextResponse.json({ error: "invalid request" }, { status: 400 });

  const db = getAdminDb();
  const [agentSnap, secretSnap] = await Promise.all([
    db.collection(COLLECTIONS.printAgents).doc(agentId).get(),
    db.collection(COLLECTIONS.printAgentSecrets).doc(agentId).get(),
  ]);
  const agent = agentSnap.exists ? (agentSnap.data() as Omit<PrintAgent, "id">) : null;
  const storedHash = secretSnap.exists ? (secretSnap.data()?.secretHash as string | undefined) : undefined;
  if (!agent || agent.revokedAt || !storedHash || !verifyAgentSecret(secret, storedHash)) {
    // One answer for every failure — no hint whether the id exists.
    return NextResponse.json({ error: "รหัสเชื่อมต่อไม่ถูกต้องหรือถูกยกเลิกแล้ว" }, { status: 401 });
  }

  const customToken = await getAdminAuth().createCustomToken(agentUid(agentId), {
    role: "printAgent",
    agentId,
    shopId: agent.shopId,
    stations: agent.stations,
  });
  return NextResponse.json({
    ok: true,
    customToken,
    shopId: agent.shopId,
    stations: agent.stations,
    name: agent.name,
    firebaseConfig: {
      apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
    },
  });
}
