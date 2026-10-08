# Compatible with Windows PowerShell 5.1 and PowerShell 7.
[CmdletBinding()]
param(
    [string]$SourceDirectory = '',
    [string]$RepositoryUrl = 'https://github.com/Zerqoon/test3.git',
    [string]$Branch = 'main',
    [string]$ProjectFolder = 'R3V0-Discord-Bot-v2'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

# Resolve automatic script variables in the script body, after parameters bind.
# An explicit -SourceDirectory always takes precedence.
if ([string]::IsNullOrWhiteSpace($SourceDirectory)) {
    if (-not [string]::IsNullOrWhiteSpace($PSScriptRoot)) {
        $SourceDirectory = $PSScriptRoot
    } elseif (-not [string]::IsNullOrWhiteSpace($PSCommandPath)) {
        $SourceDirectory = [System.IO.Path]::GetDirectoryName($PSCommandPath)
    } else {
        $SourceDirectory = (Get-Location).Path
    }
}
if ([string]::IsNullOrWhiteSpace($SourceDirectory)) {
    throw 'Pass -SourceDirectory with the full path to your extracted GOAT-Clan-Bot folder.'
}
if (-not (Test-Path -LiteralPath $SourceDirectory -PathType Container)) {
    throw "Project directory does not exist: $SourceDirectory. Extract the complete ZIP first."
}
$SourceDirectory = (Resolve-Path -LiteralPath $SourceDirectory).Path

function Invoke-GoatGit {
    param([string[]]$GitArguments)
    & git @GitArguments
    if ($LASTEXITCODE -ne 0) { throw "Git failed with exit code $LASTEXITCODE." }
}

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    throw 'Install Git for Windows from https://git-scm.com/download/win and reopen PowerShell.'
}
if (-not (Get-Command robocopy -ErrorAction SilentlyContinue)) { throw 'This script requires Windows robocopy.' }
if ($ProjectFolder -notmatch '^[A-Za-z0-9_-]+$') { throw 'ProjectFolder must be a single directory name.' }
foreach ($required in @('package.json', 'package-lock.json', 'Dockerfile', 'config.json', '.env.example', 'src', 'assets', 'docs/github-subfolder-ci.yml', 'src/services/tickets.ts', 'src/services/ticket-votes.ts', 'src/services/message-events.ts', 'src/services/link-filter.ts', 'src/services/custom-embeds.ts', 'src/services/members.ts', 'assets/application-mastery-example.png')) {
    if (-not (Test-Path -LiteralPath (Join-Path $SourceDirectory $required))) { throw "Missing project file: $required. Extract the complete ZIP first." }
}
$manifest = Get-Content -LiteralPath (Join-Path $SourceDirectory 'package.json') -Raw | ConvertFrom-Json
if (-not $manifest.PSObject.Properties['version']) { throw 'Missing project version in package.json.' }
$goatVersion = [version]([string]$manifest.version)
if ($goatVersion -lt [version]'2.3.0' -or $goatVersion.Major -ne 2) {
    throw 'This directory does not contain the latest GOAT project. Copy ALL contents of GOAT-Clan-Bot from the new ZIP, not just this script.'
}
$settings = Get-Content -LiteralPath (Join-Path $SourceDirectory 'config.json') -Raw | ConvertFrom-Json
if (-not $settings.PSObject.Properties['tickets'] -or -not $settings.tickets.PSObject.Properties['enabled'] -or $settings.tickets.enabled -ne $true) {
    throw 'Tickets are not enabled in this config.json. Use config.json from the complete GOAT 2.3 ZIP.'
}
if (-not $settings.PSObject.Properties['linkFilter'] -or $settings.linkFilter.enabled -ne $true) {
    throw 'The new link filter is not enabled. Use config.json from the complete GOAT 2.3 ZIP.'
}
Write-Host ('Source directory: ' + $SourceDirectory) -ForegroundColor Cyan
Write-Host ('GOAT version: ' + $manifest.version + ' | Tickets and link filter: enabled') -ForegroundColor Cyan

$checkout = Join-Path ([System.IO.Path]::GetTempPath()) ('goat-upload-' + [Guid]::NewGuid().ToString('N'))
$completed = $false
try {
    Write-Host 'Cloning the current GitHub branch...' -ForegroundColor Cyan
    Invoke-GoatGit -GitArguments @('clone', '--single-branch', '--branch', $Branch, '--', $RepositoryUrl, $checkout)
    $destination = Join-Path $checkout $ProjectFolder
    if (Test-Path -LiteralPath $destination) { Remove-Item -LiteralPath $destination -Recurse -Force }
    New-Item -ItemType Directory -Path $destination -Force | Out-Null

    Write-Host 'Copying GOAT 2.3 source without tokens or local databases...' -ForegroundColor Cyan
    & robocopy $SourceDirectory $destination /E /R:2 /W:1 /XJ /NFL /NDL /NJH /NJS `
        /XD .git node_modules dist data backups logs __pycache__ `
        /XF .env '.env.*' '*.sqlite*' '*.db*' '*.log' '*.pyc'
    $copyExit = $LASTEXITCODE
    if ($copyExit -ge 8) { throw "Robocopy failed with exit code $copyExit." }
    Copy-Item -LiteralPath (Join-Path $SourceDirectory '.env.example') -Destination (Join-Path $destination '.env.example') -Force
    New-Item -ItemType Directory -Path (Join-Path $destination 'data') -Force | Out-Null
    New-Item -ItemType File -Path (Join-Path $destination 'data/.gitkeep') -Force | Out-Null

    $workflows = Join-Path $checkout '.github/workflows'
    New-Item -ItemType Directory -Path $workflows -Force | Out-Null
    Copy-Item -LiteralPath (Join-Path $SourceDirectory 'docs/github-subfolder-ci.yml') -Destination (Join-Path $workflows 'goat-checks.yml') -Force

    $authorName = & git -C $checkout config user.name
    if ([string]::IsNullOrWhiteSpace(($authorName -join ''))) {
        Invoke-GoatGit -GitArguments @('-C', $checkout, 'config', 'user.name', 'Zerqoon')
    }
    $authorEmail = & git -C $checkout config user.email
    if ([string]::IsNullOrWhiteSpace(($authorEmail -join ''))) {
        Invoke-GoatGit -GitArguments @('-C', $checkout, 'config', 'user.email', 'Zerqoon@users.noreply.github.com')
    }
    Invoke-GoatGit -GitArguments @('-C', $checkout, 'add', '--', $ProjectFolder, '.github/workflows/goat-checks.yml')
    & git -C $checkout diff --cached --quiet -- $ProjectFolder '.github/workflows/goat-checks.yml'
    $difference = $LASTEXITCODE
    if ($difference -gt 1) { throw "Unable to inspect staged changes: $difference." }
    if ($difference -eq 0) {
        Write-Host 'GitHub already contains this project.' -ForegroundColor Green
    } else {
        Invoke-GoatGit -GitArguments @('-C', $checkout, 'commit', '-m', 'Update GOAT 2.3: manual Start Vote, first to 3, fast message logs and public activity and custom embeds')
        Invoke-GoatGit -GitArguments @('-C', $checkout, 'push', 'origin', ('HEAD:' + $Branch))
        Write-Host ('GOAT ' + $manifest.version + ' uploaded. Railway can now deploy this commit.') -ForegroundColor Green
    }
    Write-Host ('Railway Root Directory: /' + $ProjectFolder) -ForegroundColor Yellow
    $uploadedCommit = & git -C $checkout rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Unable to read the uploaded commit.' }
    Write-Host ('GitHub commit: ' + ($uploadedCommit -join '')) -ForegroundColor Cyan
    Write-Host ('Deploy this exact commit on Railway. Runtime logs should show GOAT ready with version ' + $manifest.version + '.') -ForegroundColor Yellow
    Write-Host 'Keep the existing /app/data volume and Discord token in Railway Variables.' -ForegroundColor Yellow
    $completed = $true
} catch {
    Write-Host ('Upload failed. The temporary checkout was kept at: ' + $checkout) -ForegroundColor Yellow
    throw
} finally {
    if ($completed -and (Test-Path -LiteralPath $checkout)) { Remove-Item -LiteralPath $checkout -Recurse -Force }
}
