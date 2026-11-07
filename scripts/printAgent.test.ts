/**
 * Tests for the Print Agent's server/POS side (run: npm run test:pos): pairing codes, the POS
 * printing-health banner logic, and the automatic receipt job.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { describeJob, summarizePrintHealth } from "../src/lib/pos/printHealth";
import { autoReceiptJobId, receiptJobFields } from "../src/lib/pos/printTickets";
import {
  agentUid,
  decodePairingCode,
  encodePairingCode,
  generateAgentSecret,
  hashAgentSecret,
  verifyAgentSecret,
} from "../src/lib/printAgent/pairing";
import type { Order, PrintAgent, PrintJob, ShopSettings } from "../src/types";

test("pairing code round-trips and the secret verifies only against its own hash", () => {
  const secret = generateAgentSecret();
  assert.ok(secret.length >= 40);
  const code = encodePairingCode({ origin: "https://yodnk.ranpos.online", agentId: "ag1", secret });
  assert.ok(code.startsWith("RANPOS1."));
  assert.deepEqual(decodePairingCode(code), { origin: "https://yodnk.ranpos.online", agentId: "ag1", secret });
  assert.equal(decodePairingCode("garbage"), null);
  assert.equal(decodePairingCode("RANPOS1.%%%"), null);
  const hash = hashAgentSecret(secret);
  assert.equal(verifyAgentSecret(secret, hash), true);
  assert.equal(verifyAgentSecret(generateAgentSecret(), hash), false);
  assert.equal(agentUid("ag1"), "printagent_ag1");
});

function agent(overrides: Partial<PrintAgent> = {}): PrintAgent {
  return {
    id: "ag1",
    shopId: "s",
    name: "คอมแคชเชียร์",
    stations: ["cashier"],
    createdAt: 0,
    createdByName: "admin",
    revokedAt: null,
    lastSeenAt: 1_000_000,
    printers: { cashier: { name: "Xprinter XP-80", ready: true, detail: "พร้อม" } },
    ...overrides,
  };
}

function job(overrides: Partial<PrintJob> = {}): PrintJob {
  return {
    id: "j",
    shopId: "s",
    station: "cashier",
    kind: "receipt",
    orderId: "o",
    lines: [{ text: "โต๊ะ 3" }],
    qrPayload: null,
    qrCaption: null,
    status: "pending",
    claimedBy: null,
    error: null,
    createdBy: "u",
    createdAt: 1_000_000,
    printedAt: null,
    ...overrides,
  };
}

test("health: online agent with ready printer and fresh jobs → nothing to report", () => {
  const h = summarizePrintHealth([agent()], [job()], 1_000_000 + 30_000);
  assert.equal(h.offlineAgents.length + h.printerIssues.length + h.stuckPending.length + h.problems.length, 0);
});

test("health: silent agent is offline; revoked agents are ignored", () => {
  const now = 1_000_000 + 3 * 60_000;
  const h = summarizePrintHealth([agent(), agent({ id: "old", revokedAt: 5 })], [], now);
  assert.deepEqual(h.offlineAgents.map((a) => a.id), ["ag1"]);
});

test("health: printer not ready is reported (only for online agents)", () => {
  const a = agent({ printers: { cashier: { name: "Xprinter XP-80", ready: false, detail: "กระดาษหมด" } } });
  const h = summarizePrintHealth([a], [], 1_000_000 + 10_000);
  assert.equal(h.printerIssues[0].detail, "กระดาษหมด");
});

test("health: waiting too long, uncertain/failed, and stuck mid-print are surfaced; dealt-with ones are not", () => {
  const now = 1_000_000 + 10 * 60_000;
  const h = summarizePrintHealth(
    [agent({ lastSeenAt: now })],
    [
      job({ id: "wait", status: "pending" }),
      job({ id: "unsure", status: "uncertain" }),
      job({ id: "fail", status: "failed" }),
      job({ id: "stuck", status: "printing", claimedAt: 1_000_000 }),
      job({ id: "done", status: "uncertain", problemAcknowledged: true }),
    ],
    now
  );
  assert.deepEqual(h.stuckPending.map((j) => j.id), ["wait"]);
  assert.deepEqual(h.problems.map((j) => j.id).sort(), ["fail", "stuck", "unsure"]);
});

test("receipt job: fixed id per order, cashier station, same receipt content, time left to the printer", () => {
  assert.equal(autoReceiptJobId("o42"), "receipt-o42");
  assert.equal(autoReceiptJobId("o42"), autoReceiptJobId("o42"));
  const order = {
    id: "o42",
    orderNumber: "A-0042",
    shopId: "s",
    orderType: "dineIn",
    channelId: "c",
    channelName: "หน้าร้าน",
    tableId: "t",
    tableName: "3",
    status: "PAID",
    items: [{ id: "i", productId: "p", productName: "เบียร์ช้าง", quantity: 2, unitPrice: 89, modifiers: [], note: "", lineTotal: 178 }],
    subtotal: 178,
    discount: 0,
    serviceCharge: 0,
    tax: 0,
    total: 178,
    paymentStatus: "PAID",
    paymentMethodId: "cash",
    paymentMethodName: "เงินสด",
    cashReceived: 200,
    changeDue: 22,
    createdBy: "u",
    createdByName: "u",
    createdAt: 1,
    updatedAt: 1,
    paidAt: 2,
  } as Order;
  const settings = { name: "ยอดรัก", currency: "THB", receiptFooterText: "", phone: "", address: "", taxId: "" } as ShopSettings;
  const fields = receiptJobFields(order, settings);
  assert.equal(fields.station, "cashier");
  assert.equal(fields.kind, "receipt");
  assert.equal(fields.status, "pending");
  assert.ok(fields.lines.some((l) => l.text.includes("เบียร์ช้าง")));
  assert.ok(fields.lines.some((l) => l.text.includes("เงินสด")));
  assert.equal(describeJob({ kind: "receipt", lines: fields.lines }), "ใบเสร็จ โต๊ะ 3");
});
