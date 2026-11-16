/**
 * The Print Agent's decision logic, with Firestore (`store`) and the Windows printer (`printer`)
 * injected so it can be tested without either (test/core.test.js).
 *
 * Job lifecycle, as the agent drives it:
 *   pending ──claim (transaction)──▶ printing ──▶ sent        Windows took the job and finished
 *                                     │                       handing it to the printer
 *                                     ├──▶ uncertain           reached (or may have reached) the
 *                                     │                       printer, then an error/timeout —
 *                                     │                       staff check paper before reprinting
 *                                     └──▶ pending (released)  never reached the printer (printer
 *                                                             offline / not found) — retried later
 * The agent never marks "printed": a USB receipt printer's driver can only confirm it accepted
 * the data, not that paper came out.
 *
 * `#drainOnce` only waits for *reaching the printer* (`printer.print`'s fast `submitted` check)
 * before claiming and starting the next pending job — not for that ticket to actually finish
 * printing (feed + cut, watched by `printer.print`'s slower `outcome` promise). One ticket at a
 * time per *physical* printer was always the right model, but making every *claim* wait on the
 * previous ticket's full confirmation too was an artificial extra queue on top of it (item: "ร้าน
 * ใหญ่ 50 โต๊ะ... ปริ้นไม่ทัน เพราะออเดอร์ค่อนข้างไหล" — a busy kitchen's single printer falling behind
 * real time during a rush). `#settle` resolves each job's own `outcome` whenever it's ready,
 * independently of however many other jobs have since been claimed and handed to the printer.
 *
 * Trade-off worth knowing: a printer that dies *mid-ticket* (paper runs out, unplugged while
 * printing) is only discovered once that ticket's own `outcome` settles — by then, this pass may
 * already have handed the printer several more tickets behind it, instead of stopping at the
 * first failure the way a fully serial loop could. Every one of those still lands safely as
 * "uncertain" (never silently lost, never auto-reprinted) — there's just more of them to check
 * before the printer's fixed. A printer that's already down *before* a ticket is even submitted
 * (offline, unplugged, not found) is still caught immediately and still stops the pass, same as
 * before — that check doesn't depend on the slow tail at all.
 */

export const OUTCOME = Object.freeze({
  DELIVERED: "delivered",
  NOT_SUBMITTED: "not_submitted",
  ERROR: "error",
  TIMEOUT: "timeout",
});

export class AgentCore {
  /**
   * @param {object} deps
   * @param {object} deps.store   claim/release/finish/listClaimedByMe — see firestoreStore.js
   * @param {object} deps.printer status(name) / print(job, name) — see windowsPrinter.js
   * @param {Record<string,string>} deps.printers station → Windows printer name
   * @param {string[]} deps.stations
   * @param {string} deps.agentId
   * @param {() => number} [deps.now]
   * @param {(msg: string) => void} [deps.log]
   */
  constructor({
    store,
    printer,
    printers,
    stations,
    agentId,
    now = () => Date.now(),
    log = () => {},
    version = "1.0.0",
    hostname = null,
  }) {
    this.store = store;
    this.printer = printer;
    this.printers = printers;
    this.stations = stations;
    this.agentId = agentId;
    this.now = now;
    this.log = log;
    this.version = version;
    this.hostname = hostname;
    /** station → { name, ready, detail } */
    this.printerState = {};
    /** station → Promise of the drain in progress (one at a time per station) */
    this.draining = {};
    /** station → latest job list that arrived while a drain was running */
    this.again = {};
  }

  /**
   * After a restart: anything this agent had claimed but not finished may or may not have come
   * out. Never reprint automatically — flag it for staff.
   */
  async recover() {
    for (const station of this.stations) {
      const jobs = await this.store.listClaimedByMe(station);
      for (const job of jobs) {
        this.log(`recover: job ${job.id} was mid-print when the agent stopped → uncertain`);
        await this.store.finish(job.id, {
          status: "uncertain",
          error: "โปรแกรมพิมพ์หยุดทำงานระหว่างพิมพ์ ตรวจที่เครื่องพิมพ์ก่อนสั่งใหม่",
          printerName: this.printers[station] ?? null,
        });
      }
    }
  }

  /** Refresh every station's printer state (for the heartbeat / POS banner). */
  async checkPrinters() {
    for (const station of this.stations) await this.checkPrinterFor(station);
    return this.printerState;
  }

  async checkPrinterFor(station) {
    const name = this.printers[station];
    if (!name) {
      this.printerState[station] = { name: "-", ready: false, detail: "ยังไม่ได้เลือกเครื่องพิมพ์ในโปรแกรม" };
      return this.printerState[station];
    }
    try {
      const s = await this.printer.status(name);
      this.printerState[station] = { name, ready: Boolean(s.ready), detail: s.detail || "" };
    } catch (err) {
      this.printerState[station] = { name, ready: false, detail: `ตรวจสถานะไม่ได้: ${err.message}` };
    }
    return this.printerState[station];
  }

  heartbeatPayload() {
    return {
      lastSeenAt: this.now(),
      printers: this.printerState,
      version: this.version,
      hostname: this.hostname,
    };
  }

  /** Print every pending job in `jobs` for `station`, oldest first, one at a time. Safe to call
   * often: a call during a running pass just queues one more pass with the newest list. */
  drain(station, jobs) {
    if (this.draining[station]) {
      this.again[station] = jobs;
      return this.draining[station];
    }
    this.draining[station] = (async () => {
      try {
        let batch = jobs;
        while (batch) {
          this.again[station] = null;
          await this.#drainOnce(station, batch);
          batch = this.again[station];
        }
      } finally {
        this.draining[station] = null;
      }
    })();
    return this.draining[station];
  }

  async #drainOnce(station, jobs) {
    const pending = jobs.filter((j) => j.status === "pending").sort((a, b) => a.createdAt - b.createdAt);
    if (pending.length === 0) return;
    const printerName = this.printers[station];
    // Don't even claim while the printer is down — the jobs stay "pending" (shown as waiting on
    // the POS) and go out by themselves once it's back.
    const state = await this.checkPrinterFor(station);
    if (!printerName || !state.ready) {
      this.log(`station ${station}: printer not ready (${state.detail}) — ${pending.length} job(s) wait`);
      return;
    }
    // Each job's own confirmation (`#settle`) runs in the background, not awaited here — see
    // this file's header comment. Collected so this pass doesn't report "done" (and `drain()`'s
    // "again" re-run logic doesn't move on) until every job it started has actually landed on a
    // final status, even though none of them blocked each other getting there.
    const settling = [];
    for (const job of pending) {
      let claimed;
      try {
        claimed = await this.store.claim(job.id);
      } catch (err) {
        this.log(`claim ${job.id} failed (${err.message}) — offline? will retry`);
        break;
      }
      if (!claimed) continue; // another station got it, or it's no longer pending
      const submission = await this.#submitClaimed(printerName, job);
      if (!submission.submitted) {
        // Never reached Windows' queue → nothing printed → safe to put back for later, and don't
        // hand this printer anything more this pass (same as before: this check is fast, it
        // doesn't depend on the slow watch-tail, so stopping here loses nothing).
        this.log(`job ${job.id} not submitted (${submission.detail}) → back to pending`);
        this.printerState[station] = {
          name: printerName,
          ready: false,
          detail: submission.detail || "เครื่องพิมพ์ไม่พร้อม",
        };
        await this.#safeRelease(job.id, submission.detail || "เครื่องพิมพ์ไม่พร้อม รอพิมพ์ใหม่อัตโนมัติ");
        break;
      }
      this.log(`job ${job.id} → submitted (${printerName}), not waiting for it to finish before the next one`);
      settling.push(this.#settle(printerName, job.id, submission.outcome));
    }
    await Promise.all(settling);
  }

  /** @returns {Promise<{submitted: boolean, detail?: string, outcome?: Promise}>} */
  async #submitClaimed(printerName, job) {
    try {
      return await this.printer.print(job, printerName);
    } catch (err) {
      // Didn't even get far enough to tell us whether Windows took it — treat it the same as a
      // clean "never submitted" so it's safe to retry rather than risk double-printing later.
      this.log(`print ${job.id} threw before submitting: ${err.message}`);
      return { submitted: false, detail: "เกิดข้อผิดพลาดก่อนส่งพิมพ์" };
    }
  }

  /** Waits for one already-submitted job's real outcome and writes its final status — runs
   * independently of whatever else this pass has since claimed and submitted. */
  async #settle(printerName, jobId, outcomePromise) {
    let result;
    try {
      result = await outcomePromise;
    } catch (err) {
      // Unknown how far it got — it may have reached the spooler.
      this.log(`print ${jobId} threw while printing: ${err.message}`);
      await this.#safeFinish(jobId, {
        status: "uncertain",
        error: "เกิดข้อผิดพลาดระหว่างพิมพ์ ตรวจที่เครื่องพิมพ์ก่อนสั่งใหม่",
        printerName,
      });
      return;
    }
    switch (result.outcome) {
      case OUTCOME.DELIVERED:
        this.log(`job ${jobId} → sent (${printerName})`);
        await this.#safeFinish(jobId, { status: "sent", printedAt: this.now(), error: null, printerName });
        return;
      case OUTCOME.NOT_SUBMITTED:
        // Shouldn't happen for an already-submitted job, but handled the same defensively.
        this.log(`job ${jobId} not submitted after all (${result.detail}) → back to pending`);
        await this.#safeRelease(jobId, result.detail || "เครื่องพิมพ์ไม่พร้อม รอพิมพ์ใหม่อัตโนมัติ");
        return;
      case OUTCOME.ERROR:
      case OUTCOME.TIMEOUT:
      default:
        this.log(`job ${jobId} → uncertain (${result.outcome}: ${result.detail})`);
        await this.#safeFinish(jobId, {
          status: "uncertain",
          error: `${result.detail || "เครื่องพิมพ์มีปัญหาระหว่างพิมพ์"} — ตรวจที่เครื่องพิมพ์ก่อนสั่งใหม่`,
          printerName,
        });
        return;
    }
  }

  // A status write that throws couldn't even be queued (Firestore keeps writes made while
  // offline and sends them on reconnect). Logged; if the job stays "printing", recover() flags it
  // as uncertain on the next start — never silently reprinted.
  async #safeFinish(jobId, patch) {
    try {
      await this.store.finish(jobId, patch);
    } catch (err) {
      this.log(`finish ${jobId} failed: ${err.message}`);
    }
  }

  async #safeRelease(jobId, error) {
    try {
      await this.store.release(jobId, error);
    } catch (err) {
      this.log(`release ${jobId} failed: ${err.message}`);
    }
  }
}
