import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import QRCode from "qrcode";

import { OUTCOME } from "./core.js";

const PS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "ps");

/** Run one of our PowerShell scripts and parse the last JSON line it prints. */
export function runPowerShell(script, args, { timeoutMs = 90_000 } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(PS_DIR, script), ...args],
      { windowsHide: true }
    );
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(e);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, out, err, json: lastJsonLine(out) });
    });
  });
}

/**
 * Like `runPowerShell`, but resolves `early` the moment the script writes `marker` to stdout —
 * well before the process actually exits — instead of only resolving once everything is done.
 * `print-ticket.ps1` writes `##SUBMITTED##` right after Windows accepts the job, then spends up
 * to its own `-TimeoutSec` watching the spooler until the ticket actually leaves the queue
 * (physically printing). A caller that only needs to know "did this at least reach the printer"
 * can act on `early` and let `final` (which resolves exactly like `runPowerShell`'s promise
 * always did) settle on its own time — see `WindowsPrinter.print`'s own comment for why that
 * matters for a busy kitchen.
 */
export function runPowerShellPipelined(script, args, { timeoutMs = 90_000, marker = "##SUBMITTED##" } = {}) {
  const child = spawn(
    "powershell.exe",
    ["-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", path.join(PS_DIR, script), ...args],
    { windowsHide: true }
  );
  let out = "";
  let err = "";
  let sawMarker = false;
  let resolveEarly;
  const early = new Promise((res) => {
    resolveEarly = res;
  });
  const final = new Promise((resolveFinal) => {
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (d) => {
      out += d;
      if (!sawMarker && out.includes(marker)) {
        sawMarker = true;
        resolveEarly({ submitted: true });
      }
    });
    child.stderr.on("data", (d) => (err += d));
    const timer = setTimeout(() => child.kill(), timeoutMs);
    child.on("error", (e) => {
      clearTimeout(timer);
      // Never got the marker, and never will — the process is gone.
      if (!sawMarker) resolveEarly({ submitted: false });
      resolveFinal({ code: null, out, err: `${err}${e.message}`, json: lastJsonLine(out) });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (!sawMarker) resolveEarly({ submitted: false });
      resolveFinal({ code, out, err, json: lastJsonLine(out) });
    });
  });
  return { early, final };
}

export function lastJsonLine(text) {
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).reverse();
  for (const line of lines) {
    if (!line.startsWith("{")) continue;
    try {
      return JSON.parse(line);
    } catch {
      // keep looking
    }
  }
  return null;
}

/** Shop-time label printed at the top of every ticket (the queue never bakes time into lines). */
export function ticketTimeLabel(epochMs) {
  return new Date(epochMs).toLocaleString("th-TH", {
    timeZone: "Asia/Bangkok",
    dateStyle: "short",
    timeStyle: "short",
  });
}

/**
 * Turns the print script's report into an outcome for AgentCore. The script prints a
 * "submitted" marker the moment Windows accepted the job, so even when it dies afterwards we
 * know the job may have printed (→ uncertain), versus never reaching the queue (→ retry).
 */
export function interpretPrintResult({ code, out, json }) {
  if (json && typeof json.outcome === "string") {
    return { outcome: json.outcome, detail: json.detail || "" };
  }
  if (out.includes("##SUBMITTED##")) {
    return { outcome: OUTCOME.ERROR, detail: `โปรแกรมพิมพ์หยุดหลังส่งงาน (code ${code})` };
  }
  return { outcome: OUTCOME.NOT_SUBMITTED, detail: `ส่งพิมพ์ไม่ได้ (code ${code})` };
}

/**
 * Prints through the normal Windows printer driver with GDI+ (System.Drawing), the same way the
 * G2 print agent renders Thai: Windows' own Thai fonts, any printer with a driver, the driver's
 * own paper size/cutter settings. The ticket content is exactly the queue's `lines` + QR — the
 * same documents the POS already builds.
 */
export class WindowsPrinter {
  constructor({ workDir = path.join(tmpdir(), "ranpos-print-agent"), log = () => {} } = {}) {
    this.workDir = workDir;
    this.log = log;
  }

  async status(printerName) {
    const r = await runPowerShell("printer-status.ps1", ["-Printer", printerName], { timeoutMs: 30_000 });
    if (!r.json) throw new Error(r.err.trim() || `printer-status exit ${r.code}`);
    return r.json;
  }

  /**
   * Returns as soon as Windows has *accepted* the job, not once it's actually finished printing
   * — `print-ticket.ps1` still spends up to 45s afterwards watching the spooler for the ticket
   * to leave the queue (the printer's own feed+cut time), and that tail used to sit inside this
   * same awaited call. With one printer per station and jobs going out one at a time (`core.js`'s
   * `#drainOnce`), that tail serialized every ticket behind the one before it — fine for an
   * occasional ticket, but a busy kitchen (many tables ordering in the same couple of minutes)
   * fell further and further behind in real time (item: "ร้านใหญ่ 50 โต๊ะ... ปริ้นไม่ทัน เพราะออเดอร์
   * ค่อนข้างไหล"). Now `#drainOnce` only waits for *this* — the fast "did it reach the printer at
   * all" check — before handing it the next pending job; the slow tail resolves in the returned
   * `outcome` promise, watched and finished independently once it settles (see `#settle` there).
   *
   * Returns `{ submitted: false, detail }` when the job never reached Windows' queue at all (same
   * meaning as the old `NOT_SUBMITTED` outcome — safe to put straight back as pending), or
   * `{ submitted: true, outcome: Promise<{outcome, detail}> }` once it has.
   */
  async print(job, printerName) {
    await mkdir(this.workDir, { recursive: true });
    const base = path.join(this.workDir, `${job.id}-${Date.now()}`);
    const jobFile = `${base}.json`;
    const qrFile = job.qrPayload ? `${base}.png` : null;
    // The PowerShell script reads both files for as long as it runs — including the whole watch
    // tail — so cleanup can't happen until `final` settles, in either branch below.
    const cleanup = async () => {
      await rm(jobFile, { force: true }).catch(() => undefined);
      if (qrFile) await rm(qrFile, { force: true }).catch(() => undefined);
    };
    try {
      if (qrFile) await QRCode.toFile(qrFile, job.qrPayload, { width: 480, margin: 1, errorCorrectionLevel: "M" });
      const payload = {
        printerName,
        docName: `RanPOS-${job.id}`,
        timeLabel: ticketTimeLabel(job.createdAt ?? Date.now()),
        lines: job.lines ?? [],
        qrFile,
        qrCaption: job.qrCaption ?? null,
      };
      await writeFile(jobFile, JSON.stringify(payload), "utf8");
      const { early, final } = runPowerShellPipelined("print-ticket.ps1", ["-JobFile", jobFile, "-TimeoutSec", "45"], {
        timeoutMs: 90_000,
      });
      const { submitted } = await early;
      if (!submitted) {
        // `early` only resolves this way once the process has already exited without ever
        // writing the marker, so `final` is already settled — safe to await right away.
        const r = await final;
        if (r.err.trim()) this.log(`print-ticket stderr: ${r.err.trim()}`);
        await cleanup();
        return { submitted: false, detail: interpretPrintResult(r).detail };
      }
      return {
        submitted: true,
        outcome: final.then(async (r) => {
          if (r.err.trim()) this.log(`print-ticket stderr: ${r.err.trim()}`);
          await cleanup();
          return interpretPrintResult(r);
        }),
      };
    } catch (err) {
      await cleanup();
      throw err;
    }
  }
}
