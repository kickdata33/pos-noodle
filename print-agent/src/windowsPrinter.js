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

  async print(job, printerName) {
    await mkdir(this.workDir, { recursive: true });
    const base = path.join(this.workDir, `${job.id}-${Date.now()}`);
    const jobFile = `${base}.json`;
    const qrFile = job.qrPayload ? `${base}.png` : null;
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
      const r = await runPowerShell("print-ticket.ps1", ["-JobFile", jobFile, "-TimeoutSec", "45"], {
        timeoutMs: 90_000,
      });
      if (r.err.trim()) this.log(`print-ticket stderr: ${r.err.trim()}`);
      return interpretPrintResult(r);
    } finally {
      await rm(jobFile, { force: true }).catch(() => undefined);
      if (qrFile) await rm(qrFile, { force: true }).catch(() => undefined);
    }
  }
}
