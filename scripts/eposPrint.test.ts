/**
 * Tests for the ePOS-Print XML/URL builders (run: npm run test:pos). Deliberately does NOT test
 * `printReceiptViaEpos` itself — that's a thin `fetch()` wrapper with no printer to test against
 * in this sandbox; see that function's doc comment for the "not yet verified against real
 * hardware" caveat.
 */
import assert from "node:assert/strict";
import test from "node:test";

import { buildEposPrintUrl, buildEposPrintXml } from "../src/lib/pos/eposPrint";
import type { Receipt } from "../src/lib/pos/receipt";

test("buildEposPrintUrl: posts to the printer's own IP on the standard ePOS-Print path", () => {
  assert.equal(
    buildEposPrintUrl("192.168.1.50"),
    "http://192.168.1.50/cgi-bin/epos/service.cgi?devid=local_printer&timeout=10000"
  );
});

test("buildEposPrintXml: wraps content in the SOAP envelope + epos-print namespace", () => {
  const receipt: Receipt = { lines: [{ text: "สวัสดี" }] };
  const xml = buildEposPrintXml(receipt);
  assert.ok(xml.startsWith('<?xml version="1.0" encoding="utf-8"?>'));
  assert.ok(xml.includes('xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"'));
  assert.ok(xml.includes('xmlns="http://www.epson-pos.com/schemas/2011/03/epos-print"'));
  assert.ok(xml.includes("<s:Envelope"));
  assert.ok(xml.includes("</s:Envelope>"));
});

test("buildEposPrintXml: every line ends with a newline so lines don't run together", () => {
  const receipt: Receipt = { lines: [{ text: "บรรทัดที่ 1" }, { text: "บรรทัดที่ 2" }] };
  const xml = buildEposPrintXml(receipt);
  assert.ok(xml.includes("<text>บรรทัดที่ 1&#10;</text>"));
  assert.ok(xml.includes("<text>บรรทัดที่ 2&#10;</text>"));
});

test("buildEposPrintXml: escapes XML-special characters in line text", () => {
  const receipt: Receipt = { lines: [{ text: `A & B <"C"> 'D'` }] };
  const xml = buildEposPrintXml(receipt);
  assert.ok(xml.includes("A &amp; B &lt;&quot;C&quot;&gt; &apos;D&apos;"));
  assert.ok(!xml.includes(`<"C">`));
});

test("buildEposPrintXml: emits an align command only when a line's alignment changes", () => {
  const receipt: Receipt = {
    lines: [
      { text: "left 1" }, // default left, no command needed yet
      { text: "left 2" }, // still left — no repeated command
      { text: "centered", align: "center" }, // changes — one command
      { text: "still centered", align: "center" }, // unchanged — no repeated command
    ],
  };
  const xml = buildEposPrintXml(receipt);
  const alignCommandCount = (xml.match(/<text align="center"\/>/g) ?? []).length;
  assert.equal(alignCommandCount, 1);
  assert.ok(!xml.includes('<text align="left"/>')); // "left" is the initial default, never re-stated
});

test("buildEposPrintXml: a bold/double-size line gets its own mode commands, reset by the next plain line", () => {
  const receipt: Receipt = {
    lines: [
      { text: "ยอดสุทธิ ฿100.00", bold: true, size: 2 },
      { text: "ขอบคุณค่ะ" },
    ],
  };
  const xml = buildEposPrintXml(receipt);
  assert.ok(xml.includes('<text em="true"/>'));
  assert.ok(xml.includes('<text width="2" height="2"/>'));
  // The plain line after it must turn bold/size back off, not leak the heading's styling onto it.
  const afterHeading = xml.indexOf("ขอบคุณค่ะ");
  const resetEm = xml.lastIndexOf('<text em="false"/>', afterHeading);
  const resetSize = xml.lastIndexOf('<text width="1" height="1"/>', afterHeading);
  assert.ok(resetEm !== -1 && resetEm < afterHeading);
  assert.ok(resetSize !== -1 && resetSize < afterHeading);
});

test("buildEposPrintXml: ends with a feed + cut so the receipt tears off cleanly", () => {
  const xml = buildEposPrintXml({ lines: [{ text: "x" }] });
  assert.ok(xml.includes('<feed line="3"/>'));
  assert.ok(xml.includes('<cut type="feed"/>'));
  assert.ok(xml.indexOf('<cut type="feed"/>') > xml.indexOf("<feed"));
});
