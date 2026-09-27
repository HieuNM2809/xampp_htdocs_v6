<#
.SYNOPSIS
    Khoi dong Claude Code Remote Control o server mode (Windows).

.DESCRIPTION
    Kiem tra truoc khi chay: thu muc ton tai, la git repo neu dung --spawn
    worktree, cac co khong dung chung duoc, va canh bao neu may duoc cau hinh
    ngu (session se offline khi may ngu).

    Moi co deu duoc dat SAU chu 'remote-control' - dat truoc se khong duoc
    truyen xuong cac session ma server tao ra.

.PARAMETER Name
    Tieu de session hien o claude.ai/code. Mac dinh: ten thu muc.

.PARAMETER Spawn
    same-dir (mac dinh) | worktree | session

.PARAMETER Capacity
    So session dong thoi toi da. Khong dung chung voi -Spawn session.

.PARAMETER PermissionMode
    Permission mode khoi diem cho cac session server tao ra.

.PARAMETER DryRun
    Chi in ra lenh se chay, khong chay that.

.EXAMPLE
    .\start-remote-control.ps1 -Name "Hasaki API" -Spawn worktree -Capacity 4

.EXAMPLE
    .\start-remote-control.ps1 -PermissionMode acceptEdits -DryRun
#>

[CmdletBinding()]
param(
    [string] $Name,

    [ValidateSet('same-dir', 'worktree', 'session')]
    [string] $Spawn = 'same-dir',

    [int] $Capacity = 0,

    [ValidateSet('default', 'acceptEdits', 'auto', 'dontAsk', 'plan', 'bypassPermissions')]
    [string] $PermissionMode,

    [string] $ProjectPath = (Get-Location).Path,

    [switch] $DryRun
)

$ErrorActionPreference = 'Stop'

# ------------------------------------------------------------- kiem tra -----
if (-not (Get-Command claude -ErrorAction SilentlyContinue)) {
    Write-Host "Khong tim thay lenh 'claude' trong PATH." -ForegroundColor Red
    exit 1
}

if (-not (Test-Path -LiteralPath $ProjectPath -PathType Container)) {
    Write-Host "Thu muc khong ton tai: $ProjectPath" -ForegroundColor Red
    exit 1
}

$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
Set-Location -LiteralPath $ProjectPath

if ($Spawn -eq 'worktree' -and -not (Test-Path -LiteralPath (Join-Path $ProjectPath '.git'))) {
    Write-Host "-Spawn worktree can mot git repo, nhung $ProjectPath khong phai." -ForegroundColor Red
    Write-Host "Dung -Spawn same-dir, hoac chay tu thu muc repo." -ForegroundColor Yellow
    exit 1
}

if ($Capacity -gt 0 -and $Spawn -eq 'session') {
    Write-Host "--capacity khong dung chung duoc voi --spawn session." -ForegroundColor Red
    exit 1
}

if (-not $Name) {
    $Name = Split-Path $ProjectPath -Leaf
}

# Canh bao neu may duoc cau hinh ngu khi cam dien: may ngu = session offline.
try {
    $sleepInfo = powercfg /query SCHEME_CURRENT SUB_SLEEP STANDBYIDLE 2>$null
    $acLine = $sleepInfo | Select-String -Pattern 'Current AC Power Setting Index' | Select-Object -First 1
    if ($acLine -and $acLine.ToString() -notmatch '0x00000000') {
        Write-Host "Canh bao: may duoc cau hinh ngu khi cam dien." -ForegroundColor Yellow
        Write-Host "         May ngu thi Remote Control session offline. Settings > Power > Never." -ForegroundColor DarkGray
    }
} catch {
    # powercfg khong chay duoc thi bo qua, day chi la canh bao.
}

# --------------------------------------------------------------- chay -------
$claudeArgs = @('remote-control', '--name', $Name, '--spawn', $Spawn)
if ($Capacity -gt 0)  { $claudeArgs += @('--capacity', "$Capacity") }
if ($PermissionMode)  { $claudeArgs += @('--permission-mode', $PermissionMode) }

$printable = ($claudeArgs | ForEach-Object {
    if ($_ -match '\s') { '"' + $_ + '"' } else { $_ }
}) -join ' '

Write-Host ""
Write-Host "Thu muc : $ProjectPath" -ForegroundColor DarkGray
Write-Host "Lenh    : claude $printable" -ForegroundColor White
Write-Host ""
Write-Host "Trong luc chay: [space] hien QR code | [w] doi same-dir/worktree | [Ctrl+C] dung" -ForegroundColor DarkGray
Write-Host "Dung roi van lay lai session duoc trong ~4 gio: claude remote-control --continue" -ForegroundColor DarkGray
Write-Host ""

if ($DryRun) {
    Write-Host "(-DryRun: khong chay that)" -ForegroundColor Yellow
    exit 0
}

& claude @claudeArgs
exit $LASTEXITCODE
