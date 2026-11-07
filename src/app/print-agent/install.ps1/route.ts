import type { NextRequest } from "next/server";

/**
 * `irm https://<shop>.ranpos.online/print-agent/install.ps1 | iex` — the one-liner shown in
 * Admin → ตั้งค่าร้าน. A tiny ASCII bootstrap (so PowerShell's `irm | iex` can't garble it) that
 * already knows this shop's address, downloads the real installer (public/print-agent/setup.ps1,
 * UTF-8 with BOM) as a file and runs it. Same script for every shop — only the address differs.
 */
export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin.replace(/'/g, "");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    "[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12",
    `$Origin = '${origin}'`,
    "$tmp = Join-Path $env:TEMP 'ranpos-print-agent-setup.ps1'",
    'Invoke-WebRequest -UseBasicParsing -Uri "$Origin/print-agent/setup.ps1" -OutFile $tmp',
    "& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $tmp -Origin $Origin",
    "",
  ].join("\r\n");
  return new Response(script, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
