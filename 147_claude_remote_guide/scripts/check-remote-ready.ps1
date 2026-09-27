<#
.SYNOPSIS
    Kiem tra may nay da du dieu kien bat Claude Code Remote Control chua.

.DESCRIPTION
    Soi dung nhung thu hay lam hong Remote Control: phien ban CLI, credential
    dang chiem quyen, base URL, provider ben thu ba, co feature-flag, va setting
    disableRemoteControl trong cac file settings.

    Script chi doc, khong sua gi ca.

.EXAMPLE
    powershell -ExecutionPolicy Bypass -File .\check-remote-ready.ps1
#>

[CmdletBinding()]
param(
    [string] $ProjectPath = (Get-Location).Path
)

$ErrorActionPreference = 'Continue'

$script:Blockers = 0
$script:Warnings = 0

function Write-Head($text) {
    Write-Host ""
    Write-Host "== $text" -ForegroundColor Cyan
}

function Write-Ok($label, $detail) {
    Write-Host "  [ OK ] $label" -ForegroundColor Green
    if ($detail) { Write-Host "         $detail" -ForegroundColor DarkGray }
}

function Write-Warn($label, $detail) {
    $script:Warnings++
    Write-Host "  [WARN] $label" -ForegroundColor Yellow
    if ($detail) { Write-Host "         $detail" -ForegroundColor DarkGray }
}

function Write-Block($label, $detail) {
    $script:Blockers++
    Write-Host "  [STOP] $label" -ForegroundColor Red
    if ($detail) { Write-Host "         $detail" -ForegroundColor DarkGray }
}

function Test-EnvVar($name) {
    $value = [Environment]::GetEnvironmentVariable($name)
    if ([string]::IsNullOrWhiteSpace($value)) { return $null }
    return $value
}

Write-Host ""
Write-Host "Claude Code Remote Control - kiem tra dieu kien" -ForegroundColor White
Write-Host "Thu muc: $ProjectPath" -ForegroundColor DarkGray

# ---------------------------------------------------------------- 1. CLI -----
Write-Head "1. Claude Code CLI"

$claude = Get-Command claude -ErrorAction SilentlyContinue
if (-not $claude) {
    Write-Block "Khong tim thay lenh 'claude' trong PATH" "Cai dat: https://code.claude.com/docs/en/quickstart"
} else {
    $raw = (& claude --version) 2>&1 | Select-Object -First 1
    $parsed = [regex]::Match([string]$raw, '(\d+)\.(\d+)\.(\d+)')
    if (-not $parsed.Success) {
        Write-Warn "Khong doc duoc phien ban" "claude --version tra ve: $raw"
    } else {
        $current = [version] $parsed.Value
        Write-Ok "claude $current" $claude.Source

        # Moc phien ban lien quan toi Remote Control
        $milestones = @(
            @{ Ver = '2.1.234'; What = 'cross-session messaging tren Windows native' },
            @{ Ver = '2.1.238'; What = 'chon model/effort tu thiet bi, phuc vu lai session crash' },
            @{ Ver = '2.1.283'; What = 'dung Remote Control khi bat DISABLE_TELEMETRY / DO_NOT_TRACK' }
        )
        foreach ($m in $milestones) {
            if ($current -lt [version] $m.Ver) {
                Write-Warn "Ban cu hon $($m.Ver)" "Chua co: $($m.What). Chay 'claude update' neu can."
            }
        }
    }
}

# ------------------------------------------------------- 2. Auth / endpoint --
Write-Head "2. Xac thuc va endpoint"

$authBlockers = @(
    @{ Name = 'ANTHROPIC_API_KEY';      Why = 'Remote Control khong chay voi API key' },
    @{ Name = 'ANTHROPIC_AUTH_TOKEN';   Why = 'Remote Control khong chay voi auth token' },
    @{ Name = 'CLAUDE_CODE_OAUTH_TOKEN';Why = 'Token dai han chi goi duoc model, khong tao duoc RC session' }
)
$foundAuthBlocker = $false
foreach ($a in $authBlockers) {
    if (Test-EnvVar $a.Name) {
        $foundAuthBlocker = $true
        Write-Block "$($a.Name) dang duoc dat" "$($a.Why). Go bien nay khoi shell va khoi block env trong settings."
    }
}
if (-not $foundAuthBlocker) {
    Write-Ok "Khong co credential nao chiem quyen dang nhap claude.ai" $null
}

$baseUrl = Test-EnvVar 'ANTHROPIC_BASE_URL'
if ($baseUrl) {
    if ($baseUrl -match 'api\.anthropic\.com') {
        Write-Ok "ANTHROPIC_BASE_URL tro ve api.anthropic.com" $baseUrl
    } else {
        Write-Block "ANTHROPIC_BASE_URL tro ra ngoai api.anthropic.com" "$baseUrl - Remote Control chi chay qua api.anthropic.com"
    }
} else {
    Write-Ok "ANTHROPIC_BASE_URL khong dat (dung mac dinh api.anthropic.com)" $null
}

$providers = @('CLAUDE_CODE_USE_BEDROCK', 'CLAUDE_CODE_USE_VERTEX', 'CLAUDE_CODE_USE_FOUNDRY')
$foundProvider = $false
foreach ($p in $providers) {
    if (Test-EnvVar $p) {
        $foundProvider = $true
        Write-Block "$p dang duoc dat" "Remote Control va cloud session khong ho tro provider ben thu ba"
    }
}
if (-not $foundProvider) {
    Write-Ok "Khong dung provider ben thu ba" $null
}

# ----------------------------------------------------- 3. Co feature flag ----
Write-Head "3. Co feature-flag"

$hardFlags = @('CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC', 'DISABLE_GROWTHBOOK')
$softFlags = @('DISABLE_TELEMETRY', 'DO_NOT_TRACK')
$foundFlag = $false
foreach ($f in $hardFlags) {
    if (Test-EnvVar $f) {
        $foundFlag = $true
        Write-Block "$f dang duoc dat" "Remote Control khong kha dung. Go bien nay."
    }
}
foreach ($f in $softFlags) {
    if (Test-EnvVar $f) {
        $foundFlag = $true
        Write-Warn "$f dang duoc dat" "Van dung duoc RC tu v2.1.283. Phai go neu to chuc yeu cau Trusted Devices."
    }
}
if (-not $foundFlag) {
    Write-Ok "Khong co co nao chan feature-flag evaluation" $null
}

# ------------------------------------------------------- 4. File settings ----
Write-Head "4. File settings"

$settingsFiles = @(
    (Join-Path $env:USERPROFILE '.claude\settings.json'),
    (Join-Path $ProjectPath '.claude\settings.json'),
    (Join-Path $ProjectPath '.claude\settings.local.json')
) | Select-Object -Unique

foreach ($file in $settingsFiles) {
    if (-not (Test-Path -LiteralPath $file)) { continue }

    $json = $null
    try {
        $json = Get-Content -LiteralPath $file -Raw -Encoding UTF8 | ConvertFrom-Json
    } catch {
        Write-Warn "Khong parse duoc $file" $_.Exception.Message
        continue
    }

    $notes = @()
    if ($json.PSObject.Properties.Name -contains 'disableRemoteControl' -and $json.disableRemoteControl) {
        Write-Block "disableRemoteControl = true trong $file" "Remote Control bi tat o file nay"
    }
    if ($json.PSObject.Properties.Name -contains 'apiKeyHelper') {
        Write-Block "apiKeyHelper duoc dat trong $file" "Setting nay chiem quyen dang nhap claude.ai"
    }
    if ($json.PSObject.Properties.Name -contains 'remoteControlAtStartup') {
        $notes += "remoteControlAtStartup = $($json.remoteControlAtStartup)"
    }
    if ($json.PSObject.Properties.Name -contains 'crossSessionInbound') {
        $notes += "crossSessionInbound = $($json.crossSessionInbound)"
    }
    if ($json.PSObject.Properties.Name -contains 'env') {
        foreach ($name in $json.env.PSObject.Properties.Name) {
            if ($hardFlags -contains $name -or $authBlockers.Name -contains $name -or $name -eq 'ANTHROPIC_BASE_URL') {
                Write-Block "$name duoc dat trong block env cua $file" "Bien trong settings cung chan Remote Control nhu bien shell"
            }
        }
    }

    if ($notes.Count -gt 0) {
        Write-Ok $file ($notes -join ' | ')
    } else {
        Write-Ok $file "khong co setting nao anh huong Remote Control"
    }
}

# ------------------------------------------------------------ 5. Workspace --
Write-Head "5. Workspace"

$gitDir = Join-Path $ProjectPath '.git'
if (Test-Path -LiteralPath $gitDir) {
    Write-Ok "Thu muc nay la git repo" "dung duoc 'claude remote-control --spawn worktree'"
} else {
    Write-Warn "Thu muc nay khong phai git repo" "--spawn worktree se khong dung duoc, chi con same-dir / session"
}

if ($ProjectPath -eq $env:USERPROFILE) {
    Write-Warn "Ban dang o thu muc home" "Hop thoai workspace trust khong bao gio luu trust cho home. Chay Remote Control tu thu muc du an."
}

# ---------------------------------------------------------------- Ket luan --
Write-Host ""
Write-Host "-------------------------------------------------------------" -ForegroundColor DarkGray
if ($script:Blockers -gt 0) {
    Write-Host "Ket qua: $($script:Blockers) van de chan, $($script:Warnings) canh bao" -ForegroundColor Red
    Write-Host "Xu ly cac dong [STOP] truoc, sau do chay lai script nay." -ForegroundColor Red
    Write-Host "Chi tiet tung loi: xem TROUBLESHOOTING.md" -ForegroundColor DarkGray
    exit 1
}

Write-Host "Ket qua: khong co van de chan, $($script:Warnings) canh bao" -ForegroundColor Green
Write-Host ""
Write-Host "Buoc tiep theo:" -ForegroundColor White
Write-Host "  1. claude              # mot lan de bam dong y workspace trust" -ForegroundColor Gray
Write-Host "  2. claude auth login   # neu chua dang nhap bang tai khoan claude.ai" -ForegroundColor Gray
Write-Host "  3. claude remote-control --name `"$(Split-Path $ProjectPath -Leaf)`"" -ForegroundColor Gray
Write-Host ""
exit 0
