import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Credentials for a background Print Agent. The admin sees one *pairing code* once, pastes it
 * into the installer on the shop PC, and the PC keeps it; the server keeps only a SHA-256 hash of
 * the secret (256 random bits — far too strong to brute-force, so no pepper or slow hash is
 * needed). Server-only module (node:crypto).
 */

export function generateAgentSecret(): string {
  return randomBytes(32).toString("base64url");
}

export function hashAgentSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

export function verifyAgentSecret(secret: string, storedHash: string): boolean {
  const a = Buffer.from(hashAgentSecret(secret), "hex");
  const b = Buffer.from(storedHash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** What the installer asks for: the shop's own site, the agent id and its secret, as one string. */
export function encodePairingCode(input: { origin: string; agentId: string; secret: string }): string {
  const json = JSON.stringify({ v: 1, u: input.origin, a: input.agentId, s: input.secret });
  return `RANPOS1.${Buffer.from(json, "utf8").toString("base64url")}`;
}

export function decodePairingCode(code: string): { origin: string; agentId: string; secret: string } | null {
  const trimmed = code.trim();
  if (!trimmed.startsWith("RANPOS1.")) return null;
  try {
    const data = JSON.parse(Buffer.from(trimmed.slice(8), "base64url").toString("utf8")) as {
      u?: unknown;
      a?: unknown;
      s?: unknown;
    };
    if (typeof data.u !== "string" || typeof data.a !== "string" || typeof data.s !== "string") return null;
    return { origin: data.u, agentId: data.a, secret: data.s };
  } catch {
    return null;
  }
}

/** Firebase Auth uid for an agent's custom token — namespaced so it can never collide with a
 * real user's uid (and so has no `users/` doc, which keeps it out of every staff rule). */
export function agentUid(agentId: string): string {
  return `printagent_${agentId}`;
}
