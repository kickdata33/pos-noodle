// Run: cd print-agent && node --test test/   (or `npm run test:agent` from the repo root)
// Scenario tests for the Print Agent's decision logic with an in-memory queue standing in for
// Firestore (same claim-transaction semantics) and a scriptable printer.
import assert from "node:assert/strict";
import test from "node:test";

import { AgentCore, OUTCOME } from "../src/core.js";
import { interpretPrintResult, lastJsonLine, ticketTimeLabel } from "../src/windowsPrinter.js";

/** In-memory print queue shared by any number of agents, like the real `printJobs` collection. */
class FakeQueue {
  constructor() {
    this.jobs = new Map();
    this.online = true;
  }
  add(id, extra = {}) {
    this.jobs.set(id, { id, station: "cashier", status: "pending", createdAt: this.jobs.size, claimedBy: null, lines: [], ...extra });
  }
  storeFor(agentId) {
    const jobs = this.jobs;
    const guard = () => {
      if (!this.online) {
        const err = new Error("client is offline");
        err.code = "unavailable";
        throw err;
      }
    };
    return {
      agentId,
      async claim(id) {
        guard();
        const j = jobs.get(id);
        if (!j || j.status !== "pending") return false;
        Object.assign(j, { status: "printing", claimedBy: agentId });
        return true;
      },
      async release(id, error) {
        guard();
        Object.assign(jobs.get(id), { status: "pending", claimedBy: null, error });
      },
      async finish(id, patch) {
        guard();
        Object.assign(jobs.get(id), patch);
      },
      async listClaimedByMe(station) {
        guard();
        return [...jobs.values()].filter((j) => j.station === station && j.status === "printing" && j.claimedBy === agentId);
      },
    };
  }
  pending() {
    return [...this.jobs.values()].filter((j) => j.status === "pending").map((j) => ({ ...j }));
  }
}

class FakePrinter {
  constructor() {
    this.ready = true;
    this.detail = "พร้อม";
    this.printed = [];
    /** queue of outcomes to return; default delivered */
    this.outcomes = [];
  }
  async status() {
    return { found: true, ready: this.ready, detail: this.detail };
  }
  async print(job) {
    const next = this.outcomes.shift() ?? { outcome: OUTCOME.DELIVERED, detail: "ok" };
    if (next === "throw") throw new Error("powershell crashed");
    if (next.outcome === OUTCOME.DELIVERED || next.outcome === OUTCOME.ERROR || next.outcome === OUTCOME.TIMEOUT) {
      this.printed.push(job.id);
    }
    return next;
  }
}

function agent(queue, printer, agentId = "agentA") {
  return new AgentCore({
    store: queue.storeFor(agentId),
    printer,
    printers: { cashier: "Xprinter XP-80" },
    stations: ["cashier"],
    agentId,
    now: () => 1000,
  });
}

test("a pending job is claimed, printed once and marked sent (not 'printed')", async () => {
  const q = new FakeQueue();
  q.add("qr-table-3", { kind: "tableQr" });
  const p = new FakePrinter();
  await agent(q, p).drain("cashier", q.pending());
  assert.deepEqual(p.printed, ["qr-table-3"]);
  const j = q.jobs.get("qr-table-3");
  assert.equal(j.status, "sent");
  assert.equal(j.printerName, "Xprinter XP-80");
  assert.equal(j.printedAt, 1000);
});

test("jobs print oldest first", async () => {
  const q = new FakeQueue();
  q.add("b", { createdAt: 20 });
  q.add("a", { createdAt: 10 });
  const p = new FakePrinter();
  await agent(q, p).drain("cashier", q.pending());
  assert.deepEqual(p.printed, ["a", "b"]);
});

test("two agents (or a browser station) racing for the same job print it exactly once", async () => {
  const q = new FakeQueue();
  q.add("receipt-o1", { kind: "receipt" });
  const p1 = new FakePrinter();
  const p2 = new FakePrinter();
  const snapshot = q.pending();
  await Promise.all([agent(q, p1, "A").drain("cashier", snapshot), agent(q, p2, "B").drain("cashier", snapshot)]);
  assert.equal(p1.printed.length + p2.printed.length, 1);
});

test("overlapping drain calls on one agent never print a job twice", async () => {
  const q = new FakeQueue();
  q.add("j1");
  const p = new FakePrinter();
  const a = agent(q, p);
  await Promise.all([a.drain("cashier", q.pending()), a.drain("cashier", q.pending()), a.drain("cashier", q.pending())]);
  assert.deepEqual(p.printed, ["j1"]);
});

test("printer unplugged before printing: nothing is claimed, jobs wait as pending, then print when it's back", async () => {
  const q = new FakeQueue();
  q.add("j1");
  const p = new FakePrinter();
  p.ready = false;
  p.detail = "เครื่องพิมพ์ออฟไลน์";
  const a = agent(q, p);
  await a.drain("cashier", q.pending());
  assert.equal(q.jobs.get("j1").status, "pending");
  assert.equal(q.jobs.get("j1").claimedBy, null);
  assert.equal(a.printerState.cashier.ready, false, "heartbeat will report the printer as not ready");
  p.ready = true;
  await a.drain("cashier", q.pending());
  assert.equal(q.jobs.get("j1").status, "sent");
});

test("printer vanished between the check and the print (not submitted): job goes back to pending, pass stops", async () => {
  const q = new FakeQueue();
  q.add("j1", { createdAt: 1 });
  q.add("j2", { createdAt: 2 });
  const p = new FakePrinter();
  p.outcomes.push({ outcome: OUTCOME.NOT_SUBMITTED, detail: "ไม่พบเครื่องพิมพ์" });
  await agent(q, p).drain("cashier", q.pending());
  assert.equal(q.jobs.get("j1").status, "pending");
  assert.equal(q.jobs.get("j1").claimedBy, null);
  assert.equal(q.jobs.get("j2").status, "pending", "j2 wasn't even tried");
});

test("printer disconnected mid-job (spooler error): job becomes 'uncertain' — never auto-reprinted", async () => {
  const q = new FakeQueue();
  q.add("receipt-o9", { kind: "receipt" });
  const p = new FakePrinter();
  p.outcomes.push({ outcome: OUTCOME.ERROR, detail: "เครื่องพิมพ์หลุดระหว่างพิมพ์" });
  const a = agent(q, p);
  await a.drain("cashier", q.pending());
  const j = q.jobs.get("receipt-o9");
  assert.equal(j.status, "uncertain");
  assert.match(j.error, /ตรวจที่เครื่องพิมพ์ก่อนสั่งใหม่/);
  await a.drain("cashier", q.pending());
  assert.equal(p.printed.length, 1, "no second attempt by itself");
});

test("stuck in the Windows queue (timeout) and a crash after submitting are both 'uncertain'", async () => {
  const q = new FakeQueue();
  q.add("t1", { createdAt: 1 });
  q.add("t2", { createdAt: 2 });
  const p = new FakePrinter();
  p.outcomes.push({ outcome: OUTCOME.TIMEOUT, detail: "ค้างในคิว" }, "throw");
  await agent(q, p).drain("cashier", q.pending());
  assert.equal(q.jobs.get("t1").status, "uncertain");
  assert.equal(q.jobs.get("t2").status, "uncertain");
});

test("station offline: claim fails, job stays pending; back online it prints", async () => {
  const q = new FakeQueue();
  q.add("j1");
  const p = new FakePrinter();
  const a = agent(q, p);
  q.online = false;
  await a.drain("cashier", q.pending());
  q.online = true;
  assert.equal(q.jobs.get("j1").status, "pending");
  assert.deepEqual(p.printed, []);
  await a.drain("cashier", q.pending());
  assert.equal(q.jobs.get("j1").status, "sent");
});

test("restart after dying mid-print: its own claimed jobs become 'uncertain', others untouched", async () => {
  const q = new FakeQueue();
  q.add("mine", { status: "printing", claimedBy: "agentA" });
  q.add("theirs", { status: "printing", claimedBy: "browser-session" });
  q.add("waiting");
  await agent(q, new FakePrinter()).recover();
  assert.equal(q.jobs.get("mine").status, "uncertain");
  assert.equal(q.jobs.get("theirs").status, "printing");
  assert.equal(q.jobs.get("waiting").status, "pending");
});

test("heartbeat carries printer readiness for the POS banner", async () => {
  const q = new FakeQueue();
  const p = new FakePrinter();
  p.ready = false;
  p.detail = "กระดาษหมด";
  const a = agent(q, p);
  await a.checkPrinters();
  const hb = a.heartbeatPayload();
  assert.equal(hb.lastSeenAt, 1000);
  assert.deepEqual(hb.printers.cashier, { name: "Xprinter XP-80", ready: false, detail: "กระดาษหมด" });
});

test("print script results are interpreted conservatively", () => {
  assert.deepEqual(interpretPrintResult({ code: 0, out: '{"outcome":"delivered","detail":"ok"}', json: { outcome: "delivered", detail: "ok" } }), {
    outcome: "delivered",
    detail: "ok",
  });
  // died after Windows accepted the job → may have printed → error (→ uncertain)
  assert.equal(interpretPrintResult({ code: 1, out: "##SUBMITTED##\n", json: null }).outcome, OUTCOME.ERROR);
  // died before submitting → safe to retry
  assert.equal(interpretPrintResult({ code: 1, out: "", json: null }).outcome, OUTCOME.NOT_SUBMITTED);
});

test("helpers: last JSON line, Bangkok time label", () => {
  assert.deepEqual(lastJsonLine('noise\n##SUBMITTED##\n{"a":1}\n'), { a: 1 });
  assert.equal(lastJsonLine("no json"), null);
  // 2026-11-07 13:30 UTC = 20:30 Bangkok
  assert.match(ticketTimeLabel(Date.UTC(2026, 10, 7, 13, 30)), /20:30/);
});
