import assert from "node:assert/strict";
import test from "node:test";

import { isValidSlug, RESERVED_SLUGS, slugify } from "../src/lib/shop/slug";

test("accepts lowercase letters, digits, and single hyphens between segments", () => {
  assert.equal(isValidSlug("champnoodles-bonkai"), true);
  assert.equal(isValidSlug("shop1"), true);
  assert.equal(isValidSlug("a-b-c"), true);
});

test("rejects uppercase, spaces, and non-ASCII", () => {
  assert.equal(isValidSlug("ChampNoodles"), false);
  assert.equal(isValidSlug("champ noodles"), false);
  assert.equal(isValidSlug("แชมป์"), false);
});

test("rejects leading/trailing/doubled hyphens", () => {
  assert.equal(isValidSlug("-champ"), false);
  assert.equal(isValidSlug("champ-"), false);
  assert.equal(isValidSlug("champ--noodles"), false);
});

test("enforces min/max length", () => {
  assert.equal(isValidSlug("ab"), false, "too short");
  assert.equal(isValidSlug("a".repeat(41)), false, "too long");
  assert.equal(isValidSlug("abc"), true, "exactly the minimum");
  assert.equal(isValidSlug("a".repeat(40)), true, "exactly the maximum");
});

test("rejects every reserved slug", () => {
  for (const reserved of RESERVED_SLUGS) {
    assert.equal(isValidSlug(reserved), false, `"${reserved}" should be reserved`);
  }
});

test("rejects non-string input without throwing", () => {
  // @ts-expect-error deliberately testing a bad input type
  assert.equal(isValidSlug(undefined), false);
  // @ts-expect-error deliberately testing a bad input type
  assert.equal(isValidSlug(123), false);
});

test("slugify lowercases and hyphenates arbitrary text", () => {
  assert.equal(slugify("Champ Noodles"), "champ-noodles");
  assert.equal(slugify("  Champ   Noodles!! "), "champ-noodles");
});

test("slugify drops non-ASCII (e.g. Thai) rather than mangling it", () => {
  assert.equal(slugify("Champ noodles บ่อนไก่"), "champ-noodles");
});

test("slugify trims leading/trailing separators produced by punctuation at the edges", () => {
  assert.equal(slugify("-champ-"), "champ");
  assert.equal(slugify("!!!champ!!!"), "champ");
});
