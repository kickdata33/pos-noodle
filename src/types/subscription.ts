import type { EpochMillis, WithId } from "./common";

/**
 * `trialing` — free trial period, no charge attempted yet.
 * `active` — a real charge has succeeded, shop has full access.
 * `past_due` — a charge failed; shop is inside its 3-day grace window (still has access,
 *   see `SuspensionBanner`).
 * `suspended` — trial ended with no card on file, or grace period expired unpaid.
 *   `/admin` and `/pos` layouts block access; `/billing` stays reachable so the shop can
 *   recover on its own.
 * `canceled` — reserved for a future explicit-cancellation flow, not set anywhere yet in
 *   Phase 3 v1.
 */
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "suspended" | "canceled";

/**
 * Platform billing state for one shop (SaaS roadmap Phase 3) — completely separate from
 * `ShopSettings` (the shop's own operational config) and from `Payment`/`PaymentMethod`
 * (the shop's own POS checkout records for ITS customers). This is the shop paying US.
 *
 * Server-only: Admin SDK access exclusively (see `firestore.rules` — denied to every client,
 * not even the shop's own admin can read this directly; the `/billing` and `/superadmin`
 * pages read it via server routes). Doc id === shopId, one doc per shop.
 */
export interface Subscription extends WithId {
  shopId: string;
  status: SubscriptionStatus;
  /** When the free trial ends. Set at provisioning from `BillingConfig.trialDays`. */
  trialEndsAt: EpochMillis;
  /**
   * When the next charge attempt is due. `null` while trialing with no card on file yet.
   * Set to `trialEndsAt` the moment a card is added during trial (first real charge happens
   * exactly when the trial ends, not immediately) — then advances by ~1 month on each
   * successful charge.
   */
  nextBillingDate: EpochMillis | null;
  /**
   * Snapshot of `BillingConfig.monthlyPriceThb` at the time this shop subscribed — a later
   * price change in `billingConfig/default` does not retroactively reprice existing shops
   * mid-cycle.
   */
  priceThb: number;
  /** Omise "cust_..." id — null until the shop's admin adds a card at `/billing`. */
  omiseCustomerId: string | null;
  /** Omise default card id on that customer. */
  omiseCardId: string | null;
  lastChargeStatus: "none" | "succeeded" | "failed";
  lastChargeAt: EpochMillis | null;
  /** Omise failure_code/message, shown to the superadmin and in the suspension banner. */
  lastChargeError: string | null;
  /** Set on a failed charge (now + 3 days); cleared on the next successful charge. */
  graceEndsAt: EpochMillis | null;
  createdAt: EpochMillis;
  updatedAt: EpochMillis;
}
