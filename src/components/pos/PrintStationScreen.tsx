"use client";

import QRCode from "qrcode";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { PosBackLink } from "@/components/pos/PosBackLink";
import { usePosCatalog } from "@/components/pos/PosCatalogContext";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/useAuth";
import { formatTime } from "@/lib/format";
import { buildPrintStationCommand, buildPrintStationSetupBat } from "@/lib/pos/printStationSetup";
import { printJobRepository } from "@/repositories/printJobRepository";
import type { PrintJob, PrintJobLine, PrintStation } from "@/types";

/**
 * Print Station: this page, left open in Chrome on the shop's PC, *is* the print server. It
 * listens for its station's pending `printJobs`, renders each one as an 80mm ticket in plain
 * HTML (so Thai text comes out in a real Thai font via the Windows printer driver, with no
 * ESC/POS code pages involved) and calls `window.print()`.
 *
 * Chrome must be started with `--kiosk-printing` so `window.print()` goes straight to the
 * printer with no dialog. Kiosk printing always uses the printer last chosen in *that Chrome
 * profile*, which is how one PC drives two printers: two shortcuts, each with its own
 * `--user-data-dir`, one opened as the kitchen station and one as the cashier station.
 *
 * One job per `window.print()` call (not a batch of pages) so the printer's auto-cutter cuts
 * between every ticket regardless of how its driver handles multi-page documents.
 */

const STATION_STORAGE_KEY = "printStation.station";
const STATION_LABEL: Record<PrintStation, string> = { kitchen: "ครัว", cashier: "แคชเชียร์" };
/** Gap between consecutive prints — keeps a burst of tickets from tripping Chrome's throttling
 * of rapid script-initiated `print()` calls, and gives the cutter time to finish. */
const GAP_BETWEEN_PRINTS_MS = 1500;

interface RenderedTicket {
  key: string;
  lines: PrintJobLine[];
  qrDataUrl: string | null;
  qrCaption: string | null;
  createdAt: number;
}

interface RecentEntry {
  id: string;
  title: string;
  at: number;
  ok: boolean;
  error?: string;
}

function readStoredStation(): PrintStation | null {
  try {
    const fromUrl = new URLSearchParams(window.location.search).get("station");
    if (fromUrl === "kitchen" || fromUrl === "cashier") return fromUrl;
    const stored = window.localStorage.getItem(STATION_STORAGE_KEY);
    return stored === "kitchen" || stored === "cashier" ? stored : null;
  } catch {
    return null;
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Waits until React has committed the ticket and every image in it has decoded — printing
 * before the QR image is ready prints a blank square. */
async function waitForTicketPainted(container: HTMLElement | null) {
  await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const images = container ? Array.from(container.querySelectorAll("img")) : [];
  await Promise.all(images.map((img) => img.decode().catch(() => undefined)));
}

function jobTitle(job: Pick<PrintJob, "lines">): string {
  // Second line is the destination ("โต๊ะ 3") on kitchen tickets and the shop name's next line
  // on bills — the first big (size 2) line is the most recognizable thing on either.
  return job.lines.find((l) => l.size === 2)?.text ?? job.lines[0]?.text ?? "";
}

export function PrintStationScreen() {
  const { shopId } = usePosCatalog();
  const { appUser } = useAuth();
  const [station, setStation] = useState<PrintStation | null>(null);
  const [stationLoaded, setStationLoaded] = useState(false);
  const [pending, setPending] = useState<PrintJob[]>([]);
  const [ticket, setTicket] = useState<RenderedTicket | null>(null);
  const [recent, setRecent] = useState<RecentEntry[]>([]);
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);
  const [mounted, setMounted] = useState(false);
  const printAreaRef = useRef<HTMLDivElement | null>(null);
  const busyRef = useRef(false);
  // One id per open window — `claim` uses it so two windows on the same station can't both print.
  const sessionIdRef = useRef<string>("");

  useEffect(() => {
    sessionIdRef.current = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    // Reading browser-only state (URL, localStorage) once after mount — no external system to
    // subscribe to, and doing it during render would mismatch the server-rendered HTML.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setStation(readStoredStation());
    setStationLoaded(true);
    setMounted(true);
  }, []);

  function chooseStation(next: PrintStation | null) {
    setStation(next);
    try {
      if (next) window.localStorage.setItem(STATION_STORAGE_KEY, next);
      else window.localStorage.removeItem(STATION_STORAGE_KEY);
    } catch {
      // Private mode etc. — the choice just won't survive a reload.
    }
  }

  useEffect(() => {
    if (!station) return;
    return printJobRepository.subscribePending(shopId, station, setPending);
  }, [shopId, station]);

  const printOne = useCallback(async (rendered: RenderedTicket) => {
    setTicket(rendered);
    await waitForTicketPainted(printAreaRef.current);
    window.print();
    setTicket(null);
  }, []);

  // Drain the queue one job at a time. Re-runs whenever the pending list changes or the previous
  // job finishes (`tick`), and bails immediately if a job is already in flight.
  useEffect(() => {
    if (busyRef.current || pending.length === 0) return;
    const job = pending[0];
    busyRef.current = true;
    setBusy(true);
    void (async () => {
      let entry: RecentEntry | null = null;
      try {
        const claimed = await printJobRepository.claim(job.id, sessionIdRef.current);
        if (claimed) {
          const qrDataUrl = job.qrPayload ? await QRCode.toDataURL(job.qrPayload, { width: 360, margin: 1 }) : null;
          await printOne({ key: job.id, lines: job.lines, qrDataUrl, qrCaption: job.qrCaption, createdAt: job.createdAt });
          await printJobRepository.update(job.id, { status: "printed", printedAt: Date.now() });
          entry = { id: job.id, title: jobTitle(job), at: Date.now(), ok: true };
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "พิมพ์ไม่สำเร็จ";
        await printJobRepository.update(job.id, { status: "failed", error: message }).catch(() => undefined);
        entry = { id: job.id, title: jobTitle(job), at: Date.now(), ok: false, error: message };
      }
      if (entry) {
        const done = entry;
        setRecent((r) => [done, ...r].slice(0, 12));
        await sleep(GAP_BETWEEN_PRINTS_MS);
      }
      setPending((p) => p.filter((j) => j.id !== job.id));
      busyRef.current = false;
      setBusy(false);
      setTick((t) => t + 1);
    })();
  }, [pending, tick, printOne]);

  async function handleTestPrint() {
    if (busyRef.current || !station) return;
    busyRef.current = true;
    setBusy(true);
    try {
      const now = Date.now();
      await printOne({
        key: "test",
        createdAt: now,
        qrDataUrl: null,
        qrCaption: null,
        lines: [
          { text: "ทดสอบเครื่องพิมพ์", align: "center", bold: true, size: 2 },
          { text: `สถานี ${STATION_LABEL[station]}`, align: "center" },
          { text: "--------------------------------", align: "center" },
          { text: "ภาษาไทยอ่านออกครบ ก ข ฃ ค ฅ ฆ ง" },
          { text: "ตัวเลข 0123456789 ฿120.00", align: "right" },
        ],
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  if (!stationLoaded) {
    return <main className="p-6 text-muted-foreground">กำลังโหลด...</main>;
  }

  if (!station) {
    return (
      <main className="mx-auto max-w-xl p-4 sm:p-6">
        <PosBackLink />
        <h1 className="mb-2 text-lg font-semibold">ตั้งเครื่องนี้เป็นสถานีพิมพ์</h1>
        <p className="mb-5 text-sm text-muted-foreground">
          เลือกว่าหน้าต่างนี้พิมพ์ใบอะไร เครื่องจะจำไว้ ถ้ามีเครื่องพิมพ์ 2 เครื่อง ให้เปิดอีกหน้าต่างแล้วเลือกอีกสถานี
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            onClick={() => chooseStation("kitchen")}
            className="rounded-xl border-2 border-border bg-card p-5 text-left hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="block text-xl font-semibold">ครัว</span>
            <span className="mt-1 block text-sm text-muted-foreground">ใบสั่งอาหาร ไม่มีราคา</span>
          </button>
          <button
            type="button"
            onClick={() => chooseStation("cashier")}
            className="rounded-xl border-2 border-border bg-card p-5 text-left hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            <span className="block text-xl font-semibold">แคชเชียร์</span>
            <span className="mt-1 block text-sm text-muted-foreground">ใบแจ้งค่าอาหาร พร้อม QR พร้อมเพย์</span>
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-xl p-4 sm:p-6">
      <PosBackLink />

      <section
        className={
          "mb-4 rounded-xl border-2 p-5 " + (busy ? "border-primary bg-primary/5" : "border-success bg-success/10")
        }
        aria-live="polite"
      >
        <p className="text-sm text-muted-foreground">สถานีพิมพ์</p>
        <p className="text-3xl font-bold">{STATION_LABEL[station]}</p>
        <p className="mt-2 text-lg font-medium">
          {busy ? "กำลังพิมพ์..." : pending.length > 0 ? `รอพิมพ์ ${pending.length} ใบ` : "พร้อมพิมพ์ รอออเดอร์"}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          เปิดหน้านี้ค้างไว้ตลอด ถ้าปิดหน้าต่างนี้ ใบ{STATION_LABEL[station]}จะไม่ออก
        </p>
      </section>

      <div className="mb-6 flex flex-wrap gap-2">
        <Button variant="outline" onClick={handleTestPrint} disabled={busy}>
          ทดสอบพิมพ์
        </Button>
        <Button variant="ghost" onClick={() => chooseStation(null)} disabled={busy}>
          เปลี่ยนสถานี
        </Button>
      </div>

      <SetupHelp station={station} />

      <h2 className="mb-2 font-semibold">พิมพ์ล่าสุด</h2>
      {recent.length === 0 ? (
        <p className="text-sm text-muted-foreground">ยังไม่มีงานพิมพ์ตั้งแต่เปิดหน้านี้</p>
      ) : (
        <ul className="divide-y divide-border rounded-lg border border-border bg-card">
          {recent.map((r) => (
            <li key={r.id} className="flex items-center justify-between gap-3 px-4 py-2 text-sm">
              <span className="truncate">{r.title}</span>
              <span className={"shrink-0 " + (r.ok ? "text-muted-foreground" : "text-destructive")}>
                {r.ok ? formatTime(r.at) : `ไม่สำเร็จ: ${r.error}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {appUser ? (
        <p className="mt-6 text-xs text-muted-foreground">ล็อกอินเป็น {appUser.name}</p>
      ) : null}

      {mounted
        ? createPortal(
            <div ref={printAreaRef} className="print-area" aria-hidden="true">
              {ticket ? <TicketView ticket={ticket} /> : null}
            </div>,
            document.body
          )
        : null}

      <style>{PRINT_CSS}</style>
    </main>
  );
}

function TicketView({ ticket }: { ticket: RenderedTicket }) {
  return (
    <div className="ticket">
      <p className="ticket-meta">{new Date(ticket.createdAt).toLocaleString("th-TH", { dateStyle: "short", timeStyle: "short" })}</p>
      {ticket.lines.map((line, i) => (
        <p
          key={i}
          className={"ticket-line" + (line.size === 2 ? " big" : "") + (line.bold ? " bold" : "")}
          style={{ textAlign: line.align ?? "left" }}
        >
          {line.text}
        </p>
      ))}
      {ticket.qrDataUrl ? (
        <div className="ticket-qr">
          {/* eslint-disable-next-line @next/next/no-img-element -- generated data URL, printed not displayed */}
          <img src={ticket.qrDataUrl} alt="" />
          {ticket.qrCaption ? <p className="ticket-line bold">{ticket.qrCaption}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Only the ticket prints: everything else on the page (header, status panel) is removed from the
 * print layout entirely — `display: none`, not `visibility: hidden`, which would still take up
 * paper. 72mm is the printable width of 80mm thermal paper.
 */
const PRINT_CSS = `
@media screen {
  .print-area { display: none; }
}
@media print {
  @page { margin: 0; }
  html, body { margin: 0 !important; padding: 0 !important; background: #fff !important; }
  body > *:not(.print-area) { display: none !important; }
  .print-area { display: block; width: 72mm; padding: 0 2mm 6mm; color: #000; font-size: 11pt; line-height: 1.35; }
  .ticket-meta { margin: 0 0 1mm; font-size: 9pt; text-align: right; }
  .ticket-line { margin: 0; white-space: pre-wrap; word-break: break-word; }
  .ticket-line.big { font-size: 16pt; line-height: 1.25; }
  .ticket-line.bold { font-weight: 700; }
  .ticket-qr { margin-top: 3mm; text-align: center; break-inside: avoid; }
  .ticket-qr img { display: block; margin: 0 auto; width: 46mm; height: 46mm; image-rendering: pixelated; }
}
`;

/**
 * "พิมพ์แล้วยังมีป๊อปอัพ?" helper: downloads a ready-made Windows setup file for *this* shop and
 * station (built from the page's own address, so it works for every shop without editing), with
 * the raw launch command as a fallback to copy. See `lib/pos/printStationSetup.ts`.
 */
function SetupHelp({ station }: { station: PrintStation }) {
  const [copied, setCopied] = useState(false);

  function input() {
    return {
      origin: window.location.origin,
      host: window.location.hostname,
      station,
      label: station === "kitchen" ? "Kitchen" : "Cashier",
    };
  }

  function download() {
    const bat = buildPrintStationSetupBat(input());
    const blob = new Blob([bat], { type: "application/octet-stream" });
    const href = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = href;
    a.download = `setup-print-station-${window.location.hostname.split(".")[0]}-${station}.bat`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1000);
  }

  async function copyCommand() {
    try {
      await navigator.clipboard.writeText(buildPrintStationCommand(input()));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard blocked — the command is still visible to select by hand below.
    }
  }

  return (
    <details className="mb-6 rounded-lg border border-border bg-card p-4">
      <summary className="cursor-pointer font-semibold">ตั้งให้พิมพ์ออกทันที ไม่มีป๊อปอัพ (Windows)</summary>
      <ol className="mt-3 grid list-decimal gap-2 pl-5 text-sm">
        <li>ตั้งเครื่องพิมพ์ใบเสร็จเป็น Default ใน Windows (Settings → Printers &amp; scanners → Set as default)</li>
        <li>
          กดปุ่มด้านล่างเพื่อดาวน์โหลดไฟล์ตั้งค่าของร้านนี้ ถ้า Chrome ถามว่าจะเก็บไฟล์ไหม ให้กด เก็บ/Keep
        </li>
        <li>ปิดหน้าต่างนี้ แล้วดับเบิลคลิกไฟล์ที่โหลดมา ถ้า Windows เตือน ให้กด More info → Run anyway</li>
        <li>จะได้ไอคอน POS Print Station บนหน้าจอ และเปิดเองทุกครั้งที่เปิดคอม ใช้ไอคอนนี้เปิดสถานีพิมพ์เสมอ</li>
      </ol>
      <div className="mt-3 flex flex-wrap gap-2">
        <Button onClick={download}>ดาวน์โหลดไฟล์ตั้งค่า</Button>
        <Button variant="outline" onClick={copyCommand}>
          {copied ? "คัดลอกแล้ว ✓" : "คัดลอกคำสั่ง (ตั้งเอง)"}
        </Button>
      </div>
    </details>
  );
}
