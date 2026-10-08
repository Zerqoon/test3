# Windows PowerShell 5.1 / PowerShell 7.
# Reads the complete GOAT ZIP, updates the local project and uploads the ZIP source.
[CmdletBinding()]
param(
    [string]$ZipPath = '',
    [string]$DestinationDirectory = 'C:\Users\zerqo\Desktop\GOAT-Clan-Bot'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

if ([string]::IsNullOrWhiteSpace($ZipPath)) {
    $profileDirectory = [Environment]::GetFolderPath('UserProfile')
    $downloadDirectories = @(
        $PSScriptRoot,
        (Join-Path $profileDirectory 'Downloads'),
        [Environment]::GetFolderPath('DesktopDirectory'),
        (Get-Location).Path
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) } | Select-Object -Unique
    $zipCandidates = @()
    foreach ($directory in $downloadDirectories) {
        if (Test-Path -LiteralPath $directory -PathType Container) {
            $zipCandidates += Get-ChildItem -LiteralPath $directory -Filter 'GOAT-Clan-Bot-v2-Tickets*.zip' -File
        }
    }
    $selectedZip = $zipCandidates | Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if (-not $selectedZip) {
        throw 'Download GOAT-Clan-Bot-v2-Tickets.zip first, or run this script with -ZipPath and the full ZIP path.'
    }
    $ZipPath = $selectedZip.FullName
}
if (-not (Test-Path -LiteralPath $ZipPath -PathType Leaf)) { throw "ZIP file not found: $ZipPath" }
if ([string]::IsNullOrWhiteSpace($DestinationDirectory)) { throw 'DestinationDirectory cannot be empty.' }
if (-not (Get-Command git -ErrorAction SilentlyContinue)) { throw 'Install Git for Windows and reopen PowerShell.' }
if (-not (Get-Command robocopy -ErrorAction SilentlyContinue)) { throw 'This script requires Windows robocopy.' }

$ZipPath = (Resolve-Path -LiteralPath $ZipPath).Path
$extractedDirectory = Join-Path ([System.IO.Path]::GetTempPath()) ('goat-install-' + [Guid]::NewGuid().ToString('N'))
$source = Join-Path $extractedDirectory 'GOAT-Clan-Bot'
$completed = $false
try {
    Write-Host ('Reading ZIP: ' + $ZipPath) -ForegroundColor Cyan
    Expand-Archive -LiteralPath $ZipPath -DestinationPath $extractedDirectory -Force
    foreach ($required in @('package.json', 'config.json', 'UPLOAD-GITHUB.ps1', 'src/services/tickets.ts', 'src/services/ticket-votes.ts', 'src/services/message-events.ts', 'src/services/link-filter.ts', 'src/services/custom-embeds.ts', 'assets/application-mastery-example.png')) {
        if (-not (Test-Path -LiteralPath (Join-Path $source $required))) {
            throw "Wrong or incomplete ZIP: missing $required. Download the latest complete GOAT project."
        }
    }
    $manifest = Get-Content -LiteralPath (Join-Path $source 'package.json') -Raw | ConvertFrom-Json
    $goatVersion = [version]([string]$manifest.version)
    if ($goatVersion -lt [version]'2.3.0' -or $goatVersion.Major -ne 2) { throw 'Download the latest GOAT 2.3 project ZIP.' }
    Write-Host ('Verified ZIP source: GOAT ' + $manifest.version + ' with message logs and link filtering.') -ForegroundColor Green

    New-Item -ItemType Directory -Path $DestinationDirectory -Force | Out-Null
    & robocopy $source $DestinationDirectory /E /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS `
        /XD .git node_modules data backups logs /XF .env '*.sqlite*' '*.db*' '*.log'
    $copyExit = $LASTEXITCODE
    if ($copyExit -ge 8) { throw "Project copy failed: robocopy exit code $copyExit." }
    Write-Host ('Local project updated: ' + $DestinationDirectory) -ForegroundColor Green

    # Upload only the freshly extracted source, avoiding an old or nested local folder.
    $uploader = Join-Path $source 'UPLOAD-GITHUB.ps1'
    & $uploader -SourceDirectory $source
    $completed = $true
    Write-Host 'Next: deploy the displayed GitHub commit on Railway.' -ForegroundColor Yellow
} catch {
    Write-Host ('Upload stopped. Extracted project kept at: ' + $source) -ForegroundColor Yellow
    throw
} finally {
    if ($completed -and (Test-Path -LiteralPath $extractedDirectory)) {
        Remove-Item -LiteralPath $extractedDirectory -Recurse -Force
    }
}
