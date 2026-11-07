# RanPOS Print Agent - uninstaller (current Windows user).
$ErrorActionPreference = 'SilentlyContinue'
$TaskName = 'RanPOS Print Agent'
$Dir = Join-Path $env:LOCALAPPDATA 'RanPOS\print-agent'
Stop-ScheduledTask -TaskName $TaskName
Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
Remove-Item (Join-Path ([Environment]::GetFolderPath('Startup')) 'RanPOS Print Agent.lnk') -Force
Get-CimInstance Win32_Process -Filter "Name='node.exe'" |
Where-Object { $_.CommandLine -like '*print-agent*main.js*' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
Remove-Item $Dir -Recurse -Force
Write-Host 'RanPOS Print Agent removed. Also revoke it in Admin > Shop settings so its pairing code stops working.'
