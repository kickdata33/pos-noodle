/** Tests for the generated Print Station setup file (run: npm run test:pos). */
import assert from "node:assert/strict";
import test from "node:test";

import { buildPrintStationCommand, buildPrintStationSetupBat, stationProfileDir } from "../src/lib/pos/printStationSetup";

const input = { origin: "https://yodnk.ranpos.online", host: "yodnk.ranpos.online", station: "cashier", label: "Cashier" };

test("setup file points at this shop's own print station with kiosk printing", () => {
  const bat = buildPrintStationSetupBat(input);
  assert.ok(bat.includes('set "URL=https://yodnk.ranpos.online/pos/print-station?station=cashier"'));
  assert.ok(bat.includes("--kiosk-printing"));
  assert.ok(bat.includes(`set "PROFILE=${stationProfileDir(input.host, "cashier")}"`));
  assert.ok(bat.includes("\r\n"), "CRLF line endings for cmd.exe");
  assert.ok(!/[^\x00-\x7F]/.test(bat), "ASCII only — no Thai text that cmd.exe would garble");
});

test("each shop and station gets its own Chrome profile folder", () => {
  assert.equal(stationProfileDir("yodnk.ranpos.online", "cashier"), "C:\\pos-print\\yodnk.ranpos.online-cashier");
  assert.notEqual(stationProfileDir("a.ranpos.online", "cashier"), stationProfileDir("b.ranpos.online", "cashier"));
  assert.notEqual(stationProfileDir("a.ranpos.online", "cashier"), stationProfileDir("a.ranpos.online", "kitchen"));
});

test("manual command has the same flags and URL", () => {
  const cmd = buildPrintStationCommand(input);
  assert.ok(cmd.startsWith('"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing'));
  assert.ok(cmd.endsWith("https://yodnk.ranpos.online/pos/print-station?station=cashier"));
});
