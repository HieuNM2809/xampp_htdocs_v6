#!/usr/bin/env bash
# Kiem tra may nay da du dieu kien bat Claude Code Remote Control chua.
# Chi doc, khong sua gi ca. Chay: bash check-remote-ready.sh [duong-dan-du-an]
set -uo pipefail

PROJECT_PATH="${1:-$PWD}"
BLOCKERS=0
WARNINGS=0

if [ -t 1 ]; then
  C_RED=$'\033[31m'; C_GRN=$'\033[32m'; C_YEL=$'\033[33m'
  C_CYA=$'\033[36m'; C_DIM=$'\033[90m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_GRN=""; C_YEL=""; C_CYA=""; C_DIM=""; C_OFF=""
fi

head_()  { printf '\n%s== %s%s\n' "$C_CYA" "$1" "$C_OFF"; }
ok_()    { printf '  %s[ OK ]%s %s\n' "$C_GRN" "$C_OFF" "$1"; [ -n "${2:-}" ] && printf '         %s%s%s\n' "$C_DIM" "$2" "$C_OFF"; return 0; }
warn_()  { WARNINGS=$((WARNINGS+1)); printf '  %s[WARN]%s %s\n' "$C_YEL" "$C_OFF" "$1"; [ -n "${2:-}" ] && printf '         %s%s%s\n' "$C_DIM" "$2" "$C_OFF"; return 0; }
block_() { BLOCKERS=$((BLOCKERS+1)); printf '  %s[STOP]%s %s\n' "$C_RED" "$C_OFF" "$1"; [ -n "${2:-}" ] && printf '         %s%s%s\n' "$C_DIM" "$2" "$C_OFF"; return 0; }

printf '\nClaude Code Remote Control - kiem tra dieu kien\n'
printf '%sThu muc: %s%s\n' "$C_DIM" "$PROJECT_PATH" "$C_OFF"

# ----------------------------------------------------------------- 1. CLI ---
head_ "1. Claude Code CLI"

if ! command -v claude >/dev/null 2>&1; then
  block_ "Khong tim thay lenh 'claude' trong PATH" "Cai dat: https://code.claude.com/docs/en/quickstart"
else
  RAW="$(claude --version 2>&1 | head -n 1)"
  VER="$(printf '%s' "$RAW" | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' | head -n 1)"
  if [ -z "$VER" ]; then
    warn_ "Khong doc duoc phien ban" "claude --version tra ve: $RAW"
  else
    ok_ "claude $VER" "$(command -v claude)"
    # so sanh semver bang sort -V
    older_than() { [ "$(printf '%s\n%s\n' "$VER" "$1" | sort -V | head -n 1)" = "$VER" ] && [ "$VER" != "$1" ]; }
    older_than "2.1.224" && warn_ "Ban cu hon 2.1.224" "Chua co cross-session messaging"
    older_than "2.1.238" && warn_ "Ban cu hon 2.1.238" "Chua chon duoc model/effort tu thiet bi"
    older_than "2.1.283" && warn_ "Ban cu hon 2.1.283" "Chua dung duoc RC khi bat DISABLE_TELEMETRY / DO_NOT_TRACK"
  fi
fi

# ------------------------------------------------------- 2. Auth / endpoint --
head_ "2. Xac thuc va endpoint"

FOUND_AUTH=0
for pair in \
  "ANTHROPIC_API_KEY|Remote Control khong chay voi API key" \
  "ANTHROPIC_AUTH_TOKEN|Remote Control khong chay voi auth token" \
  "CLAUDE_CODE_OAUTH_TOKEN|Token dai han chi goi duoc model, khong tao duoc RC session"
do
  name="${pair%%|*}"; why="${pair#*|}"
  if [ -n "${!name:-}" ]; then
    FOUND_AUTH=1
    block_ "$name dang duoc dat" "$why. Go khoi shell va khoi block env trong settings."
  fi
done
[ "$FOUND_AUTH" -eq 0 ] && ok_ "Khong co credential nao chiem quyen dang nhap claude.ai"

if [ -n "${ANTHROPIC_BASE_URL:-}" ]; then
  case "$ANTHROPIC_BASE_URL" in
    *api.anthropic.com*) ok_ "ANTHROPIC_BASE_URL tro ve api.anthropic.com" "$ANTHROPIC_BASE_URL" ;;
    *) block_ "ANTHROPIC_BASE_URL tro ra ngoai api.anthropic.com" "$ANTHROPIC_BASE_URL" ;;
  esac
else
  ok_ "ANTHROPIC_BASE_URL khong dat (dung mac dinh api.anthropic.com)"
fi

FOUND_PROVIDER=0
for name in CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY; do
  if [ -n "${!name:-}" ]; then
    FOUND_PROVIDER=1
    block_ "$name dang duoc dat" "Remote Control va cloud session khong ho tro provider ben thu ba"
  fi
done
[ "$FOUND_PROVIDER" -eq 0 ] && ok_ "Khong dung provider ben thu ba"

# ------------------------------------------------------ 3. Co feature flag ---
head_ "3. Co feature-flag"

FOUND_FLAG=0
for name in CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC DISABLE_GROWTHBOOK; do
  if [ -n "${!name:-}" ]; then
    FOUND_FLAG=1
    block_ "$name dang duoc dat" "Remote Control khong kha dung. Go bien nay."
  fi
done
for name in DISABLE_TELEMETRY DO_NOT_TRACK; do
  if [ -n "${!name:-}" ]; then
    FOUND_FLAG=1
    warn_ "$name dang duoc dat" "Van dung duoc RC tu v2.1.283. Phai go neu to chuc yeu cau Trusted Devices."
  fi
done
[ "$FOUND_FLAG" -eq 0 ] && ok_ "Khong co co nao chan feature-flag evaluation"

# -------------------------------------------------------- 4. File settings ---
head_ "4. File settings"

SEEN=""
for f in "$HOME/.claude/settings.json" "$PROJECT_PATH/.claude/settings.json" "$PROJECT_PATH/.claude/settings.local.json"; do
  [ -f "$f" ] || continue
  case "$SEEN" in *"|$f|"*) continue ;; esac
  SEEN="$SEEN|$f|"

  hit=0
  if grep -Eq '"disableRemoteControl"[[:space:]]*:[[:space:]]*true' "$f"; then
    block_ "disableRemoteControl = true trong $f" "Remote Control bi tat o file nay"; hit=1
  fi
  if grep -Eq '"apiKeyHelper"[[:space:]]*:' "$f"; then
    block_ "apiKeyHelper duoc dat trong $f" "Setting nay chiem quyen dang nhap claude.ai"; hit=1
  fi
  for name in ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC DISABLE_GROWTHBOOK; do
    if grep -Eq "\"$name\"[[:space:]]*:" "$f"; then
      block_ "$name duoc dat trong $f" "Bien trong settings cung chan Remote Control nhu bien shell"; hit=1
    fi
  done
  [ "$hit" -eq 0 ] && ok_ "$f" "khong co setting nao anh huong Remote Control"
done

# ----------------------------------------------------------- 5. Workspace ---
head_ "5. Workspace"

if [ -d "$PROJECT_PATH/.git" ]; then
  ok_ "Thu muc nay la git repo" "dung duoc 'claude remote-control --spawn worktree'"
else
  warn_ "Thu muc nay khong phai git repo" "--spawn worktree se khong dung duoc"
fi

if [ "$PROJECT_PATH" = "$HOME" ]; then
  warn_ "Ban dang o thu muc home" "Workspace trust khong bao gio luu cho home. Chay RC tu thu muc du an."
fi

if command -v tmux >/dev/null 2>&1; then
  ok_ "Co tmux" "bat buoc neu chay qua SSH - xem start-remote-control.sh"
else
  warn_ "Khong co tmux" "Chay qua SSH ma khong co tmux thi thoat SSH la session chet"
fi

# ------------------------------------------------------------------ ket luan -
printf '\n%s-------------------------------------------------------------%s\n' "$C_DIM" "$C_OFF"
if [ "$BLOCKERS" -gt 0 ]; then
  printf '%sKet qua: %d van de chan, %d canh bao%s\n' "$C_RED" "$BLOCKERS" "$WARNINGS" "$C_OFF"
  printf '%sXu ly cac dong [STOP] truoc, chi tiet xem TROUBLESHOOTING.md%s\n' "$C_RED" "$C_OFF"
  exit 1
fi

printf '%sKet qua: khong co van de chan, %d canh bao%s\n\n' "$C_GRN" "$WARNINGS" "$C_OFF"
printf 'Buoc tiep theo:\n'
printf '%s  1. claude              # mot lan de bam dong y workspace trust\n' "$C_DIM"
printf '  2. claude auth login   # neu chua dang nhap bang tai khoan claude.ai\n'
printf '  3. claude remote-control --name "%s"%s\n\n' "$(basename "$PROJECT_PATH")" "$C_OFF"
exit 0
