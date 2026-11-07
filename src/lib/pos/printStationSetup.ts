/**
 * Builds the one-click Windows setup file for a Print Station (item: "ถ้าเป็นร้านอื่นละ จะทำยังไง")
 * — generated in the browser from the page's own address, so every shop's file already points at
 * that shop's subdomain and the chosen station; nothing to edit by hand.
 *
 * The .bat finds Chrome, then creates a "POS Print Station" shortcut on the Desktop and in the
 * Startup folder that launches Chrome with `--kiosk-printing` (print straight to the default
 * printer, no dialog) and its own `--user-data-dir` — a separate Chrome instance, so the flag
 * applies even while the shop's normal Chrome is open. Pure string building, unit-tested.
 */

/** Windows-safe folder name for this shop + station's Chrome profile. */
export function stationProfileDir(host: string, station: string): string {
  const safe = `${host}-${station}`.toLowerCase().replace(/[^a-z0-9.-]/g, "-");
  return `C:\\pos-print\\${safe}`;
}

export function buildPrintStationSetupBat(input: { origin: string; host: string; station: string; label: string }): string {
  const url = `${input.origin}/pos/print-station?station=${input.station}`;
  const profile = stationProfileDir(input.host, input.station);
  const shortcutName = `POS Print Station ${input.label}`.replace(/[^A-Za-z0-9 -]/g, "").trim();
  const lines = [
    "@echo off",
    "REM RanPOS - Print Station setup. Double-click once.",
    `REM Shop: ${input.host}   Station: ${input.station}`,
    "",
    `set "URL=${url}"`,
    `set "PROFILE=${profile}"`,
    `set "LINKNAME=${shortcutName}.lnk"`,
    "",
    "set CHROME=",
    'if exist "%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME=%ProgramFiles%\\Google\\Chrome\\Application\\chrome.exe"',
    'if exist "%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME=%ProgramFiles(x86)%\\Google\\Chrome\\Application\\chrome.exe"',
    'if exist "%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe" set "CHROME=%LocalAppData%\\Google\\Chrome\\Application\\chrome.exe"',
    'if "%CHROME%"=="" (',
    "  echo Google Chrome was not found. Please install Google Chrome first.",
    "  pause",
    "  exit /b 1",
    ")",
    "",
    'if not exist "%PROFILE%" mkdir "%PROFILE%"',
    'set ARGS=--kiosk-printing --no-first-run --no-default-browser-check --user-data-dir="%PROFILE%" %URL%',
    "",
    "powershell -NoProfile -ExecutionPolicy Bypass -Command ^",
    '  "$w = New-Object -ComObject WScript.Shell;" ^',
    "  \"foreach ($dir in @([Environment]::GetFolderPath('Desktop'), [Environment]::GetFolderPath('Startup'))) {\" ^",
    '  "  $s = $w.CreateShortcut((Join-Path $dir $env:LINKNAME));" ^',
    '  "  $s.TargetPath = $env:CHROME; $s.Arguments = $env:ARGS; $s.Save() }"',
    "",
    "echo Done. Shortcut created on the Desktop and in Startup. Opening the print station...",
    'start "" "%CHROME%" %ARGS%',
    "timeout /t 3 >nul",
    "",
  ];
  // Windows batch files want CRLF line endings.
  return lines.join("\r\n");
}

/** The same launch line for people who prefer to edit a shortcut by hand. */
export function buildPrintStationCommand(input: { origin: string; host: string; station: string }): string {
  return `"C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" --kiosk-printing --no-first-run --no-default-browser-check --user-data-dir="${stationProfileDir(
    input.host,
    input.station
  )}" ${input.origin}/pos/print-station?station=${input.station}`;
}
