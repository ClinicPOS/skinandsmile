param([Parameter(Mandatory = $true)][string]$WorkbookPath)
$ErrorActionPreference = 'Stop'
$resolvedPath = (Resolve-Path -LiteralPath $WorkbookPath).Path
$beforeHash = (Get-FileHash -LiteralPath $resolvedPath).Hash
$excel = $null
$book = $null
try {
  # A separate Excel instance uses the object model, without driving the user's UI.
  $excel = New-Object -ComObject Excel.Application
  $excel.Visible = $false
  $excel.DisplayAlerts = $false
  # xlNormalLoad (0) does not attempt recovery through the object model:
  # https://learn.microsoft.com/en-us/office/vba/api/excel.workbooks.open
  $book = $excel.Workbooks.Open($resolvedPath, 0, $true)
  if ($book.Worksheets.Count -ne 6) { throw 'Expected all six fixture worksheets' }
  $sheet = $book.Worksheets.Item('Expenses & Commissions')
  $details = $book.Worksheets.Item('Transaction Details')
  if ($sheet.Range('F5').Value2 -ne 100 -or $sheet.Range('F6').Value2 -ne 120 -or $sheet.Range('F7').Value2 -ne 220) { throw 'Deduction totals changed' }
  if ($sheet.Range('A1').Interior.Color -ne $details.Range('A1').Interior.Color) { throw 'Header design mismatch' }
  if ($sheet.Range('F7').Interior.Color -ne $details.Range('A3').Interior.Color) { throw 'Total design mismatch' }
  if (-not $sheet.AutoFilterMode -or $sheet.AutoFilter.Filters.Count -ne 8) { throw 'Column filters missing' }
  $sheet.Activate()
  if (-not $excel.ActiveWindow.FreezePanes -or $excel.ActiveWindow.SplitRow -ne 1) { throw 'Frozen header missing' }
  if ($sheet.Range('F2').NumberFormat -notmatch 'AED') { throw 'AED format missing' }
  Write-Output "PASS: Microsoft Excel $($excel.Version) opened normally without recovery; six sheets, totals, design, filter, freeze and AED format verified."
} finally {
  if ($book) { $book.Close($false) }
  if ($excel) { $excel.Quit(); [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }
}
if ((Get-FileHash -LiteralPath $resolvedPath).Hash -ne $beforeHash) { throw 'Native check must not modify the workbook' }
