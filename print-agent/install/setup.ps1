param([string]$Origin = '')
# RanPOS Print Agent - installer for the shop PC (Windows 10/11).
# Started by the one-line command shown in Admin > Shop settings. Installs for the CURRENT Windows
# user, so the agent can use that user's printers; no administrator rights needed.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$TaskName = 'RanPOS Print Agent'
$Dir = Join-Path $env:LOCALAPPDATA 'RanPOS\print-agent'

function Step($t) { Write-Host ''; Write-Host "== $t" -ForegroundColor Cyan }
function Fail($t) { Write-Host ''; Write-Host "ERROR: $t" -ForegroundColor Red; Read-Host 'Press Enter to close'; exit 1 }

function Refresh-Path {
  $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
}

# ---------------------------------------------------------------- 1. Node.js
Step 'Checking Node.js'
$node = Get-Command node -ErrorAction SilentlyContinue
if (-not $node) {
  if (Get-Command winget -ErrorAction SilentlyContinue) {
    Write-Host 'Node.js not found - installing Node.js LTS with winget (this can take a few minutes)...'
    winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
    Refresh-Path
    $node = Get-Command node -ErrorAction SilentlyContinue
  }
}
if (-not $node) { Fail 'Node.js is not installed. Install "Node.js LTS" from https://nodejs.org then run this installer again.' }
$nodeVersion = (& $node.Source -v).TrimStart('v')
if ([int]($nodeVersion.Split('.')[0]) -lt 20) { Fail "Node.js $nodeVersion is too old. Install Node.js LTS (20 or newer) from https://nodejs.org" }
Write-Host "Node.js $nodeVersion OK"

# ---------------------------------------------------------------- 2. Pairing code
Step 'Pairing'
Write-Host 'Paste the pairing code from Admin > Shop settings > Print Agent (starts with RANPOS1.)'
$code = (Read-Host 'Pairing code').Trim()
if (-not $code.StartsWith('RANPOS1.')) { Fail 'That is not a pairing code. Copy the whole code that starts with RANPOS1.' }
try {
  $b64 = $code.Substring(8).Replace('-', '+').Replace('_', '/')
  switch ($b64.Length % 4) { 2 { $b64 += '==' } 3 { $b64 += '=' } }
  $pair = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($b64)) | ConvertFrom-Json
}
catch { Fail 'The pairing code is damaged. Copy it again from the Admin page.' }
$Origin = $pair.u.TrimEnd('/')

try {
  $body = @{ agentId = $pair.a; secret = $pair.s } | ConvertTo-Json -Compress
  $info = Invoke-RestMethod -Method Post -Uri "$Origin/api/print-agent/token" -Body $body -ContentType 'application/json'
}
catch { Fail "The shop rejected this pairing code (revoked or mistyped), or $Origin cannot be reached. Create a new one in Admin and try again." }
Write-Host ("Paired as '" + $info.name + "' for station(s): " + ($info.stations -join ', '))

# ---------------------------------------------------------------- 3. Files
Step "Downloading the agent into $Dir"
Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
Where-Object { $_.CommandLine -like '*print-agent*main.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
try { Stop-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue } catch { }
New-Item -ItemType Directory -Force -Path $Dir | Out-Null
$manifest = Invoke-RestMethod -Uri "$Origin/print-agent/manifest.json"
foreach ($f in $manifest.files) {
  $target = Join-Path $Dir ($f -replace '/', '\')
  New-Item -ItemType Directory -Force -Path (Split-Path $target) | Out-Null
  Invoke-WebRequest -UseBasicParsing -Uri "$Origin/print-agent/$f" -OutFile $target
}
Push-Location $Dir
try {
  & npm.cmd ci --omit=dev --no-audit --no-fund
  if ($LASTEXITCODE -ne 0) { throw "npm exited with $LASTEXITCODE" }
}
catch { Pop-Location; Fail "Installing the agent's packages failed: $($_.Exception.Message). Check the internet connection and run again." }
Pop-Location

# ---------------------------------------------------------------- 4. Printers
Step 'Choose the printer'
$printers = @(Get-Printer | Sort-Object Name)
if ($printers.Count -eq 0) { Fail 'Windows has no printers. Install the receipt printer driver first, then run this again.' }
for ($i = 0; $i -lt $printers.Count; $i++) { Write-Host ("  [{0}] {1}  ({2})" -f ($i + 1), $printers[$i].Name, $printers[$i].PrinterStatus) }
# Best guess for a receipt printer — never Windows' virtual printers (XPS/PDF/OneNote/Fax).
$virtual = 'XPS|PDF|OneNote|Fax|Document Writer'
$guess = $printers | Where-Object { $_.Name -notmatch $virtual -and $_.Name -match 'Xprinter|XP-|POS|80|Receipt|Thermal' } | Select-Object -First 1
$chosen = @{}
foreach ($station in $info.stations) {
  $label = if ($station -eq 'kitchen') { 'KITCHEN' } else { 'CASHIER' }
  $default = if ($guess) { [array]::IndexOf($printers, $guess) + 1 } else { 1 }
  $answer = Read-Host "Printer number for the $label station [$default]"
  if (-not $answer) { $answer = $default }
  $n = 0
  if (-not [int]::TryParse([string]$answer, [ref]$n) -or $n -lt 1 -or $n -gt $printers.Count) { Fail "No printer number $answer." }
  $chosen[$station] = $printers[$n - 1].Name
  Write-Host ("  $label -> " + $chosen[$station])
}

# ---------------------------------------------------------------- 5. Config (secret encrypted with DPAPI)
Step 'Saving settings'
Add-Type -AssemblyName System.Security
$protected = [Convert]::ToBase64String([System.Security.Cryptography.ProtectedData]::Protect(
    [System.Text.Encoding]::UTF8.GetBytes($pair.s), $null, [System.Security.Cryptography.DataProtectionScope]::CurrentUser))
$config = [ordered]@{ origin = $Origin; agentId = $pair.a; secretProtected = $protected; printers = $chosen }
[System.IO.File]::WriteAllText((Join-Path $Dir 'config.json'), ($config | ConvertTo-Json -Depth 4), (New-Object System.Text.UTF8Encoding($false)))
# Only this Windows user (plus SYSTEM/Administrators) may read the settings folder.
try {
  icacls $Dir /inheritance:r /grant:r "$($env:USERNAME):(OI)(CI)F" "SYSTEM:(OI)(CI)F" "Administrators:(OI)(CI)F" | Out-Null
}
catch { }

$vbs = @"
Set sh = CreateObject("WScript.Shell")
sh.CurrentDirectory = "$Dir"
rc = sh.Run("""$($node.Source)"" src\main.js", 0, True)
WScript.Quit rc
"@
[System.IO.File]::WriteAllText((Join-Path $Dir 'run-hidden.vbs'), $vbs, (New-Object System.Text.UTF8Encoding($false)))

# ---------------------------------------------------------------- 6. Test print
Step 'Test print'
$env:RANPOS_AGENT_DIR = $Dir
& $node.Source (Join-Path $Dir 'src\main.js') --test-print
$ok = Read-Host 'Did a test ticket come out with readable Thai text? (y/n)'
if ($ok -notmatch '^[yY]') {
  Write-Host 'Check: printer switched on, paper loaded the right way up, the right printer number chosen,' -ForegroundColor Yellow
  Write-Host 'and that Windows "Print a test page" works for this printer. Then run this installer again.' -ForegroundColor Yellow
}

# ---------------------------------------------------------------- 7. Start automatically
Step 'Starting automatically at Windows logon'
$runAs = "$env:USERDOMAIN\$env:USERNAME"
try {
  $action = New-ScheduledTaskAction -Execute 'wscript.exe' -Argument ('"' + (Join-Path $Dir 'run-hidden.vbs') + '"') -WorkingDirectory $Dir
  $trigger = New-ScheduledTaskTrigger -AtLogOn -User $runAs
  $settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable `
    -RestartCount 999 -RestartInterval (New-TimeSpan -Minutes 1) -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
  $principal = New-ScheduledTaskPrincipal -UserId $runAs -LogonType Interactive -RunLevel Limited
  Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null
  Start-ScheduledTask -TaskName $TaskName
  Write-Host "Scheduled task '$TaskName' registered and started."
}
catch {
  # Fallback without Task Scheduler: a Startup-folder shortcut (no automatic restart on crash).
  $startup = [Environment]::GetFolderPath('Startup')
  $ws = New-Object -ComObject WScript.Shell
  $lnk = $ws.CreateShortcut((Join-Path $startup 'RanPOS Print Agent.lnk'))
  $lnk.TargetPath = 'wscript.exe'
  $lnk.Arguments = '"' + (Join-Path $Dir 'run-hidden.vbs') + '"'
  $lnk.WorkingDirectory = $Dir
  $lnk.Save()
  Start-Process wscript.exe -ArgumentList ('"' + (Join-Path $Dir 'run-hidden.vbs') + '"') -WorkingDirectory $Dir
  Write-Host 'Task Scheduler was not available - added a Startup shortcut instead and started the agent.'
}

Write-Host ''
Write-Host 'Done. The agent now runs in the background and starts by itself after every Windows logon.' -ForegroundColor Green
Write-Host 'Keep this PC and the printer switched on, and turn off Sleep in Windows power settings.'
Write-Host "Logs: $Dir\logs"
Read-Host 'Press Enter to close'
