import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { AgentCore } from "./core.js";
import { AgentAuthError, connect } from "./firestoreStore.js";
import { runPowerShell, WindowsPrinter } from "./windowsPrinter.js";

/**
 * RanPOS background Print Agent — entry point. Started at Windows logon by the scheduled task
 * that install/setup.ps1 registers (hidden, restarted by Windows if it ever exits).
 *
 *   node src/main.js                 run the agent
 *   node src/main.js --test-print    print a local test ticket on each configured printer
 */

const VERSION = "1.0.0";
const HEARTBEAT_MS = 30_000;
const POLL_MS = 20_000;
const RECONNECT_MS = 30_000;
const REVOKED_RETRY_MS = 5 * 60_000;

const configDir =
  process.env.RANPOS_AGENT_DIR ?? path.join(process.env.LOCALAPPDATA ?? os.homedir(), "RanPOS", "print-agent");
const logDir = path.join(configDir, "logs");
mkdirSync(logDir, { recursive: true });

function log(msg) {
  const now = new Date();
  const line = `${now.toISOString()} ${msg}\n`;
  process.stdout.write(line);
  try {
    appendFileSync(path.join(logDir, `agent-${now.toISOString().slice(0, 10)}.log`), line, "utf8");
  } catch {
    // logging must never stop printing
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function loadConfig() {
  const file = path.join(configDir, "config.json");
  const cfg = JSON.parse(readFileSync(file, "utf8"));
  let secret = cfg.secret;
  if (!secret && cfg.secretProtected) {
    // DPAPI-encrypted by setup.ps1 — readable only by this Windows user on this PC.
    const r = await runPowerShell("unprotect-secret.ps1", ["-Blob", cfg.secretProtected], { timeoutMs: 30_000 });
    secret = r.out.trim();
  }
  if (!cfg.origin || !cfg.agentId || !secret) throw new Error(`incomplete config in ${file}`);
  return { origin: cfg.origin, agentId: cfg.agentId, secret, printers: cfg.printers ?? {} };
}

async function testPrint(config) {
  const printer = new WindowsPrinter({ log });
  for (const [station, name] of Object.entries(config.printers)) {
    const status = await printer.status(name);
    log(`printer ${name} (${station}): ${status.ready ? "ready" : status.detail}`);
    const result = await printer.print(
      {
        id: `test-${station}`,
        createdAt: Date.now(),
        lines: [
          { text: "ทดสอบโปรแกรมพิมพ์ RanPOS", align: "center", bold: true, size: 2 },
          { text: `สถานี ${station === "kitchen" ? "ครัว" : "แคชเชียร์"}`, align: "center" },
          { text: "--------------------------------", align: "center" },
          { text: "ภาษาไทยอ่านออกครบ ก ข ฃ ค ฅ ฆ ง" },
          { text: "ตัวเลข 0123456789 ฿120.00", align: "right" },
        ],
        qrPayload: "https://ranpos.online",
        qrCaption: "QR ทดสอบ",
      },
      name
    );
    log(`test print on ${name}: ${result.outcome} ${result.detail}`);
  }
}

/** One connected session: listen, poll, heartbeat — until something needs a reconnect. */
async function runSession(config) {
  const store = await connect(config);
  log(`signed in as agent "${store.name}" (${store.agentId}) shop=${store.shopId} stations=${store.stations.join(",")}`);
  const core = new AgentCore({
    store,
    printer: new WindowsPrinter({ log }),
    printers: config.printers,
    stations: store.stations,
    agentId: store.agentId,
    log,
    version: VERSION,
    hostname: os.hostname(),
  });

  await core.checkPrinters();
  await core.recover();

  let fatal = null;
  const fail = (err) => {
    if (!fatal) fatal = err;
  };
  const unsubs = store.stations.map((station) =>
    store.subscribePending(
      station,
      (jobs) => void core.drain(station, jobs),
      (err) => {
        log(`listener ${station} error: ${err.code ?? ""} ${err.message}`);
        // permission-denied = revoked or token problem → reconnect; others recover on their own
        if (err.code === "permission-denied" || err.code === "unauthenticated") fail(err);
      }
    )
  );

  const beat = async () => {
    try {
      await core.checkPrinters();
      await store.heartbeat(core.heartbeatPayload());
    } catch (err) {
      log(`heartbeat failed: ${err.code ?? ""} ${err.message}`);
      if (err.code === "permission-denied" || err.code === "unauthenticated") fail(err);
    }
  };
  // Backup poll: catches anything a listener missed, and retries jobs that waited for a printer.
  const poll = async () => {
    for (const station of store.stations) {
      try {
        await core.drain(station, await store.fetchPending(station));
      } catch (err) {
        log(`poll ${station} failed: ${err.code ?? ""} ${err.message}`);
      }
    }
  };
  await beat();
  const beatTimer = setInterval(beat, HEARTBEAT_MS);
  const pollTimer = setInterval(poll, POLL_MS);

  while (!fatal) await sleep(1000);

  clearInterval(beatTimer);
  clearInterval(pollTimer);
  unsubs.forEach((u) => u());
  await store.close();
  throw fatal;
}

async function main() {
  const config = await loadConfig();
  if (process.argv.includes("--test-print")) {
    await testPrint(config);
    return;
  }
  log(`RanPOS Print Agent ${VERSION} starting on ${os.hostname()} → ${config.origin}`);
  for (;;) {
    try {
      await runSession(config);
    } catch (err) {
      if (err instanceof AgentAuthError) {
        log(`ERROR: ${err.message}. Retrying in 5 minutes.`);
        await sleep(REVOKED_RETRY_MS);
      } else {
        log(`session ended: ${err.message}. Reconnecting in 30 s.`);
        await sleep(RECONNECT_MS);
      }
    }
  }
}

main().catch((err) => {
  log(`FATAL: ${err.stack ?? err.message}`);
  process.exit(1);
});
