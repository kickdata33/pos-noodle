/** Tests for who sees a customer's "เรียกพนักงาน"/"เช็คบิล" request (run: npm run test:pos). */
import assert from "node:assert/strict";
import test from "node:test";

import { canReceiveBillRequests, canReceiveStaffCalls } from "../src/lib/pos/customerRequests";

test("admin always receives both kinds of request, regardless of the per-field flags", () => {
  assert.equal(canReceiveStaffCalls({ role: "admin", canReceiveStaffCalls: false }), true);
  assert.equal(canReceiveBillRequests({ role: "admin", canReceiveBillRequests: undefined }), true);
});

test("staff only receives what was explicitly ticked for them", () => {
  assert.equal(canReceiveStaffCalls({ role: "staff", canReceiveStaffCalls: true }), true);
  assert.equal(canReceiveStaffCalls({ role: "staff", canReceiveStaffCalls: false }), false);
  assert.equal(canReceiveStaffCalls({ role: "staff", canReceiveStaffCalls: undefined }), false);
  assert.equal(canReceiveBillRequests({ role: "staff", canReceiveBillRequests: true }), true);
  assert.equal(canReceiveBillRequests({ role: "staff", canReceiveBillRequests: undefined }), false);
});

test("the two permissions are independent — ticking one never implies the other", () => {
  const user = { role: "staff" as const, canReceiveStaffCalls: true, canReceiveBillRequests: false };
  assert.equal(canReceiveStaffCalls(user), true);
  assert.equal(canReceiveBillRequests(user), false);
});

test("no user at all receives nothing", () => {
  assert.equal(canReceiveStaffCalls(null), false);
  assert.equal(canReceiveBillRequests(null), false);
});
