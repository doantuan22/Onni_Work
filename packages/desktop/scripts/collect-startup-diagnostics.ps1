param(
    [string]$Executable = (Join-Path (Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))) 'packages\desktop\src-tauri\target\release\onni-desktop.exe'),
    [switch]$CheckExisting
)

$ErrorActionPreference = 'Stop'
$Executable = (Resolve-Path -LiteralPath $Executable).Path
$logPath = Join-Path $env:LOCALAPPDATA 'Onni Work\logs\desktop-sidecar.log'

if (Get-Process -Name 'onni-desktop' -ErrorAction SilentlyContinue) {
    throw 'Close every Onni Work desktop instance first, then run this script again.'
}

$startByte = if (Test-Path -LiteralPath $logPath) { (Get-Item -LiteralPath $logPath).Length } else { 0 }
Write-Host "Launching: $Executable"
Write-Host "Sidecar log: $logPath"
if ($CheckExisting) {
    Write-Host 'In the app, confirm the previous mock:slow task is still visible with status Cancelled, then choose Quit from the tray menu.'
} else {
    Write-Host 'In the app, wait for health. If it opens, create a mock task, cancel it, then choose Quit from the tray menu. If it shows an error, leave the page visible and close from the tray.'
}

$app = Start-Process -FilePath $Executable -PassThru
$healthStatus = $null
$healthDeadline = [DateTime]::UtcNow.AddSeconds(60)
while ([DateTime]::UtcNow -lt $healthDeadline -and -not $healthStatus) {
    $app.Refresh()
    if (Test-Path -LiteralPath $logPath) {
        $currentBytes = [System.IO.File]::ReadAllBytes($logPath)
        $offset = [Math]::Min([long]$startByte, [long]$currentBytes.Length)
        $length = $currentBytes.Length - [int]$offset
        if ($length -gt 0) {
            $newLines = [System.Text.Encoding]::UTF8.GetString($currentBytes, [int]$offset, $length)
            if ($newLines -match '(?m)event=health-ok\b') {
                $healthStatus = 'PASS'
            } elseif ($newLines -match '(?m)event=(node-check-failed|engine-missing|spawn-failed|sidecar-spawn-error|health-failed)\b') {
                $healthStatus = 'FAIL'
            }
        }
    }
    if (-not $healthStatus -and $app.HasExited) { $healthStatus = 'FAIL' }
    if (-not $healthStatus) { Start-Sleep -Milliseconds 250 }
}
if (-not $healthStatus) { $healthStatus = 'FAIL' }
Write-Output "SIDECAR_HEALTH=$healthStatus"

$app.WaitForExit()
$app.Refresh()
Write-Host "Desktop exit code: $($app.ExitCode)"

if (-not (Test-Path -LiteralPath $logPath)) {
    Write-Warning 'The desktop did not create its sidecar log. Confirm this executable was rebuilt from the diagnostic changes.'
    exit 2
}

$bytes = [System.IO.File]::ReadAllBytes($logPath)
$offset = [Math]::Min([long]$startByte, [long]$bytes.Length)
$length = $bytes.Length - [int]$offset
if ($length -gt 0) {
    $runLog = [System.Text.Encoding]::UTF8.GetString($bytes, [int]$offset, $length)
    Write-Output '----- New sidecar log lines -----'
    Write-Output $runLog
    Write-Output '----- End sidecar log -----'
} else {
    Write-Warning 'No new lines were written to the sidecar log.'
}

Write-Host "Review the output for local paths or any secret-looking values before sending it back."
if ($healthStatus -ne 'PASS') { exit 1 }
