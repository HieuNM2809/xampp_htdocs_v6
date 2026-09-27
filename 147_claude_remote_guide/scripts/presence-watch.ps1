<#
.SYNOPSIS
    Tao/xoa presence file theo trang thai khoa man hinh Windows.

.DESCRIPTION
    Claude Code bo qua push notification khi file tro boi bien
    CLAUDE_CLIENT_PRESENCE_FILE dang ton tai. Script nay tao file khi man hinh
    mo khoa (ban dang o may) va xoa file khi khoa man hinh (ban da roi di), nho
    do dien thoai chi rung khi ban thuc su khong o do.

    Phat hien khoa man hinh bang tien trinh LogonUI - tien trinh nay chay o man
    hinh khoa va man hinh dang nhap. Day la suy doan theo kinh nghiem, khong
    phai API chinh thuc, nhung du chinh xac cho muc dich nay.

    Bam Ctrl+C de dung. Script xoa presence file truoc khi thoat de ban khong
    bi mat thong bao vinh vien.

.PARAMETER PresenceFile
    Duong dan file danh dau. Phai trung voi CLAUDE_CLIENT_PRESENCE_FILE trong
    settings hoac bien moi truong.

.PARAMETER IntervalSeconds
    Chu ky kiem tra, mac dinh 5 giay.

.PARAMETER Once
    Chi danh gia mot lan roi thoat (dung de test hoac chay tu Task Scheduler).

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\presence-watch.ps1

.EXAMPLE
    .\presence-watch.ps1 -PresenceFile "C:\Users\me\.claude\presence.marker" -IntervalSeconds 10
#>

[CmdletBinding()]
param(
    [string] $PresenceFile = (Join-Path $env:USERPROFILE '.claude\presence.marker'),
    [int]    $IntervalSeconds = 5,
    [switch] $Once
)

$ErrorActionPreference = 'Stop'

function Test-ScreenLocked {
    $logonUi = Get-Process -Name 'LogonUI' -ErrorAction SilentlyContinue
    return ($null -ne $logonUi)
}

function Set-Presence([bool] $atMachine) {
    $exists = Test-Path -LiteralPath $PresenceFile

    if ($atMachine -and -not $exists) {
        New-Item -ItemType File -Path $PresenceFile -Force | Out-Null
        Write-Host "$(Get-Date -Format 'HH:mm:ss')  mo khoa  -> tao file, push notification TAT" -ForegroundColor DarkGray
        return
    }

    if (-not $atMachine -and $exists) {
        Remove-Item -LiteralPath $PresenceFile -Force
        Write-Host "$(Get-Date -Format 'HH:mm:ss')  khoa may -> xoa file, push notification BAT" -ForegroundColor DarkGray
    }
}

$parent = Split-Path -Parent $PresenceFile
if ($parent -and -not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
}

Write-Host ""
Write-Host "Presence file : $PresenceFile" -ForegroundColor White
Write-Host "Chu ky        : ${IntervalSeconds}s" -ForegroundColor DarkGray
Write-Host ""
Write-Host "Nho dat trong ~\.claude\settings.json:" -ForegroundColor DarkGray
Write-Host "  { `"env`": { `"CLAUDE_CLIENT_PRESENCE_FILE`": `"$($PresenceFile -replace '\\', '\\')`" } }" -ForegroundColor DarkGray
Write-Host ""

try {
    do {
        Set-Presence (-not (Test-ScreenLocked))
        if ($Once) { break }
        Start-Sleep -Seconds $IntervalSeconds
    } while ($true)
}
finally {
    # Khong de lai file khi thoat: con file la con im lang.
    if (Test-Path -LiteralPath $PresenceFile) {
        Remove-Item -LiteralPath $PresenceFile -Force -ErrorAction SilentlyContinue
        Write-Host "Da xoa presence file khi thoat." -ForegroundColor DarkGray
    }
}
