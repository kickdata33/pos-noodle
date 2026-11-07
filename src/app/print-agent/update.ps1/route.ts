import type { NextRequest } from "next/server";

/**
 * `irm https://<shop>.ranpos.online/print-agent/update.ps1 | iex` — updates an installed Print
 * Agent to the files this site currently publishes (layout fixes etc.) WITHOUT a new pairing
 * code or printer choice: config.json (pairing secret, chosen printer) is kept as is. ASCII only,
 * for the same reason as install.ps1 (`irm | iex` would garble anything else).
 */
export function GET(request: NextRequest) {
  const origin = request.nextUrl.origin.replace(/'/g, "");
  const script = String.raw`$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$Origin = '${origin}'
$Dir = Join-Path $env:LOCALAPPDATA 'RanPOS\print-agent'
if (-not (Test-Path (Join-Path $Dir 'config.json'))) { Write-Host 'The Print Agent is not installed on this PC for this Windows user. Use the install command instead.' -ForegroundColor Red; return }
Write-Host 'Stopping the Print Agent...'
try { Stop-ScheduledTask -TaskName 'RanPOS Print Agent' -ErrorAction SilentlyContinue } catch { }
$hosts = @(Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like '*RanPOS*print-agent*run-hidden.vbs*' })
$hostIds = $hosts | ForEach-Object { $_.ProcessId }
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue | Where-Object { ($hostIds -contains $_.ParentProcessId) -or ($_.CommandLine -like '*--ranpos-agent*') } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
$hosts | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Write-Host 'Downloading the latest agent files...'
$manifest = Invoke-RestMethod -Uri "$Origin/print-agent/manifest.json"
foreach ($f in $manifest.files) {
  $target = Join-Path $Dir ($f -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri "$Origin/print-agent/$f" -OutFile $target
}
Push-Location $Dir
& npm.cmd ci --omit=dev --no-audit --no-fund
Pop-Location
$vbs = Join-Path $Dir 'run-hidden.vbs'
if (Test-Path $vbs) { (Get-Content -Raw $vbs).Replace('src\main.js"', 'src\main.js --ranpos-agent"').Replace('--ranpos-agent --ranpos-agent', '--ranpos-agent') | Set-Content -Encoding ASCII $vbs }
try { Start-ScheduledTask -TaskName 'RanPOS Print Agent' } catch { Start-Process wscript.exe -ArgumentList ('"' + $vbs + '"') -WorkingDirectory $Dir }
Write-Host 'Print Agent updated and restarted.' -ForegroundColor Green
`;
  return new Response(script.replace(/\n/g, "\r\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
  });
}
