param([Parameter(Mandatory = $true)][string]$Printer)
# RanPOS Print Agent - report whether a Windows printer can take a job right now.
# Output: one JSON line {found, ready, detail}. Thai text, so this file is saved as UTF-8 with BOM.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Out-Result($found, $ready, $detail) {
  @{ found = $found; ready = $ready; detail = $detail } | ConvertTo-Json -Compress | Write-Output
  exit 0
}

try {
  $p = Get-Printer -Name $Printer -ErrorAction SilentlyContinue
  if (-not $p) { Out-Result $false $false 'ไม่พบเครื่องพิมพ์ชื่อนี้ใน Windows' }

  $escaped = $Printer.Replace('\', '\\').Replace("'", "\'")
  $w = Get-CimInstance -ClassName Win32_Printer -Filter "Name='$escaped'" -ErrorAction SilentlyContinue
  $status = [string]$p.PrinterStatus

  if ($w -and $w.WorkOffline) { Out-Result $true $false 'ตั้งเป็น Use Printer Offline อยู่ใน Windows' }
  if ($status -match 'Offline|NotAvailable') { Out-Result $true $false 'เครื่องพิมพ์ออฟไลน์ ตรวจสาย USB และสวิตช์เปิดเครื่อง' }
  if ($status -match 'PaperOut|PaperProblem') { Out-Result $true $false 'กระดาษหมด' }
  if ($status -match 'PaperJam') { Out-Result $true $false 'กระดาษติด' }
  if ($status -match 'DoorOpen') { Out-Result $true $false 'ฝาเครื่องพิมพ์เปิดอยู่' }
  if ($status -match 'Paused') { Out-Result $true $false 'เครื่องพิมพ์ถูกหยุดชั่วคราว (Paused) ใน Windows' }
  if ($status -match 'Error|UserIntervention') { Out-Result $true $false 'เครื่องพิมพ์มีข้อผิดพลาด ตรวจไฟที่เครื่อง' }
  if ($w -and $w.PrinterStatus -eq 7) { Out-Result $true $false 'เครื่องพิมพ์ออฟไลน์ ตรวจสาย USB และสวิตช์เปิดเครื่อง' }
  Out-Result $true $true 'พร้อม'
}
catch {
  Out-Result $false $false ("ตรวจสถานะไม่ได้: " + $_.Exception.Message)
}
