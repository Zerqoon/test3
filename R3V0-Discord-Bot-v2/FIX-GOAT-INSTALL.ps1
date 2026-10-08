# Windows PowerShell 5.1 / PowerShell 7.
# Uses the installer bundled in the newest GOAT ZIP, bypassing stale downloads.
[CmdletBinding()]
param(
    [string]$ZipPath = '',
    [string]$DestinationDirectory = 'C:\Users\zerqo\Desktop\GOAT-Clan-Bot'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    $goatProfilePath = [Environment]::GetFolderPath('UserProfile')
    $goatSearchPaths = @($PSScriptRoot, (Join-Path $goatProfilePath 'Downloads'), (Get-Location).Path) |
        Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
    $goatCandidates = @()
    foreach ($goatSearchPath in $goatSearchPaths) {
        if (Test-Path -LiteralPath $goatSearchPath -PathType Container) {
            $goatCandidates += Get-ChildItem -LiteralPath $goatSearchPath -Filter 'GOAT-Clan-Bot-v2-Tickets*.zip' -File
        }
    }
    $goatZipFile = $goatCandidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $goatZipFile) { throw 'Download the latest GOAT-Clan-Bot-v2-Tickets.zip first, or supply -ZipPath.' }
    $ZipPath = $goatZipFile.FullName
}
if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) { throw "ZIP file not found: $ZipPath" }
$ZipPath = (Resolve-Path -LiteralPath $ZipPath).Path
$goatExtractPath = Join-Path ([System.IO.Path]::GetTempPath()) ('goat-fix-' + [Guid]::NewGuid().ToString('N'))
$goatSourceRoot = Join-Path $goatExtractPath 'GOAT-Clan-Bot'
$goatCompleted = $false
try {
    Write-Host ('Using ZIP: ' + $ZipPath) -ForegroundColor Cyan
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $goatExtractPath -Force
    foreach ($goatRequired in @('package.json', 'INSTALL-AND-UPLOAD-GOAT.ps1', 'UPLOAD-GITHUB.ps1', 'src/services/ticket-votes.ts', 'src/services/clan-intake.ts', 'src/services/message-events.ts', 'src/services/link-filter.ts', 'src/services/role-reminders.ts', 'src/services/filter-notices.ts', 'src/services/temporary-messages.ts')) {
        if (-not (Test-Path -LiteralPath (Join-Path $goatSourceRoot $goatRequired) -PathType Leaf)) {
            throw 'This is an older or incomplete ZIP. Download the complete GOAT 2.5 project again.'
        }
    }
    $goatManifest = Get-Content -LiteralPath (Join-Path $goatSourceRoot 'package.json') -Raw | ConvertFrom-Json
    $goatVersion = [version]([string]$goatManifest.version)
    if ($goatVersion -lt [version]'2.5.0' -or $goatVersion.Major -ne 2) {
        throw ('Unsupported project version: ' + $goatManifest.version + '. Download the latest GOAT project ZIP.')
    }
    Write-Host ('Bundled project version: ' + $goatManifest.version) -ForegroundColor Green
    $goatInstallerPath = Join-Path $goatSourceRoot 'INSTALL-AND-UPLOAD-GOAT.ps1'
    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File $goatInstallerPath -ZipPath $ZipPath -DestinationDirectory $DestinationDirectory
    $goatChildExit = $LASTEXITCODE
    if ($goatChildExit -ne 0) { throw "The bundled installer stopped with exit code $goatChildExit. Read its message above." }
    $goatCompleted = $true
} finally {
    if ($goatCompleted -and (Test-Path -LiteralPath $goatExtractPath)) {
        Remove-Item -LiteralPath $goatExtractPath -Recurse -Force
    } else {
        Write-Host ('Extracted project kept at: ' + $goatSourceRoot) -ForegroundColor Yellow
    }
}
