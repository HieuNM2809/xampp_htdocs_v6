#!/usr/bin/env bash
# Khoi dong Claude Code Remote Control o server mode, boc san tmux de session
# song sot sau khi ban thoat SSH.
#
#   bash start-remote-control.sh -n "Hasaki API" -s worktree -c 4
#
# Moi co deu duoc dat SAU chu 'remote-control' - dat truoc se khong duoc truyen
# xuong cac session ma server tao ra.
set -euo pipefail

NAME=""
SPAWN="same-dir"
CAPACITY=""
PERMISSION_MODE=""
TMUX_SESSION="claude-rc"
PROJECT_PATH="$PWD"
DRY_RUN=0
NO_TMUX=0

usage() {
  cat <<'EOF'
Cach dung: start-remote-control.sh [tuy chon]

  -n, --name <ten>              Tieu de session hien o claude.ai/code
                                (mac dinh: ten thu muc)
  -s, --spawn <mode>            same-dir (mac dinh) | worktree | session
  -c, --capacity <N>            So session dong thoi toi da (khong dung voi
                                --spawn session)
  -p, --permission-mode <mode>  default | acceptEdits | auto | dontAsk | plan |
                                bypassPermissions
  -d, --dir <duong-dan>         Thu muc du an (mac dinh: thu muc hien tai)
  -t, --tmux-session <ten>      Ten tmux session (mac dinh: claude-rc)
      --no-tmux                 Chay truc tiep, khong boc tmux
      --dry-run                 Chi in lenh se chay
  -h, --help                    Hien tro giup nay

Vi du:
  start-remote-control.sh -n "Hasaki API" -s worktree -c 4 -p acceptEdits
  start-remote-control.sh --no-tmux --dry-run
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    -n|--name)            NAME="${2:?thieu gia tri cho $1}"; shift 2 ;;
    -s|--spawn)           SPAWN="${2:?thieu gia tri cho $1}"; shift 2 ;;
    -c|--capacity)        CAPACITY="${2:?thieu gia tri cho $1}"; shift 2 ;;
    -p|--permission-mode) PERMISSION_MODE="${2:?thieu gia tri cho $1}"; shift 2 ;;
    -d|--dir)             PROJECT_PATH="${2:?thieu gia tri cho $1}"; shift 2 ;;
    -t|--tmux-session)    TMUX_SESSION="${2:?thieu gia tri cho $1}"; shift 2 ;;
    --no-tmux)            NO_TMUX=1; shift ;;
    --dry-run)            DRY_RUN=1; shift ;;
    -h|--help)            usage; exit 0 ;;
    *) printf 'Tham so khong hieu: %s\n\n' "$1" >&2; usage >&2; exit 2 ;;
  esac
done

# ------------------------------------------------------------- kiem tra -----
command -v claude >/dev/null 2>&1 || {
  echo "Khong tim thay lenh 'claude' trong PATH." >&2; exit 1; }

[ -d "$PROJECT_PATH" ] || {
  echo "Thu muc khong ton tai: $PROJECT_PATH" >&2; exit 1; }

PROJECT_PATH="$(cd "$PROJECT_PATH" && pwd)"

case "$SPAWN" in
  same-dir|worktree|session) ;;
  *) echo "--spawn phai la same-dir, worktree hoac session (nhan duoc: $SPAWN)" >&2; exit 2 ;;
esac

if [ "$SPAWN" = "worktree" ] && [ ! -d "$PROJECT_PATH/.git" ]; then
  echo "--spawn worktree can mot git repo, nhung $PROJECT_PATH khong phai." >&2
  exit 1
fi

if [ -n "$CAPACITY" ] && [ "$SPAWN" = "session" ]; then
  echo "--capacity khong dung chung duoc voi --spawn session." >&2
  exit 2
fi

[ -n "$NAME" ] || NAME="$(basename "$PROJECT_PATH")"

# --------------------------------------------------------------- chay -------
ARGS=(remote-control --name "$NAME" --spawn "$SPAWN")
[ -n "$CAPACITY" ]        && ARGS+=(--capacity "$CAPACITY")
[ -n "$PERMISSION_MODE" ] && ARGS+=(--permission-mode "$PERMISSION_MODE")

CMD="$(printf '%q ' claude "${ARGS[@]}")"

printf '\nThu muc : %s\n' "$PROJECT_PATH"
printf 'Lenh    : %s\n' "$CMD"

USE_TMUX=0
if [ "$NO_TMUX" -eq 0 ] && command -v tmux >/dev/null 2>&1 && [ -z "${TMUX:-}" ]; then
  USE_TMUX=1
  printf 'tmux    : session "%s"\n' "$TMUX_SESSION"
else
  printf 'tmux    : khong dung'
  [ -n "${TMUX:-}" ] && printf ' (ban da o trong tmux roi)'
  printf '\n'
fi

printf '\nTrong luc chay: [space] QR code | [w] doi same-dir/worktree | [Ctrl+C] dung\n'
[ "$USE_TMUX" -eq 1 ] && printf 'Detach: Ctrl+B roi D. Quay lai: tmux attach -t %s\n' "$TMUX_SESSION"
printf 'Dung roi van lay lai session duoc trong ~4 gio: claude remote-control --continue\n\n'

if [ "$DRY_RUN" -eq 1 ]; then
  echo "(--dry-run: khong chay that)"
  exit 0
fi

if [ "$USE_TMUX" -eq 1 ]; then
  if tmux has-session -t "$TMUX_SESSION" 2>/dev/null; then
    echo "tmux session \"$TMUX_SESSION\" da ton tai - attach vao session do."
    exec tmux attach -t "$TMUX_SESSION"
  fi
  tmux new-session -d -s "$TMUX_SESSION" -c "$PROJECT_PATH" "$CMD"
  exec tmux attach -t "$TMUX_SESSION"
fi

cd "$PROJECT_PATH"
exec claude "${ARGS[@]}"
