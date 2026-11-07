"use client";

import { useEffect, useState } from "react";

import { usePosCatalog } from "@/components/pos/PosCatalogContext";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { formatTime } from "@/lib/format";
import { describeJob, describeProblem, summarizePrintHealth } from "@/lib/pos/printHealth";
import { reprintJob } from "@/lib/pos/printQueue";
import { printAgentRepository, printJobRepository } from "@/repositories/printJobRepository";
import type { PrintAgent, PrintJob } from "@/types";

/**
 * Printing status across every POS screen (mounted once in the /pos layout): offline Print
 * Agents, printers that aren't ready, jobs waiting too long, and jobs that need a human —
 * "uncertain" ones especially, where the system can't know whether paper came out, so staff get
 * "พิมพ์ใหม่" (a new job) or "ออกแล้ว" (dismiss) instead of an automatic retry that might print
 * twice. Renders nothing when all is well, or in shops that don't print through the queue.
 */
export function PrintStatusBanner() {
  const { shopId, settings } = usePosCatalog();
  const { appUser } = useAuth();
  const usesQueue = Boolean(
    settings?.printStation?.checkBillEnabled ||
      settings?.printStation?.kitchenEnabled ||
      settings?.printStation?.tableQrEnabled ||
      settings?.printStation?.receiptEnabled
  );
  const [agents, setAgents] = useState<PrintAgent[]>([]);
  const [jobs, setJobs] = useState<PrintJob[]>([]);
  const [now, setNow] = useState(0);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    if (!usesQueue) return;
    const offAgents = printAgentRepository.subscribeForShop(shopId, setAgents);
    const offJobs = printJobRepository.subscribeUnsettledForShop(shopId, setJobs);
    return () => {
      offAgents();
      offJobs();
    };
  }, [shopId, usesQueue]);
  useEffect(() => {
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const timer = setInterval(tick, 15_000);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, []);

  if (!usesQueue || now === 0) return null;
  const health = summarizePrintHealth(agents, jobs, now);
  const nothingToSay =
    health.offlineAgents.length === 0 &&
    health.printerIssues.length === 0 &&
    health.stuckPending.length === 0 &&
    health.problems.length === 0;
  if (nothingToSay) return null;

  async function reprint(job: PrintJob) {
    if (!appUser) return;
    setBusyId(job.id);
    try {
      await reprintJob(job, appUser.id);
      await printJobRepository.update(job.id, { problemAcknowledged: true });
    } finally {
      setBusyId(null);
    }
  }
  async function dismiss(job: PrintJob) {
    setBusyId(job.id);
    try {
      await printJobRepository.update(job.id, { problemAcknowledged: true });
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="border-b border-destructive/40 bg-destructive/10 px-4 py-2 text-sm" role="status">
      {health.offlineAgents.map((a) => (
        <p key={a.id} className="font-semibold text-destructive">
          โปรแกรมพิมพ์ “{a.name}” ออฟไลน์
          {a.lastSeenAt ? ` ตั้งแต่ ${formatTime(a.lastSeenAt)}` : " (ยังไม่เคยเชื่อมต่อ)"} — งานพิมพ์จะรอในคิว
          ตรวจว่าคอมเปิดอยู่และต่ออินเทอร์เน็ต
        </p>
      ))}
      {health.printerIssues.map((p) => (
        <p key={`${p.agent.id}-${p.station}`} className="font-semibold text-destructive">
          เครื่องพิมพ์ {p.printerName} ไม่พร้อม: {p.detail} — งานพิมพ์จะรอจนเครื่องพร้อม
        </p>
      ))}
      {health.stuckPending.length > 0 ? (
        <p className="text-destructive">
          มีงานรอพิมพ์ {health.stuckPending.length} ใบนานเกินปกติ ตรวจว่าโปรแกรมพิมพ์หรือหน้าสถานีพิมพ์เปิดอยู่
        </p>
      ) : null}
      {health.problems.length > 0 ? (
        <ul className="mt-1 grid gap-1">
          {health.problems.slice(0, 5).map((job) => (
            <li key={job.id} className="flex flex-wrap items-center gap-2">
              <span className="font-medium">
                {describeJob(job)} ({formatTime(job.createdAt)}):
              </span>
              <span className="text-destructive">{describeProblem(job)}</span>
              <Button size="sm" variant="outline" disabled={busyId === job.id} onClick={() => reprint(job)}>
                พิมพ์ใหม่
              </Button>
              <Button size="sm" variant="ghost" disabled={busyId === job.id} onClick={() => dismiss(job)}>
                ออกแล้ว ไม่ต้องพิมพ์
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
