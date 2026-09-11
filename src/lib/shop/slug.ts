/**
 * Shop slug format rules (SaaS roadmap Phase 2) — a slug becomes part of a shop's public
 * subdomain (`{slug}.<app domain>`), so it's kept ASCII, lowercase, hyphen-separated, and free
 * of anything that would collide with a real route on the apex domain (`/signup`, `/superadmin`,
 * `/api`, ...) or read as a generic/reserved hostname (`www`, `admin`, ...).
 */

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MIN_LENGTH = 3;
const MAX_LENGTH = 40;

/** Anything here would be confusing or actively broken as a shop subdomain. */
export const RESERVED_SLUGS = new Set([
  "www",
  "app",
  "api",
  "admin",
  "pos",
  "signup",
  "login",
  "superadmin",
  "order",
  "assets",
  "static",
  "mail",
  "ftp",
  "ns1",
  "ns2",
  "support",
  "help",
  "blog",
  "status",
  "default-shop",
]);

export function isValidSlug(slug: string): boolean {
  return (
    typeof slug === "string" &&
    slug.length >= MIN_LENGTH &&
    slug.length <= MAX_LENGTH &&
    SLUG_PATTERN.test(slug) &&
    !RESERVED_SLUGS.has(slug)
  );
}

/**
 * Best-effort conversion of free-typed text into a slug candidate — lowercases, transliterates
 * nothing (Thai text is simply dropped, since a subdomain must be ASCII), collapses runs of
 * non-alphanumeric characters into single hyphens, and trims leading/trailing hyphens. The
 * result still needs `isValidSlug()` (it can come out too short, e.g. from all-Thai input).
 */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
