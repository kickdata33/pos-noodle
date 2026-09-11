import assert from "node:assert/strict";
import test from "node:test";

import { extractShopSlug } from "../src/lib/shop/hostname";

test("no app domain configured yet → always null (safe before the domain is purchased)", () => {
  assert.equal(extractShopSlug("champnoodles-bonkai.example.com", null), null);
  assert.equal(extractShopSlug("champnoodles-bonkai.example.com", ""), null);
  assert.equal(extractShopSlug("champnoodles-bonkai.example.com", undefined), null);
});

test("no host on the request → null", () => {
  assert.equal(extractShopSlug(null, "example.com"), null);
  assert.equal(extractShopSlug(undefined, "example.com"), null);
  assert.equal(extractShopSlug("", "example.com"), null);
});

test("the apex domain itself → null (root/marketing/signup/superadmin surface)", () => {
  assert.equal(extractShopSlug("example.com", "example.com"), null);
  assert.equal(extractShopSlug("example.com:443", "example.com"), null, "port is ignored");
});

test("www on the apex domain → null, same as bare apex", () => {
  assert.equal(extractShopSlug("www.example.com", "example.com"), null);
});

test("a real shop subdomain resolves to its slug", () => {
  assert.equal(extractShopSlug("champnoodles-bonkai.example.com", "example.com"), "champnoodles-bonkai");
});

test("case-insensitive on both host and app domain", () => {
  assert.equal(extractShopSlug("Champ.EXAMPLE.com", "example.com"), "champ");
  assert.equal(extractShopSlug("champ.example.com", "EXAMPLE.COM"), "champ");
});

test("localhost and Vercel preview domains never carry a shop slug", () => {
  assert.equal(extractShopSlug("localhost:3000", "example.com"), null);
  assert.equal(extractShopSlug("pos-noodle.vercel.app", "example.com"), null);
  assert.equal(extractShopSlug("pos-noodle-git-feature-x.vercel.app", "example.com"), null);
});

test("a nested subdomain (two labels) is treated as no slug, not the first label", () => {
  assert.equal(extractShopSlug("a.b.example.com", "example.com"), null);
});

test("a host that merely contains the app domain as a substring does not match", () => {
  assert.equal(extractShopSlug("notexample.com", "example.com"), null);
  assert.equal(extractShopSlug("example.com.evil.com", "example.com"), null);
});
