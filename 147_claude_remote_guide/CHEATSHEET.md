# Cheat sheet — Claude Code Remote

Tra cứu nhanh. Giải thích chi tiết nằm ở [`README.md`](README.md).
Kiểm chứng trên Claude Code **v2.1.283**.

---

## Ba lệnh dễ nhầm nhất

| Lệnh | Claude chạy ở đâu | Làm gì |
| --- | --- | --- |
| `claude --remote-control` | **Máy bạn** | Lái session local từ điện thoại/web |
| `claude --cloud "task"` | **Cloud** | Tạo session cloud mới từ GitHub remote |
| `claude --teleport` | **Máy bạn** | Kéo session cloud về terminal |

---

## Remote Control

### Khởi động

```bash
claude --remote-control                 # session tương tác có bật RC (viết tắt --rc)
claude --remote-control "Tên session"   # kèm tên
claude remote-control                   # server mode: nhiều session, phím cách = QR
```

```text
/remote-control            # bật cho session đang chạy (viết tắt /rc)
/remote-control Tên        # kèm tên
/remote-control            # gõ lần nữa: mở bảng trạng thái + nút disconnect
```

### Cờ của server mode (đặt SAU chữ `remote-control`)

```bash
claude remote-control --name "Hasaki API" --spawn worktree --capacity 4 --permission-mode acceptEdits
```

| Cờ | Giá trị |
| --- | --- |
| `--name <tên>` | Tiêu đề hiện ở claude.ai/code |
| `--spawn <mode>` | `same-dir` (mặc định) \| `worktree` \| `session` |
| `--capacity <N>` | Số session đồng thời, mặc định `32` |
| `--permission-mode <mode>` | Mode khởi điểm cho session server tạo ra |
| `--remote-control-session-name-prefix <p>` | Prefix tên tự sinh, mặc định hostname |
| `--no-create-session-in-dir` | Không tạo sẵn session lúc khởi động |
| `--[no-]chrome` | Claude in Chrome cho session sinh ra |
| `--verbose` / `--debug=api,hooks` / `--debug-file <path>` | Log chi tiết |
| `--sandbox` / `--no-sandbox` | Sandbox filesystem + network (mặc định tắt) |

| Phím lúc đang chạy | Tác dụng |
| --- | --- |
| `space` | Hiện/ẩn QR code |
| `w` | Chuyển qua lại `same-dir` ⇄ `worktree` |
| `Ctrl+C` | Dừng server (session giữ lại ~4 giờ) |

### Tắt rồi bật lại

```bash
# server mode: trong ~4 giờ, phải ở ĐÚNG thư mục cũ
claude remote-control                     # tất cả session server đang phục vụ
claude remote-control --continue          # chỉ session khởi đầu
claude remote-control --session-id <id>   # đúng một session

# session tương tác (--remote-control / /remote-control)
claude --continue                         # tự nối lại RC ghi trong hội thoại
claude --resume                           # chọn hội thoại rồi nối lại
claude --resume --fork-session            # resume nhưng tạo session ID mới
```

| Tắt kiểu | Bật lại kiểu |
| --- | --- |
| `Ctrl+C` ở server mode | `claude remote-control` (cùng thư mục, ~4 giờ) |
| Đóng terminal tương tác | `claude --continue` / `claude --resume` |
| Nút disconnect của `/remote-control` | `/remote-control` (session local chưa hề tắt) |
| Thoát Desktop / VS Code | Mở lại hội thoại, tự gắn vào session claude.ai cũ |
| Archive từ điện thoại | `/remote-control` (mở lại cả bản đã archive) |

**Bao lâu thì phải tạo mới**: `~4 giờ` chỉ áp dụng cho **server mode**. Session
tương tác (`--remote-control` / `/remote-control`) **không có hạn giờ nào trong
docs** — cứ `claude --continue` / `--resume`. Nút disconnect cũng không có hạn.

Không lấy lại được khi: quá 4 giờ · sai thư mục · ở giữa đã chạy
`claude remote-control` khác trong cùng thư mục · đã khởi động server với
`--no-create-session-in-dir`.

| Mốc dễ nhầm với 4 giờ | Là gì | Sau đó |
| --- | --- | --- |
| ~10 phút | Server mode mất mạng, tiến trình thoát | Chạy lại = **session mới** |
| ~30 phút | Mất heartbeat ở session tương tác | `/remote-control` để **nối lại** |
| 5 phút | `dialogExpiry` của hộp thoại chuyển tiếp | Hộp thoại đóng, đi theo mặc định |
| 18 giờ | Tuổi đăng nhập trong Trusted Devices | Face ID / Windows Hello / passkey |

Bật lại **không** khôi phục: subagent, workflow, lệnh shell đang chạy dở.
Session bị archive âm thầm nếu nối lại sau khi compaction viết lại hội thoại
hoặc sau khi bạn `/resume` sang hội thoại khác — tìm bằng bộ lọc **archived**.

Sau `Previous session is unavailable`: **khởi động lại Claude Code trước**, gõ
`/remote-control` ngay thì tin nhắn cũ không được đưa vào session mới.

### Lệnh liên quan

```text
/mobile          # QR tải app Claude
/rename <tên>    # đổi tên session (đổi cả ở claude.ai)
/config          # bật auto-connect, push notification, crossSessionInbound
/status          # xem plan, tổ chức, Peer address
claude doctor    # chẩn đoán vì sao RC không bật được
```

---

## Cloud session

```bash
claude --cloud "mô tả task"                     # tạo session cloud mới
claude --cloud "task" --environment ccpool_xxx  # chạy trên self-hosted environment
CCR_FORCE_BUNDLE=1 claude --cloud "task"        # ép upload repo local thay vì clone

claude -p "tin nhắn" --cloud <session-id>       # nhắn tiếp vào session cloud rồi thoát
echo "tin nhắn" | claude -p --cloud <session-id>
claude -p "..." --cloud <id> --output-format json   # {ok, session_id, url}

claude --teleport                # picker chọn session cloud
claude --teleport <session-id>   # vào thẳng
```

```text
/teleport   (/tp)    # kéo session cloud về, ngay trong session đang chạy
/tasks               # danh sách session nền, bấm `t` để teleport
/web-setup           # gửi token gh CLI lên tài khoản Claude (thay cho GitHub App)
/autofix-pr          # bật auto-fix cho PR của branch hiện tại
```

**Nhớ**: cloud clone từ **GitHub remote tại branch hiện tại**, không phải working
directory của bạn → `git push` trước khi chạy `--cloud`.

---

## Nhắn tin giữa các session

```text
/list-agents    (/peers)        # xem những session với tới được
Nhắn @api-worker là ...         # @ + vài chữ đầu để chọn từ gợi ý
```

Session ở **máy khác hoặc trên cloud** chỉ xuất hiện khi session hiện tại **đang
kết nối Remote Control**.

---

## Channels (research preview)

```text
/plugin install telegram@claude-plugins-official
/telegram:configure <token>
/telegram:access pair <code>
/telegram:access policy allowlist      # ĐỪNG BỎ BƯỚC NÀY
```

```bash
claude --channels plugin:telegram@claude-plugins-official
claude --channels plugin:fakechat@claude-plugins-official   # demo ở localhost:8787
```

Cờ `--channels` không hiện trong `claude --help` khi còn ở preview.

---

## Settings

| Key | Giá trị | Tác dụng |
| --- | --- | --- |
| `remoteControlAtStartup` | `true` / `false` / `default` | Tự bật RC cho mọi session tương tác. Project/local settings chỉ nhận `false`, bỏ qua `true` |
| `disableRemoteControl` | `true` | Tắt hẳn RC ở mức thiết bị (dùng trong managed settings) |
| `dialogExpiry` | số giây / `"never"` | Hạn chờ cho hộp thoại chuyển tiếp ra thiết bị (mặc định 5 phút) |
| `crossSessionInbound` | `accept` / `hold` / `refuse` | Xử lý tin nhắn đến từ session khác |
| `isolatePeerMachines` | `true` | Bắt duyệt tay trước khi tin nhắn rời khỏi máy này |
| `permissions.deny` | `["SendMessage","ListAgents"]` | Chặn chiều gửi và liệt kê session |

Thứ tự file: `managed settings` > `.claude/settings.local.json` >
`.claude/settings.json` > `~/.claude/settings.json` (có ngoại lệ, xem README §8).

---

## Biến môi trường

| Biến | Tác dụng |
| --- | --- |
| `CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX` | Prefix cho tên session tự sinh |
| `CLAUDE_CLIENT_PRESENCE_FILE` | Còn file thì **không** gửi push notification |
| `CLAUDE_CODE_MESSAGING_SOCKET` | Đường dẫn inbox socket của session (hook/script đọc được) |
| `CLAUDE_CODE_MESSAGING_TOKEN` | Token auth khi post vào socket (**bắt buộc trên Windows native**) |
| `CLAUDE_CODE_EFFORT_LEVEL` | Ghim mức effort, thiết bị từ xa không đổi được |

Các biến **làm hỏng** Remote Control: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`,
`CLAUDE_CODE_OAUTH_TOKEN`, `ANTHROPIC_BASE_URL` (trỏ ra ngoài api.anthropic.com),
`CLAUDE_CODE_USE_BEDROCK`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`,
`DISABLE_GROWTHBOOK`.

---

## Permission mode

`default` (bí danh `manual`) · `acceptEdits` · `auto` · `dontAsk` · `plan` ·
`bypassPermissions`

```bash
claude remote-control --permission-mode acceptEdits
claude --permission-mode plan          # bàn phương án trước khi đẩy lên cloud
```

Permission prompt và `AskUserQuestion` **giữ mở đến khi bạn trả lời**. Hộp thoại
loại khác chờ `dialogExpiry` (mặc định 5 phút) rồi đi theo mặc định.

---

## Lệnh gõ được từ điện thoại / web

**Được**: `/compact` `/clear` `/context` `/usage` `/exit` `/recap`
`/reload-plugins` `/usage-credits` · `/model sonnet` `/effort high` `/fast`
`/color` `/rename` · `/mcp [reconnect|enable|disable]` · `/config key=value` ·
`/autocompact 500k` `/advisor opus` `/output-style concise` `/focus on`

**Không được**: `/plugin`, `/resume` và các lệnh chỉ sống trong giao diện terminal.

---

## Yêu cầu phiên bản

| Tính năng | Bản tối thiểu |
| --- | --- |
| Cross-session messaging (macOS/Linux/WSL2) | v2.1.224 |
| `dialogExpiry` | v2.1.224 |
| `--continue` / `--session-id` của server mode | v2.1.200 |
| Unarchive bằng `--continue` / `--session-id` | v2.1.228 |
| `@mention` session trong prompt | v2.1.232 |
| Cross-session messaging (Windows native) | v2.1.234 |
| Chọn model / effort từ thiết bị | v2.1.238 |
| Phục vụ lại session crash trong server mode | v2.1.238 |
| `--debug` cho `claude remote-control` | v2.1.282 |
| RC khi bật `DISABLE_TELEMETRY` / `DO_NOT_TRACK` | v2.1.283 |

```bash
claude --version
claude update
```
