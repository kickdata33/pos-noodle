import "server-only";

/**
 * Thin `fetch`-based wrapper around Omise's REST API (SaaS roadmap Phase 3) — plain JSON over
 * HTTP with HTTP Basic Auth (secret key as username, blank password), so this needs no SDK
 * dependency, matching the rest of this codebase's style (`lib/pos/eposPrint.ts`'s raw
 * `fetch()` POST to a printer). Every function here does real network I/O and is deliberately
 * NOT unit tested directly — `src/lib/billing/subscriptionState.ts` carries the pure logic
 * that IS tested; these are thin glue, same split as `printReceiptViaEpos` vs. `buildEposPrintXml`.
 *
 * Docs: https://www.omise.co/api (test mode keys start with `skey_test_`/`pkey_test_`, work
 * immediately with no approval wait — see published test card numbers for exercising both the
 * success and decline paths end-to-end without spending real money).
 */

const OMISE_API_BASE = "https://api.omise.co";

function getSecretKey(): string {
  const key = process.env.OMISE_SECRET_KEY;
  if (!key) {
    throw new Error("Missing OMISE_SECRET_KEY env var. Get a test/live secret key from your Omise dashboard.");
  }
  return key;
}

function authHeader(): string {
  return `Basic ${Buffer.from(`${getSecretKey()}:`).toString("base64")}`;
}

export interface OmiseErrorInfo {
  code: string;
  message: string;
}

export interface OmiseResult<T> {
  ok: boolean;
  data?: T;
  error?: OmiseErrorInfo;
}

async function omiseRequest<T>(path: string, params: Record<string, string>): Promise<OmiseResult<T>> {
  try {
    const body = new URLSearchParams(params);
    const response = await fetch(`${OMISE_API_BASE}${path}`, {
      method: "POST",
      headers: {
        Authorization: authHeader(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const json = (await response.json()) as Record<string, unknown>;
    if (!response.ok || json.object === "error") {
      return {
        ok: false,
        error: {
          code: typeof json.code === "string" ? json.code : "unknown_error",
          message: typeof json.message === "string" ? json.message : `Omise request failed (${response.status})`,
        },
      };
    }
    return { ok: true, data: json as T };
  } catch (err) {
    return {
      ok: false,
      error: { code: "network_error", message: err instanceof Error ? err.message : "Omise request failed" },
    };
  }
}

interface OmiseCustomer {
  id: string;
  default_card: string | null;
}

/** Creates a new Omise customer with a tokenized card as its default. `token` is a `tokn_...` id from Omise.js — never a raw card number. */
export async function createOmiseCustomer(token: string): Promise<OmiseResult<OmiseCustomer>> {
  return omiseRequest<OmiseCustomer>("/customers", { card: token });
}

/** Attaches a new card token to an existing customer and sets it as the default. */
export async function updateOmiseCustomerCard(customerId: string, token: string): Promise<OmiseResult<OmiseCustomer>> {
  return omiseRequest<OmiseCustomer>(`/customers/${customerId}`, { card: token });
}

interface OmiseCharge {
  id: string;
  status: string; // "successful" | "failed" | "pending" | ...
  paid: boolean;
  failure_code: string | null;
  failure_message: string | null;
}

/** Charges a customer's default card. `amountSatang` is THB * 100 (Omise amounts are in the smallest currency unit). */
export async function chargeOmiseCustomer(
  customerId: string,
  amountSatang: number
): Promise<OmiseResult<OmiseCharge>> {
  return omiseRequest<OmiseCharge>("/charges", {
    amount: String(Math.round(amountSatang)),
    currency: "thb",
    customer: customerId,
  });
}
