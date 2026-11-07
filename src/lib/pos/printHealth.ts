import type { PrintAgent, PrintJob } from "@/types";

/**
 * What the POS should warn about regarding printing (item: "ให้หน้า POS แสดงสถานะเมื่อสถานีพิมพ์
 * ออฟไลน์หรืองานมีปัญหา"). Pure, unit-tested in `scripts/printHealth.test.ts`.
 */

/** No heartbeat for this long → the agent's PC is off, asleep, offline or the program stopped. */
export const AGENT_OFFLINE_MS = 2 * 60 * 1000;
/** A job nobody has picked up for this long is worth telling staff about. */
export const PENDING_STUCK_MS = 90 * 1000;
/** Claimed but not finished for this long → the station probably died mid-job. */
export const PRINTING_STUCK_MS = 3 * 60 * 1000;

export interface PrintHealth {
  offlineAgents: PrintAgent[];
  printerIssues: { agent: PrintAgent; station: string; printerName: string; detail: string }[];
  stuckPending: PrintJob[];
  /** Jobs staff must look at: failed, uncertain, or stuck mid-print — and not yet dealt with. */
  problems: PrintJob[];
}

export function summarizePrintHealth(agents: PrintAgent[], jobs: PrintJob[], now: number): PrintHealth {
  const active = agents.filter((a) => !a.revokedAt);
  const offlineAgents = active.filter((a) => !a.lastSeenAt || now - a.lastSeenAt > AGENT_OFFLINE_MS);
  const printerIssues = active
    .filter((a) => !offlineAgents.includes(a))
    .flatMap((agent) =>
      Object.entries(agent.printers ?? {})
        .filter(([, p]) => p && !p.ready)
        .map(([station, p]) => ({ agent, station, printerName: p!.name, detail: p!.detail }))
    );
  const stuckPending = jobs.filter((j) => j.status === "pending" && now - j.createdAt > PENDING_STUCK_MS);
  const problems = jobs
    .filter(
      (j) =>
        !j.problemAcknowledged &&
        (j.status === "failed" ||
          j.status === "uncertain" ||
          (j.status === "printing" && now - (j.claimedAt ?? j.createdAt) > PRINTING_STUCK_MS))
    )
    .sort((a, b) => b.createdAt - a.createdAt);
  return { offlineAgents, printerIssues, stuckPending, problems };
}

const KIND_LABEL: Record<PrintJob["kind"], string> = {
  kitchen: "ใบครัว",
  checkBill: "ใบแจ้งค่าอาหาร",
  tableQr: "ใบ QR",
  receipt: "ใบเสร็จ",
};

/** "ใบเสร็จ โต๊ะ 3" style label for a job in the problem list. */
export function describeJob(job: Pick<PrintJob, "kind" | "lines">): string {
  const big = job.lines.find((l) => l.size === 2)?.text;
  const table = job.lines.find((l) => l.text.startsWith("โต๊ะ"))?.text;
  const where = job.kind === "receipt" || job.kind === "checkBill" ? table : big;
  return [KIND_LABEL[job.kind] ?? "งานพิมพ์", where].filter(Boolean).join(" ");
}

export function describeProblem(job: Pick<PrintJob, "status" | "error">): string {
  if (job.status === "uncertain") return job.error || "ส่งเข้าเครื่องพิมพ์แล้วแต่ไม่แน่ใจว่าออก ตรวจที่เครื่องก่อนสั่งใหม่";
  if (job.status === "failed") return job.error || "พิมพ์ไม่สำเร็จ";
  return "ค้างระหว่างพิมพ์ ตรวจที่เครื่องก่อนสั่งใหม่";
}
