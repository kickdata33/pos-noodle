param(
  [Parameter(Mandatory = $true)][string]$JobFile,
  [int]$TimeoutSec = 45
)
# RanPOS Print Agent - print one queued ticket through the Windows printer driver with GDI+
# (System.Drawing), so Thai renders with Windows' own fonts and the driver's paper/cutter settings
# apply. Prints "##SUBMITTED##" the moment Windows accepted the job, then waits for the spooler to
# finish handing it to the printer. Last output line is JSON {outcome, detail}:
#   delivered     - Windows finished sending the job to the printer ("sent" in the POS)
#   not_submitted - never reached Windows' queue (printer missing/offline) - safe to retry
#   error|timeout - reached the queue, then failed/stuck; the job was removed from the Windows
#                   queue so it can't print by surprise later - staff must check the paper.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

function Out-Result($outcome, $detail) {
  @{ outcome = $outcome; detail = $detail } | ConvertTo-Json -Compress | Write-Output
  exit 0
}

try {
  Add-Type -AssemblyName System.Drawing
  $job = Get-Content -Raw -Encoding UTF8 -LiteralPath $JobFile | ConvertFrom-Json
}
catch {
  Out-Result 'not_submitted' ("อ่านงานพิมพ์ไม่ได้: " + $_.Exception.Message)
}

$printer = Get-Printer -Name $job.printerName -ErrorAction SilentlyContinue
if (-not $printer) { Out-Result 'not_submitted' 'ไม่พบเครื่องพิมพ์ชื่อนี้ใน Windows' }
if ([string]$printer.PrinterStatus -match 'Offline|NotAvailable') { Out-Result 'not_submitted' 'เครื่องพิมพ์ออฟไลน์ ตรวจสาย USB และสวิตช์เปิดเครื่อง' }

# --- fonts: first Thai-capable font installed on this PC ---
$installed = [System.Drawing.FontFamily]::Families | ForEach-Object { $_.Name }
$fontName = @('Tahoma', 'Leelawadee UI', 'Leelawadee', 'Microsoft Sans Serif') | Where-Object { $installed -contains $_ } | Select-Object -First 1
if (-not $fontName) { $fontName = 'Tahoma' }
$pt = [System.Drawing.GraphicsUnit]::Point
$fontNormal = New-Object System.Drawing.Font($fontName, 9, [System.Drawing.FontStyle]::Regular, $pt)
$fontBold = New-Object System.Drawing.Font($fontName, 9, [System.Drawing.FontStyle]::Bold, $pt)
$fontBig = New-Object System.Drawing.Font($fontName, 14, [System.Drawing.FontStyle]::Bold, $pt)
$fontSmall = New-Object System.Drawing.Font($fontName, 7.5, [System.Drawing.FontStyle]::Regular, $pt)

# 80 mm paper, 72 mm printable. Everything below is in points (1/72 inch).
$widthPt = 72 / 25.4 * 72
$qrPt = 46 / 25.4 * 72
# Tight layout: GDI+'s default StringFormat pads every measured line by about 1/6 em top and
# bottom, which on a receipt adds up to a lot of empty paper — the typographic format doesn't.
$lineGap = 0.6

function Get-LineFont($line) {
  if ($line.size -eq 2) { return $fontBig }
  if ($line.bold) { return $fontBold }
  return $fontNormal
}

function Get-Format($align) {
  $f = [System.Drawing.StringFormat]::GenericTypographic.Clone()
  switch ($align) {
    'center' { $f.Alignment = [System.Drawing.StringAlignment]::Center }
    'right' { $f.Alignment = [System.Drawing.StringAlignment]::Far }
    default { $f.Alignment = [System.Drawing.StringAlignment]::Near }
  }
  return $f
}

$qrImage = $null
if ($job.qrFile) { $qrImage = [System.Drawing.Image]::FromFile($job.qrFile) }

# Lays the ticket out top to bottom; draws only when $draw is true. Returns the height used.
function Invoke-Layout($g, [bool]$draw) {
  $y = 0.0
  $brush = [System.Drawing.Brushes]::Black
  $fmt = Get-Format 'right'
  $size = $g.MeasureString([string]$job.timeLabel, $fontSmall, [int]$widthPt, $fmt)
  if ($draw) { $g.DrawString([string]$job.timeLabel, $fontSmall, $brush, (New-Object System.Drawing.RectangleF(0, $y, $widthPt, $size.Height)), $fmt) }
  $y += $size.Height + 2
  foreach ($line in $job.lines) {
    $font = Get-LineFont $line
    $fmt = Get-Format $line.align
    $text = [string]$line.text
    if ($text -eq '') { $text = ' ' }
    $size = $g.MeasureString($text, $font, [int]$widthPt, $fmt)
    if ($draw) { $g.DrawString($text, $font, $brush, (New-Object System.Drawing.RectangleF(0, $y, $widthPt, $size.Height)), $fmt) }
    $y += $size.Height + $lineGap
  }
  if ($qrImage) {
    $y += 4
    if ($draw) {
      $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
      $g.DrawImage($qrImage, [single](($widthPt - $qrPt) / 2), [single]$y, [single]$qrPt, [single]$qrPt)
    }
    $y += $qrPt + 2
    if ($job.qrCaption) {
      $fmt = Get-Format 'center'
      $size = $g.MeasureString([string]$job.qrCaption, $fontBold, [int]$widthPt, $fmt)
      if ($draw) { $g.DrawString([string]$job.qrCaption, $fontBold, $brush, (New-Object System.Drawing.RectangleF(0, $y, $widthPt, $size.Height)), $fmt) }
      $y += $size.Height
    }
  }
  return $y + 8
}

# Measure first, so the page is exactly as long as the ticket (no metres of blank paper).
$bmp = New-Object System.Drawing.Bitmap(8, 8)
$mg = [System.Drawing.Graphics]::FromImage($bmp)
$mg.PageUnit = $pt
$heightPt = Invoke-Layout $mg $false
$mg.Dispose(); $bmp.Dispose()
$heightHundredths = [int][Math]::Ceiling($heightPt / 72 * 100)

$doc = New-Object System.Drawing.Printing.PrintDocument
$doc.PrinterSettings.PrinterName = $job.printerName
if (-not $doc.PrinterSettings.IsValid) { Out-Result 'not_submitted' 'Windows ใช้เครื่องพิมพ์นี้ไม่ได้' }
$doc.DocumentName = $job.docName
$doc.PrintController = New-Object System.Drawing.Printing.StandardPrintController
$doc.DefaultPageSettings.Margins = New-Object System.Drawing.Printing.Margins(0, 0, 0, 0)
try { $doc.DefaultPageSettings.PaperSize = New-Object System.Drawing.Printing.PaperSize('RanPOS', 315, $heightHundredths) } catch { }
$doc.add_PrintPage({
    param($sender, $e)
    $e.Graphics.PageUnit = $pt
    $e.Graphics.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::SingleBitPerPixelGridFit
    [void](Invoke-Layout $e.Graphics $true)
    $e.HasMorePages = $false
  })

try {
  $doc.Print()
}
catch {
  Out-Result 'not_submitted' ("ส่งพิมพ์ไม่ได้: " + $_.Exception.Message)
}
finally {
  if ($qrImage) { $qrImage.Dispose() }
}
Write-Output '##SUBMITTED##'

# --- follow the job through the Windows spooler ---
$deadline = (Get-Date).AddSeconds($TimeoutSec)
while ((Get-Date) -lt $deadline) {
  $wj = Get-PrintJob -PrinterName $job.printerName -ErrorAction SilentlyContinue |
  Where-Object { $_.DocumentName -eq $job.docName } | Select-Object -First 1
  if (-not $wj) { Out-Result 'delivered' 'Windows ส่งงานถึงเครื่องพิมพ์แล้ว' }
  $s = [string]$wj.JobStatus
  if ($s -match 'Error|Offline|PaperOut|UserIntervention|Blocked|Deleted') {
    try { Remove-PrintJob -InputObject $wj } catch { }
    if ($s -match 'PaperOut') { Out-Result 'error' 'กระดาษหมดระหว่างพิมพ์' }
    if ($s -match 'Offline') { Out-Result 'error' 'เครื่องพิมพ์หลุดระหว่างพิมพ์' }
    Out-Result 'error' ("เครื่องพิมพ์แจ้งปัญหา: " + $s)
  }
  Start-Sleep -Milliseconds 700
}
Get-PrintJob -PrinterName $job.printerName -ErrorAction SilentlyContinue |
Where-Object { $_.DocumentName -eq $job.docName } | ForEach-Object { try { Remove-PrintJob -InputObject $_ } catch { } }
Out-Result 'timeout' 'งานค้างในคิว Windows นานเกินไป (ยกเลิกงานในคิวแล้ว)'
