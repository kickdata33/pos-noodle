# RanPOS Print Agent - uninstaller (current Windows user).
$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'RanPOS Print Agent'
$Dir = Join-Path $env:LOCALAPPDATA 'RanPOS\print-agent'
# Stop a running agent before replacing it. Its node.exe is started by run-hidden.vbs, so it is
# found as the child of that wscript.exe (older installs) or by the --ranpos-agent marker.
function Stop-RanPOSAgent {
  try { Stop-ScheduledTask -TaskName 'RanPOS Print Agent' -ErrorAction SilentlyContinue } catch { }
  $hosts = @(Get-CimInstance Win32_Process -Filter "Name='wscript.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.CommandLine -like '*RanPOS*print-agent*run-hidden.vbs*' })
  $hostIds = $hosts | ForEach-Object { $_.ProcessId }
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" -ErrorAction SilentlyContinue |
  Where-Object { ($hostIds -contains $_.ParentProcessId) -or ($_.CommandLine -like '*--ranpos-agent*') } |
  ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
  $hosts | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
}
Stop-RanPOSAgent
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'RanPOS Print Agent.lnk') -Force
Remove-Item $Dir -Recurse -Force
Write-Host 'RanPOS Print Agent removed. Also revoke it in Admin > Shop settings so its pairing code stops working.'
