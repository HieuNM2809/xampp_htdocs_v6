# Claude Code Remote — từ cơ bản đến nâng cao

Hướng dẫn dùng **Claude Code từ xa**: đang code dở trên máy công ty, ra khỏi bàn
làm việc, mở điện thoại lên và tiếp tục đúng phiên đó — hoặc giao hẳn task cho
một máy ảo trên cloud chạy trong lúc bạn đóng laptop.

Tài liệu này viết theo docs chính thức tại [code.claude.com/docs](https://code.claude.com/docs)
và được kiểm chứng trên **Claude Code v2.1.283 / Windows 11**. Mọi lệnh trong
bài đều lấy từ `claude --help` và `claude remote-control --help` của bản này.

```
                    ┌──────────────────────────────┐
   điện thoại ─┐    │  Anthropic API (HTTPS/TLS)   │
   trình duyệt ─┼──►│  chỉ làm đường ống trung gian │◄─── máy của bạn
   Claude app ─┘    └──────────────────────────────┘      (claude vẫn chạy ở đây)
                                                           file + terminal + MCP
```

---

## Mục lục

1. [Bản đồ: 6 cách dùng Claude khi không ngồi trước terminal](#1-bản-đồ-6-cách-dùng-claude-khi-không-ngồi-trước-terminal)
2. [Remote Control vs Cloud session — chọn cái nào](#2-remote-control-vs-cloud-session--chọn-cái-nào)
3. [Điều kiện bắt buộc và cách tự kiểm tra](#3-điều-kiện-bắt-buộc-và-cách-tự-kiểm-tra)
4. [Cơ bản: bật Remote Control trong 3 phút](#4-cơ-bản-bật-remote-control-trong-3-phút)
5. [Kết nối từ điện thoại và trình duyệt](#5-kết-nối-từ-điện-thoại-và-trình-duyệt)
6. [Thông báo đẩy và quyền khi bạn không ở bàn](#6-thông-báo-đẩy-và-quyền-khi-bạn-không-ở-bàn)
7. [Thiết bị từ xa thấy gì, gõ được lệnh gì](#7-thiết-bị-từ-xa-thấy-gì-gõ-được-lệnh-gì)
8. [Bật mặc định cho mọi session](#8-bật-mặc-định-cho-mọi-session)
9. [Server mode: nhiều session song song](#9-server-mode-nhiều-session-song-song)
10. [Vòng đời session: giữ sống, tắt, bật lại](#10-vòng-đời-session-giữ-sống-tắt-bật-lại)
11. [Nâng cao — Cloud session: `--cloud` và `--teleport`](#11-nâng-cao--cloud-session---cloud-và---teleport)
12. [Nâng cao — Nhắn tin giữa các session](#12-nâng-cao--nhắn-tin-giữa-các-session)
13. [Nâng cao — Channels: đẩy Telegram/Discord/CI vào session](#13-nâng-cao--channels-đẩy-telegramdiscordci-vào-session)
14. [Bảo mật: đường truyền, dữ liệu, Trusted Devices, cách tắt hẳn](#14-bảo-mật-đường-truyền-dữ-liệu-trusted-devices-cách-tắt-hẳn)
15. [Bốn kịch bản thực tế](#15-bốn-kịch-bản-thực-tế)
16. [Nội dung thư mục này](#16-nội-dung-thư-mục-này)

Tra cứu nhanh: [`CHEATSHEET.md`](CHEATSHEET.md) · Gặp lỗi: [`TROUBLESHOOTING.md`](TROUBLESHOOTING.md)

---

## 1. Bản đồ: 6 cách dùng Claude khi không ngồi trước terminal

Trước khi làm gì, phải biết mình đang cần cái nào. Sáu tính năng dưới đây khác
nhau ở **ai kích hoạt công việc** và **Claude chạy ở đâu**:

| Cách | Kích hoạt bằng | Claude chạy trên | Cần chuẩn bị | Hợp với |
| --- | --- | --- | --- | --- |
| **Remote Control** | Điều khiển session đang chạy từ claude.ai/code hoặc app | **Máy của bạn** | `claude remote-control` hoặc `/remote-control` | Lái tiếp việc đang làm dở từ thiết bị khác |
| **Cloud session** | Tạo task mới ở web/app/CLI | Hạ tầng cloud của Anthropic | Kết nối GitHub | Giao việc độc lập, chạy song song nhiều task |
| **Dispatch** | Nhắn task từ app điện thoại | **Máy của bạn** (qua Claude Desktop) | Ghép cặp app với Desktop | Giao việc khi đang đi, setup tối thiểu |
| **Channels** | Sự kiện đẩy vào từ Telegram/Discord/webhook | **Máy của bạn** (CLI) | Cài plugin channel | Phản ứng với CI fail, tin nhắn chat |
| **Slack** | Mention `@Claude` trong channel | Cloud của Anthropic | Cài Slack app | Tạo PR / review ngay trong chat nhóm |
| **Scheduled tasks / Routines** | Lịch định kỳ | CLI, Desktop hoặc cloud | Chọn tần suất | Việc lặp lại như review hằng ngày |

Bài này tập trung vào hai cột đầu — **Remote Control** (phần 4–10) và
**Cloud session** (phần 11) — vì đó là hai thứ dùng hằng ngày. Channels và
cross-session messaging nằm ở phần 12–13.

> Ba tên gọi rất dễ nhầm, nhớ kỹ ngay từ đầu:
> `--remote-control` = lái session **local**. `--cloud` = tạo session **cloud**.
> `--teleport` = kéo session cloud **về terminal**. Chúng không thay thế nhau.

---

## 2. Remote Control vs Cloud session — chọn cái nào

Cả hai đều mở ở cùng một giao diện `claude.ai/code`, nên nhìn ngoài rất giống
nhau. Khác biệt duy nhất mà cũng là khác biệt quyết định: **code chạy ở đâu**.

|  | Remote Control | Cloud session |
| --- | --- | --- |
| Nơi thực thi lệnh | Máy bạn | VM do Anthropic quản lý (hoặc self-hosted) |
| Truy cập file | Filesystem thật của bạn, kể cả file chưa commit | Bản clone từ GitHub theo branch hiện tại |
| MCP server, plugin, `.env` local | Dùng được hết | Chỉ những gì cấu hình trong cloud environment |
| Máy tắt / laptop gập lại | Session offline | Vẫn chạy tiếp |
| Chạy song song nhiều task | Cần server mode | Tự nhiên, mỗi `--cloud` một session |
| Repo chưa clone về máy | Không làm được | Làm được |

Quy tắc chọn:

- Đang dở việc trên máy, cần đi đâu đó mà vẫn muốn theo dõi → **Remote Control**.
- Muốn quăng một task tự chạy rồi quên nó đi, hoặc cần chạy 4 task cùng lúc →
  **Cloud session**.
- Cần cả hai: teleport session cloud về máy, rồi bật `/remote-control` trên
  session local đó (phần 11.4).

---

## 3. Điều kiện bắt buộc và cách tự kiểm tra

Remote Control **không phải** tính năng bật là chạy trong mọi cấu hình. Danh
sách điều kiện, kèm cách phát hiện sớm:

| Điều kiện | Chi tiết |
| --- | --- |
| **Gói cước** | Pro, Max, Team, Enterprise. **API key không dùng được.** Team/Enterprise cần Owner bật toggle trong [admin settings](https://claude.ai/admin-settings/claude-code) |
| **Đăng nhập** | Phải là claude.ai session token: `claude auth login` → chọn claude.ai. Token dài hạn từ `claude setup-token` hoặc `CLAUDE_CODE_OAUTH_TOKEN` **không đủ** (nó chỉ gọi được model) |
| **Endpoint** | Chỉ chạy qua `api.anthropic.com`. Không hỗ trợ Bedrock, Google Cloud Agent Platform, Microsoft Foundry, hoặc `ANTHROPIC_BASE_URL` trỏ sang LLM gateway/proxy |
| **Feature flag** | `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC` hoặc `DISABLE_GROWTHBOOK` bật → Remote Control không khả dụng. `DISABLE_TELEMETRY` / `DO_NOT_TRACK` thì vẫn dùng được, nhưng cần **v2.1.283 trở lên** |
| **Workspace trust** | Phải chạy `claude` trong thư mục dự án ít nhất một lần để bấm đồng ý hộp thoại tin cậy. Hộp thoại lúc khởi động **không bao giờ** lưu trust cho thư mục home → luôn bật Remote Control từ thư mục dự án |
| **Chính sách tổ chức** | Managed settings có `disableRemoteControl` sẽ chặn ở mức thiết bị |

Chạy script kiểm tra sẵn có trong thư mục này trước khi bật lần đầu:

```powershell
# Windows
powershell -ExecutionPolicy Bypass -File .\scripts\check-remote-ready.ps1
```

```bash
# macOS / Linux / WSL
bash ./scripts/check-remote-ready.sh
```

Script soi đúng những thứ hay làm hỏng Remote Control: biến môi trường auth, base
URL, provider bên thứ ba, cờ telemetry, phiên bản CLI. Nếu vẫn lỗi, `claude doctor`
sẽ chỉ ra **đúng** bước kiểm tra nào trượt (dòng `Organization policy` rất đáng đọc).

---

## 4. Cơ bản: bật Remote Control trong 3 phút

Có ba cách khởi động, khác nhau ở việc bạn còn gõ ở terminal nữa hay không.

### 4.1. Cách 1 — Bật cho session đang chạy (dùng nhiều nhất)

Đang làm việc bình thường trong `claude`, gõ:

```text
/remote-control
```

Viết tắt: `/rc`. Lần đầu tiên sẽ có hộp thoại xác nhận — chọn **Enable Remote
Control**. Toàn bộ lịch sử hội thoại hiện tại được mang theo, nên bạn không mất
ngữ cảnh. Đặt tên luôn cho dễ tìm trong danh sách session:

```text
/remote-control hasaki-checkout-bug
```

Muốn ngắt kết nối: gõ `/remote-control` lần nữa để mở bảng trạng thái, trong đó
có nút disconnect. Session local vẫn chạy bình thường sau khi ngắt.

### 4.2. Cách 2 — Khởi động session mới đã bật sẵn

```bash
claude --remote-control
claude --remote-control "hasaki-checkout-bug"   # kèm tên
```

Viết tắt: `--rc`. Bạn vẫn gõ được ở terminal, đồng thời điều khiển được từ xa.

### 4.3. Cách 3 — Server mode (không gõ ở terminal)

```bash
claude remote-control
```

Tiến trình chạy trong terminal ở chế độ **server**, chờ kết nối từ xa. Nó in ra
URL session, và **bấm phím cách để hiện QR code** quét bằng điện thoại. Terminal
lúc này chỉ hiển thị trạng thái kết nối và hoạt động tool — bạn không gõ chat
vào đó. Đây là chế độ mạnh nhất, xem kỹ ở [phần 9](#9-server-mode-nhiều-session-song-song).

### 4.4. Từ Desktop app và VS Code

| Nơi | Cách làm |
| --- | --- |
| **Claude Desktop** | Tab Code → gõ `/remote-control` hoặc `/rc` trong ô prompt |
| **VS Code extension** | Gõ `/remote-control` trong ô prompt. Footer hiện chỉ báo **Remote Control**, bấm vào để nhảy thẳng tới session |

VS Code và Desktop **không nhận tham số tên** và không hiện QR code; tên session
lấy từ nội dung hội thoại.

### 4.5. Kiểm tra đã kết nối chưa

Trong session tương tác, khi Remote Control đang chạy, terminal hiện chỉ báo
`/rc active` có link tới session trên claude.ai. Terminal quá hẹp thì chỉ báo bị
ẩn — gõ `/remote-control` để mở bảng trạng thái xem URL + QR.

Nếu chỉ báo đổi sang trạng thái lỗi, đọc lý do rồi xử theo bảng này:

| Lý do hiển thị | Nghĩa là | Nên làm |
| --- | --- | --- |
| *Another connection took over this session* | Thiết bị/session khác đã chiếm | Chỉ chạy `/remote-control` nếu muốn giành lại |
| *This session was ended or archived from another device* | Bị kết thúc/lưu trữ từ nơi khác | `/remote-control` sẽ mở lại session đã lưu trữ |
| *The server no longer reports this session* | Có thể đã bị xoá | Tạo session mới |

---

## 5. Kết nối từ điện thoại và trình duyệt

Khi session đã online, có ba đường vào:

1. **Mở URL session** in ra ở terminal bằng bất kỳ trình duyệt nào.
2. **Quét QR code** để mở thẳng trong app Claude. Ở server mode bấm phím cách để
   hiện/ẩn QR.
3. **Mở [claude.ai/code](https://claude.ai/code) hoặc app Claude** rồi tìm theo
   tên trong danh sách session. Trên app điện thoại, bấm tab **Code**. Session
   Remote Control có **biểu tượng máy tính kèm chấm xanh** khi đang online.

Chưa cài app? Gõ `/mobile` trong Claude Code để hiện QR dẫn tới đúng store.

### Tên session được chọn theo thứ tự nào

Biết thứ tự này để khỏi lạc trong danh sách 20 session:

1. Tên bạn truyền vào `--name`, `--remote-control`, hoặc `/remote-control`
2. Tên đặt bằng `/rename`
3. Tin nhắn có ý nghĩa gần nhất trong lịch sử hội thoại
4. Tên tự sinh kiểu `myhost-graceful-unicorn` (`myhost` = hostname máy bạn)

Đổi prefix của tên tự sinh:

```bash
claude remote-control --remote-control-session-name-prefix hasaki-dev01
# hoặc đặt biến môi trường CLAUDE_REMOTE_CONTROL_SESSION_NAME_PREFIX
```

Đổi tên session từ app/web thì tên local trong `claude --resume` cũng đổi theo.

### Những thứ làm được từ điện thoại mà terminal không có

- **Gửi ảnh và file**: đính ảnh chụp màn hình lỗi ngay trong app. Claude nhìn
  thấy ảnh trực tiếp; file khác thì Claude Code **tải về máy bạn** rồi truyền vào
  dưới dạng tham chiếu `@file`.
- **Xem diff**: nếu thư mục session nằm trong git repo, pane diff hiện thay đổi
  của bạn. Trên branch có commit đi trước default branch, nó hiện thay đổi kể từ
  lúc tách nhánh, gồm cả sửa đổi chưa commit. Trên chính default branch thì chỉ
  hiện phần chưa commit.
- **Theo dõi subagent và workflow** đang chạy nền, và dừng được chúng từ xa —
  dừng ở điện thoại thì tiến trình trên máy bạn cũng dừng theo.

---

## 6. Thông báo đẩy và quyền khi bạn không ở bàn

### 6.1. Bật push notification

1. Cài app Claude cho [iOS](https://apps.apple.com/us/app/claude-by-anthropic/id6473753684)
   hoặc [Android](https://play.google.com/store/apps/details?id=com.anthropic.claude).
2. Đăng nhập **cùng tài khoản và cùng tổ chức** với Claude Code ở terminal.
3. Cho phép thông báo ở mức hệ điều hành.
4. Trong terminal gõ `/config` rồi bật:
   - **Push when Claude decides** — Claude tự quyết định lúc nào đáng báo
   - **Push when actions required** — có prompt xin quyền hoặc câu hỏi cần trả lời

Ngoài hai công tắc này **không có cấu hình theo từng loại sự kiện**. Nhưng bạn
có thể yêu cầu trực tiếp trong prompt:

```text
chạy full test suite rồi báo tôi khi xong
```

### 6.2. Không nhận được thông báo

- `/config` hiện **No mobile registered** → mở app Claude trên điện thoại để nó
  refresh push token; cảnh báo tự mất ở lần kết nối Remote Control kế tiếp.
- **iOS**: Focus mode và notification summary có thể chặn/trì hoãn. Kiểm tra
  Settings → Notifications → Claude.
- **Android**: tối ưu pin quá tay làm chậm thông báo. Loại app Claude khỏi battery
  optimization.

### 6.3. Đừng để điện thoại rung khi bạn đang ngồi ngay đó

Claude Code tự bỏ qua push khi bạn **đang gõ hoặc đang focus vào terminal**. Muốn
mở rộng thành "im lặng suốt lúc tôi còn ở máy, kể cả khi đang ở cửa sổ khác", dùng
biến `CLAUDE_CLIENT_PRESENCE_FILE`: trỏ tới một file đánh dấu, **còn file thì còn
im lặng**.

Thư mục này có sẵn script theo dõi trạng thái khoá màn hình Windows:

```powershell
# Tạo file khi mở khoá máy, xoá file khi khoá màn hình
powershell -ExecutionPolicy Bypass -File .\scripts\presence-watch.ps1
```

Rồi đặt biến trong `~/.claude/settings.json` (xem [`examples/settings.user.json`](examples/settings.user.json)):

```json
{
  "env": {
    "CLAUDE_CLIENT_PRESENCE_FILE": "C:\\Users\\<ban>\\.claude\\presence.marker"
  }
}
```

### 6.4. Prompt xin quyền khi bạn ở xa

- **Permission prompt** và câu hỏi `AskUserQuestion`: giữ mở **vô thời hạn** cho
  tới khi bạn trả lời. Không sợ mất việc giữa chừng.
- **Các hộp thoại khác** được chuyển tiếp ra thiết bị: chờ mặc định **5 phút** rồi
  tự đóng và đi tiếp theo lựa chọn mặc định. Chỉnh bằng setting `dialogExpiry`
  (cần v2.1.224+), đặt `"never"` để không bao giờ hết hạn.
- Muốn đỡ bị hỏi khi đi xa, khởi động với permission mode nới hơn:

```bash
claude remote-control --permission-mode acceptEdits
```

Các giá trị hợp lệ: `acceptEdits`, `auto`, `bypassPermissions`, `default`
(`manual` là bí danh), `dontAsk`, `plan`. Cân nhắc kỹ `bypassPermissions` — nó bỏ
qua gần như mọi kiểm tra, chỉ nên dùng trong môi trường bạn tin tưởng.

---

## 7. Thiết bị từ xa thấy gì, gõ được lệnh gì

### 7.1. Những tình huống đặc biệt

| Việc xảy ra ở terminal | Thiết bị từ xa thấy gì |
| --- | --- |
| **Compaction / `/clear`** | Thấy tiến trình nén và điểm nén; `/clear` reset luôn ở thiết bị |
| **`/resume` sang hội thoại khác** | **Không** nhận tiêu đề và lịch sử cũ của hội thoại mới, nhưng tin nhắn mới hai chiều vẫn đi đúng hội thoại đang mở ở terminal |
| **`/teleport` kéo session cloud về** | Tương tự: không có lịch sử cũ, chỉ tin nhắn mới |
| **Đổi model** | Chọn model từ thiết bị thì session trên máy chạy model đó (cần v2.1.238+). Gửi `/model <tên>` vào session tương tác còn đặt luôn model mặc định cho session mới |
| **Đổi effort** | `/effort` hoặc thanh trượt ở thiết bị áp dụng cho session trên máy. Nếu đã ghim bằng `CLAUDE_CODE_EFFORT_LEVEL` thì session giữ mức đó và từ chối lựa chọn từ thiết bị |

### 7.2. Lệnh nào gõ được từ điện thoại/web

**Không dùng được từ xa**: các lệnh chỉ sống trong giao diện terminal như
`/plugin`, `/resume`.

**Dùng được**:

| Nhóm | Lệnh | Ghi chú |
| --- | --- | --- |
| In text | `/compact`, `/clear`, `/context`, `/usage`, `/exit`, `/usage-credits`, `/recap`, `/reload-plugins` | `/usage-credits` in URL billing thay vì mở trình duyệt |
| Cần truyền tham số | `/model sonnet`, `/effort high`, `/fast`, `/color`, `/rename` | Từ mobile/web phải truyền giá trị thay cho picker |
| MCP | `/mcp` | Mobile trả về tóm tắt text; web mở danh bạ connector. `reconnect`, `enable`, `disable` chạy được từ cả hai |
| Cấu hình | `/config key=value` (mobile) | Trên web `/config` mở trang settings và bỏ qua text phía sau |
| Khác | `/autocompact 500k` (v2.1.221+), `/advisor opus` (v2.1.260+), `/output-style concise` (v2.1.269+), `/focus on` (v2.1.281+) | Với `/output-style`, từ xa chỉ chọn được style dựng sẵn |

---

## 8. Bật mặc định cho mọi session

Mặc định Remote Control chỉ chạy khi bạn gọi tay. Muốn mọi session tương tác tự
kết nối:

```text
/config      # bật "Enable Remote Control for all sessions"
```

Công tắc có **ba giá trị**, và quy tắc ưu tiên hơi ngược đời nhưng rất hợp lý:

| Giá trị | Ý nghĩa |
| --- | --- |
| `true` | Tự kết nối khi session tương tác khởi động |
| `false` | Tắt tự kết nối. Lưu vào user settings, nên **managed settings `true` vẫn thắng** — nhưng `false` trong project/local settings thì **thắng cả managed `true`** |
| `default` | Xoá lựa chọn, theo mặc định tổ chức (nếu có) hoặc mặc định của Claude Code |

Đặt bằng file thay vì `/config` — key là `remoteControlAtStartup`:

```json
// ~/.claude/settings.json
{ "remoteControlAtStartup": true }
```

Điểm cần nhớ với repo dùng chung: trong `.claude/settings.json` hoặc
`.claude/settings.local.json`, Claude Code **tôn trọng `false`** nhưng **bỏ qua
`true`** — tức là một file commit lên repo **không thể** tự bật Remote Control cho
mọi người clone repo đó. Xem [`examples/settings.project.json`](examples/settings.project.json).

Auto-connect đăng nhập bằng **tài khoản claude.ai của chính bạn**, session chỉ
hiện trong app của bạn, không cấp quyền cho ai khác.

Lưu ý dung lượng: với setting này, **mỗi tiến trình Claude Code tương tác đăng ký
một remote session**. Chạy 5 cửa sổ là 5 session trong danh sách. Muốn nhiều
session từ **một** tiến trình → dùng server mode.

---

## 9. Server mode: nhiều session song song

```bash
claude remote-control
```

Đây là chế độ "máy trạm làm việc từ xa": một tiến trình phục vụ **nhiều session
đồng thời** trong cùng thư mục, mặc định tối đa **32**.

### 9.1. Toàn bộ cờ (lấy từ `claude remote-control --help` v2.1.283)

| Cờ | Tác dụng |
| --- | --- |
| `--name "Tên"` | Đặt tiêu đề session hiện ở claude.ai/code |
| `--remote-control-session-name-prefix <prefix>` | Prefix cho tên tự sinh (mặc định: hostname) |
| `-c`, `--continue` | Gọi lại session mà server trong thư mục này ghi nhận lần cuối. Lỗi nếu không có gì trong ~4 giờ qua |
| `--session-id <id>` | Gọi lại đúng một session theo ID |
| `--spawn <mode>` | `same-dir` (mặc định), `worktree`, `session` |
| `--capacity <N>` | Số session đồng thời tối đa (mặc định 32) |
| `--[no-]create-session-in-dir` | Tạo sẵn một session ở thư mục hiện tại lúc khởi động (mặc định bật) |
| `--permission-mode <mode>` | Permission mode khởi điểm cho các session server tạo ra |
| `--[no-]chrome` | Claude in Chrome cho session sinh ra (mặc định theo `/chrome` của máy) |
| `-d`, `--debug[=<filter>]` | Debug log, lọc theo category: `--debug=api,hooks` (cần v2.1.282+) |
| `--debug-file <path>` | Ghi debug log ra file |
| `-v`, `--verbose` | Log kết nối và session chi tiết |
| `--sandbox` / `--no-sandbox` | Bật/tắt sandbox filesystem + network (mặc định tắt) |

Các cờ này phải đặt **sau** chữ `remote-control`:

```bash
claude remote-control --name "Hasaki API" --spawn worktree --capacity 4
```

> **Bẫy hay gặp**: cờ global đặt **trước** `remote-control` (hoặc do wrapper script
> thêm vào) không được truyền xuống các session mà server tạo ra. Với cờ vô hại như
> `--verbose` hay `--model` thì Claude Code cho qua; với cờ khác như `--settings`,
> nó **từ chối khởi động** và nói rõ phải bỏ cờ nào.

### 9.2. Ba chế độ `--spawn`

| Mode | Hành vi | Khi nào dùng |
| --- | --- | --- |
| `same-dir` | Mọi session dùng chung thư mục hiện tại | Việc nhỏ, đọc code, hỏi đáp. **Cẩn thận: sửa cùng file sẽ đụng nhau** |
| `worktree` | Mỗi session on-demand có git worktree riêng | Nhiều task sửa code song song. Cần là git repo |
| `session` | Đúng một session, từ chối kết nối thêm | Giống chế độ cổ điển, thoát khi session kết thúc |

Đang chạy, bấm phím **`w`** để chuyển qua lại giữa `same-dir` và `worktree`.
`--spawn=session` chỉ đặt được lúc khởi động và không đi kèm `--capacity`.

### 9.3. Lấy lại session sau khi tắt server

Ctrl+C tắt server thì các session ngừng trả lời từ điện thoại, **nhưng không bị
lưu trữ** (trừ khi bạn khởi động với `--no-create-session-in-dir`). Trong vòng
**khoảng 4 giờ**, chạy lại trong cùng thư mục:

```bash
claude remote-control                      # gọi lại tất cả session server đang phục vụ
claude remote-control --continue           # chỉ session server khởi đầu, thoát khi session đó kết thúc
claude remote-control --session-id <id>    # đúng một session
```

`<id>` là phần giữa `/code/` và dấu `?` trong URL claude.ai/code. Quá 4 giờ thì
phải tạo session mới. `--continue` và `--session-id` còn **bỏ lưu trữ** (unarchive)
session nếu bạn đã archive nó, từ v2.1.228.

Với session mở bằng `claude --remote-control` hoặc `/remote-control` (không phải
server mode), cách lấy lại là `claude --continue` / `claude --resume` như bình thường.

> Mở lại hội thoại ở terminal thứ hai trong khi terminal đầu vẫn giữ Remote
> Control: Claude Code in `Remote Control not started here` và **không giành**
> session. Gõ `/remote-control` ở terminal thứ hai nếu muốn chuyển sang đó.

Điều kiện đầy đủ, thứ gì mất khi bật lại, và các bẫy hay dính: xem
[§10.4–10.7](#104-tắt-kiểu-nào-thì-bật-lại-kiểu-ấy).

### 9.4. Session bị crash trong server mode

Không cần restart server. Cứ nhắn cho session đó từ thiết bị đang kết nối, Claude
Code phục vụ lại nó (cần v2.1.238+).

---

## 10. Vòng đời session: giữ sống, tắt, bật lại

Remote Control **là tiến trình local**. Đóng terminal, thoát Desktop/VS Code, hay
tắt máy → session offline ngay. Đây là giới hạn kiến trúc, không phải bug.

Phần 10.1–10.3 nói về cách **giữ session sống**. Phần 10.4–10.7 nói về chuyện
xảy ra khi bạn **tắt rồi bật lại** — chỗ này nhiều bẫy nhất, đọc kỹ trước khi
tắt cái gì.

### 10.1. Trên máy remote qua SSH (Linux/macOS)

Bắt buộc bọc trong `tmux` hoặc `screen`, nếu không thoát SSH là chết session:

```bash
tmux new -s claude-rc
claude remote-control --name "prod-debug"
# Ctrl+B rồi D để detach, thoát SSH thoải mái
# quay lại: tmux attach -t claude-rc
```

Script [`scripts/start-remote-control.sh`](scripts/start-remote-control.sh) làm
sẵn việc này: tạo/attach tmux session theo tên, kiểm tra thư mục là git repo,
chạy `claude remote-control` với tham số truyền vào.

### 10.2. Trên Windows

Windows không có tmux. Ba lựa chọn theo thứ tự thực dụng:

1. **Một tab Windows Terminal riêng** chạy `claude remote-control`, đặt máy không
   sleep (Settings → Power → Screen and sleep → Never khi cắm điện). Đơn giản nhất,
   đủ dùng cho hầu hết trường hợp.
2. **WSL2 + tmux**: nếu dự án chạy được trong WSL, đây là cách bền nhất và dùng
   lại được script `.sh`. Nhớ rằng session trong WSL2 và session Windows native
   **không nhắn tin được cho nhau** (phần 12).
3. **Task Scheduler**: chạy lúc logon, "Run whether user is logged on or not" —
   chỉ hợp với máy để bàn cố định luôn cắm điện.

Script [`scripts/start-remote-control.ps1`](scripts/start-remote-control.ps1) gói
bước 1 lại: kiểm tra điều kiện, cảnh báo nếu máy đang cấu hình ngủ, rồi chạy lệnh
với tham số đầy đủ.

### 10.3. Khi mạng rớt

| Chế độ | Hành vi |
| --- | --- |
| **Server mode** | Bỏ cuộc sau **~10 phút** và tiến trình `claude remote-control` thoát. Chạy lại để tạo session mới |
| **Session tương tác** | Cứ làm việc local bình thường. Claude Code thử lại suốt thời gian mất mạng và **tự kết nối lại** khi mạng về |

Laptop sleep hoặc rớt wifi chốc lát thì Claude Code tự reconnect khi máy tỉnh.
Hai thông báo đáng nhớ: gặp HTTP 403 (hay xảy ra sau khi đổi VPN) nó thử lại
trong 3 phút rồi mới ngắt; mất heartbeat ~30 phút thì gõ `/remote-control` để nối lại.

### 10.4. Tắt kiểu nào thì bật lại kiểu ấy

Cách bật lại **phụ thuộc vào cách bạn đã tắt**. Tra bảng này trước khi gõ gì:

| Bạn tắt bằng cách | Chuyện gì xảy ra | Bật lại bằng |
| --- | --- | --- |
| `Ctrl+C` ở **server mode** | Session ngừng trả lời từ điện thoại nhưng **không bị archive** | `claude remote-control` trong **đúng thư mục cũ**, trong ~4 giờ (§9.3) |
| Đóng terminal có `claude --remote-control` | Session offline | `claude --continue` hoặc `claude --resume` — Claude Code tự nối lại đúng RC session ghi trong hội thoại đó |
| `/remote-control` → **nút disconnect** | Chỉ ngắt Remote Control, **session local vẫn chạy bình thường** | `/remote-control` |
| Thoát Claude Desktop / VS Code | Session offline | Mở lại hội thoại: Claude Code **gắn lại vào đúng session claude.ai cũ**, không đẻ thêm dòng mới trong danh sách |
| Kết thúc / archive từ điện thoại | Session rời khỏi danh sách | `/remote-control` — nó mở lại cả session đã archive |
| Máy ngủ, rớt wifi chốc lát | Không tính là tắt | Không cần làm gì, tự reconnect khi máy tỉnh |
| Tắt máy, khởi động lại máy | Tiến trình chết hẳn | Như dòng tương ứng ở trên. Nhớ là cửa sổ 4 giờ tính **từ lúc server dừng**, không phải từ lúc bạn mở máy lại |

### 10.5. Bao lâu thì phải tạo session mới

Câu hỏi hay gặp nhất: *tắt Remote Control rồi, bao lâu nữa thì không gọi lại
được nữa?* Đáp án ngắn là **~4 giờ**, nhưng con số đó **chỉ áp dụng cho server
mode**. Tắt kiểu khác thì không có hạn giờ nào cả:

| Bạn tắt kiểu nào | Hạn để gọi lại session cũ |
| --- | --- |
| `Ctrl+C` ở `claude remote-control` (server mode) | **~4 giờ** kể từ lúc server dừng. Quá hạn thì `claude remote-control` chỉ tạo session mới, lịch sử cũ không theo về |
| Đóng terminal có `claude --remote-control` / `/remote-control` | **Docs không nêu hạn giờ nào.** Gọi lại bằng `claude --continue` / `claude --resume` — Claude Code tự nối lại đúng RC session ghi trong hội thoại đó |
| Bấm nút disconnect trong bảng `/remote-control` | Không có hạn — session local chưa hề tắt, gõ `/remote-control` là nối lại |

Ba mốc thời gian khác **rất dễ nhầm** với con số 4 giờ, nhớ để khỏi lẫn:

| Mốc | Là cái gì | Sau đó phải làm gì |
| --- | --- | --- |
| **~10 phút** | Server mode mất mạng kéo dài, tiến trình `claude remote-control` tự thoát | Docs nói chạy lại là **tạo session mới** |
| **~30 phút** | Session tương tác mất presence heartbeat, hiện `could not reach the Remote Control server for about 30 minutes` | Gõ `/remote-control` để **nối lại**, không phải tạo mới |
| **18 giờ** | Tuổi tối đa của lần đăng nhập trong [Trusted Devices](#143-trusted-devices-beta) | Xác nhận Face ID / Touch ID / Windows Hello / passkey. **Không liên quan tới tuổi thọ session** |

Hai mốc nữa thuộc chuyện khác nhưng hay bị gộp vào cùng câu hỏi: `dialogExpiry`
**5 phút** là hạn chờ của hộp thoại chuyển tiếp ra thiết bị ([§6.4](#64-prompt-xin-quyền-khi-bạn-ở-xa)),
còn VM của **cloud session** bị thu hồi sau một thời gian không hoạt động —
docs không nêu con số, và mở lại thì có luôn VM mới kèm lịch sử hội thoại
([§11.6](#116-giới-hạn-cần-biết-trước)).

#### Cửa sổ 4 giờ và hai điều kiện dễ quên

Ba lệnh lấy lại session của server mode ở [§9.3](#93-lấy-lại-session-sau-khi-tắt-server)
chỉ chạy được khi đủ **cả hai**:

1. **Đúng thư mục** đã chạy server trước đó. Riêng `--continue`: nếu thư mục này
   không có bản ghi nào, Claude Code lấy bản ghi mới nhất từ **git worktree khác
   của cùng repo**.
2. **Trong khoảng 4 giờ** kể từ lúc server dừng. Quá hạn thì `claude remote-control`
   chỉ tạo session mới — lịch sử cũ không theo về.

Hai trường hợp **không lấy lại được**, dù còn trong 4 giờ:

- Ở giữa đã có một `claude remote-control` khác chạy trong cùng thư mục.
- Bạn khởi động server với `--no-create-session-in-dir` → Claude Code **archive
  toàn bộ session của server ngay khi bạn dừng nó**, nên không còn gì để gọi lại.

Từ v2.1.228, `--continue` và `--session-id` còn **bỏ archive** giúp bạn nếu lỡ
archive session ở giữa. Nhớ là `--continue` và `--session-id` **không dùng chung**
với nhau, và cũng không dùng chung với `--spawn`, `--capacity`,
`--create-session-in-dir`.

### 10.6. Bật lại xong thì mất những gì

Hội thoại quay lại, nhưng **không phải thứ gì cũng quay lại**:

| Thứ | Có sống sót không |
| --- | --- |
| Lịch sử hội thoại | Có |
| Subagent, workflow, lệnh shell đang chạy dở | **Không** — chết theo tiến trình, kết quả dở dang mất |
| Việc chạy nền của **cloud session** sau khi VM bị thu hồi | **Không** — mở lại có lịch sử hội thoại, nhưng subagent và lệnh shell không được khôi phục |
| Thay đổi file đã ghi ra đĩa | Có — chúng nằm trên filesystem, không nằm trong session |
| Tên session | Có, nếu bạn đặt bằng `--name` / `/rename` |

Ngoài ra, khi bạn **gõ `/remote-control` để nối lại sau một lần kết nối rớt**,
session cũ có thể bị **archive âm thầm** làm bạn tưởng nó biến mất. Hai tình
huống gây ra điều này:

- Ở giữa, **compaction đã viết lại hội thoại**.
- Ở giữa, bạn đã `/resume` sang hội thoại khác.

Cả hai đều khiến Claude Code archive session server cũ thay vì để lại trong danh
sách. Tìm nó bằng bộ lọc **archived** ở claude.ai/code. Ngược lại, đổi hội thoại
trong lúc thiết bị **vẫn đang kết nối** thì không bị archive.

### 10.7. Năm cái bẫy khi bật lại

1. **Sai thứ tự sau `Previous session is unavailable`.** Gõ `/remote-control`
   ngay mà chưa khởi động lại Claude Code → **tin nhắn cũ của hội thoại không
   được đưa vào session mới**. Khởi động lại Claude Code trước, rồi mới bật.
2. **Terminal thứ hai không giành session.** Resume hội thoại ở terminal khác
   trong khi terminal đầu vẫn giữ Remote Control → in `Remote Control not started
   here` và để RC ở nguyên chỗ cũ. Muốn chuyển sang terminal mới thì gõ
   `/remote-control` ở đó.
3. **Session crash trong server mode: đừng restart server.** Chỉ cần nhắn cho nó
   từ thiết bị đang kết nối, server phục vụ lại (v2.1.238+).
4. **`--resume` chỉ đọc lịch sử của máy này.** Sang máy khác thì không có gì để
   resume — dùng `--teleport` nếu đó là session cloud, còn không thì bắt đầu
   session mới.
5. **Muốn thử lại mà không đụng session gốc**: thêm `--fork-session` khi resume,
   nó tạo session ID mới thay vì dùng lại ID cũ.

```bash
claude --resume --fork-session
```

---

## 11. Nâng cao — Cloud session: `--cloud` và `--teleport`

Cloud session chạy trên VM của Anthropic, **không đụng tới máy bạn**. Có trên gói
Pro, Max, Team, và Enterprise với premium seat / Chat + Claude Code seat.

### 11.1. Đẩy task lên cloud từ terminal

```bash
claude --cloud "Sửa bug authentication trong src/auth/login.ts"
```

Điều **quan trọng nhất phải nhớ**: VM clone **GitHub remote của thư mục hiện tại
tại branch hiện tại**, *không phải* bản checkout local của bạn. Có commit local
chưa push thì **push trước đã**, nếu không cloud sẽ làm trên code cũ.

Chạy nhiều task song song — mỗi lệnh là một session độc lập:

```bash
claude --cloud "Fix flaky test trong auth.spec.ts"
claude --cloud "Cập nhật tài liệu API"
claude --cloud "Refactor logger sang structured output"
```

Mẫu làm việc hiệu quả nhất là **lên kế hoạch ở local, thi hành trên cloud**:

```bash
claude --permission-mode plan        # bàn phương án, Claude không sửa code
# lưu plan vào repo, commit, push
claude --cloud "Thực hiện kế hoạch migration trong docs/migration-plan.md"
```

**Repo không có remote GitHub** (hoặc chưa cài Claude GitHub App): Claude Code
đóng gói repo local và upload thẳng lên. Bundle gồm toàn bộ lịch sử mọi branch +
thay đổi chưa commit của file đã tracked. Giới hạn: repo phải có ít nhất 1 commit,
bundle dưới 100 MB, **file untracked không được gửi** (nhớ `git add`). Ép dùng
bundle kể cả khi có remote:

```bash
CCR_FORCE_BUNDLE=1 claude --cloud "Chạy test suite và sửa lỗi"
```

Trên macOS/Linux/WSL, thay đổi chưa commit ở các file trông giống credential
(`.env`, `*.tfvars`, `id_rsa`, `*.pem`) **bị loại khỏi bundle** và Claude Code nói
rõ nó đã bỏ file nào. Repo GitLab/Bitbucket gửi lên được theo cách này nhưng
**không push ngược về remote đó được**.

### 11.2. Nhắn tiếp vào session cloud từ CLI

```bash
claude -p "thêm test case cho trường hợp token hết hạn" --cloud <session-id>
echo "rebase lên main giúp" | claude -p --cloud <session-id>
```

Lệnh này **đẩy một tin nhắn vào hàng đợi rồi thoát ngay**, không chờ trả lời. Nó
không gửi state local nào cả, nên chạy được **từ bất kỳ máy nào** đã
`claude auth login`, kể cả trong script CI. `<session-id>` là dạng `session_...`,
`cse_...` hoặc nguyên URL `claude.ai/code/<id>`.

Cần kết quả máy đọc được:

```bash
claude -p "trạng thái sao rồi" --cloud <session-id> --output-format json
# thành công: {ok, session_id, url}   thất bại: {ok:false, session_id, error}
```

### 11.3. Kéo session cloud về terminal — `--teleport`

```bash
claude --teleport                 # mở picker chọn session
claude --teleport <session-id>    # vào thẳng session
```

Trong session đang chạy thì dùng `/teleport` (viết tắt `/tp`), hoặc `/tasks` rồi
bấm `t`. Từ claude.ai/code: menu session → **Open in > Terminal**. Từ trong chính
session cloud: gõ `/teleport`, Claude trả về đúng lệnh cần chạy.

Teleport kiểm tra 4 điều kiện trước khi chạy:

| Điều kiện | Chi tiết |
| --- | --- |
| Git sạch | Không được có thay đổi chưa commit — sẽ hỏi bạn stash |
| Đúng repo | Phải chạy từ checkout của **cùng repo**, không phải fork |
| Branch đã push | Branch của session cloud phải có trên remote; teleport tự fetch + checkout |
| Cùng tài khoản | Phải đăng nhập đúng tài khoản claude.ai đã tạo session |

Phân biệt rõ: `--resume` mở lại hội thoại **từ lịch sử local của máy này** và
không liệt kê session cloud. `--teleport` kéo **session cloud kèm branch** về.

### 11.4. Kết hợp cả hai: teleport rồi bật Remote Control

Sau khi teleport, terminal nhận **bản sao riêng** của session — việc mới làm ở đó
**không** hiện ngược lên session cloud trên app. Muốn tiếp tục lái từ điện thoại:

```text
/remote-control
```

Đây là combo đáng nhớ nhất của cả bài: **giao việc cho cloud → kéo về máy để chạy
với môi trường thật → vẫn theo dõi tiếp từ điện thoại.**

### 11.5. Auto-fix pull request

Claude theo dõi PR, tự sửa khi CI fail hoặc có review comment:

```text
/autofix-pr          # chạy khi đang đứng trên branch của PR
```

Claude Code phát hiện PR bằng `gh`, tạo session cloud và bật auto-fix trong một
bước. Cần cài [Claude GitHub App](https://github.com/apps/claude) trên repo.

> **Cảnh báo cho repo có automation theo comment** (Atlantis, Terraform Cloud,
> GitHub Actions chạy trên `issue_comment`): Claude trả lời review comment **bằng
> tài khoản GitHub của bạn**, nên có thể vô tình kích hoạt các workflow đó. Đừng
> bật auto-fix ở repo mà một comment có thể deploy hạ tầng.

### 11.6. Giới hạn cần biết trước

- **Rate limit dùng chung** với toàn bộ hoạt động Claude của tài khoản. Chạy 5
  task song song thì tiêu tốn gấp 5. Không tính phí compute riêng cho VM.
- **VM bị thu hồi sau một thời gian không hoạt động.** Mở lại session từ
  claude.ai/code sẽ cấp VM mới kèm lịch sử hội thoại, nhưng **việc đang chạy nền
  (subagent, lệnh shell) không được khôi phục**. Đáng chú ý: session bị tính là
  "không hoạt động" trong lúc chờ bạn duyệt một tool call của MCP connector.
- **Phụ thuộc GitHub**: clone repo và tạo PR yêu cầu GitHub (GitHub Enterprise
  Server được hỗ trợ cho Team/Enterprise).
- **IP allowlist của tổ chức**: cloud session gọi API từ hạ tầng Anthropic chứ
  không từ mạng công ty bạn → nếu tổ chức bật IP allowlisting thì **mọi** cloud
  session sẽ lỗi xác thực. Phải nhờ Anthropic support miễn trừ.
- **Zero Data Retention**: tổ chức bật ZDR không dùng được `/web-setup` và các
  tính năng cloud session.

---

## 12. Nâng cao — Nhắn tin giữa các session

Từ v2.1.224 (macOS/Linux/WSL2) và **v2.1.234 trên Windows native**, Claude ở
session này nhắn được cho Claude ở session khác. Không cần bật gì cả.

```text
Nhắn @api-worker là migration schema xong rồi
Hỏi session ở terminal kia xem migration chạy xong chưa
```

Bạn **không tự gọi tool**; Claude dùng `ListAgents` để tìm và `SendMessage` để gửi.
Gõ `@` rồi vài chữ cái đầu của tên session để chọn từ gợi ý (cần v2.1.232+).

Xem mình đang với tới được những session nào:

```text
/list-agents      # bí danh: /peers
```

| Session đích nằm ở đâu | Tin nhắn đi đường nào |
| --- | --- |
| Cùng máy | Qua socket riêng từng session (named pipe trên Windows), **không qua server Anthropic** |
| Máy khác của bạn | Qua server Anthropic, tới qua kết nối **Remote Control** của máy đó |
| Trên cloud | Qua server Anthropic, thẳng tới session cloud |

Điểm mấu chốt: **muốn với tới session ở máy khác hoặc trên cloud thì session hiện
tại phải đang kết nối Remote Control.** Đó là lý do phần này nằm trong bài.

Ranh giới an toàn được giữ chặt — tin nhắn từ session khác **không phải** là sự
đồng ý của bạn:

- Không duyệt thay được permission prompt đang treo.
- Không được sửa permission settings, `CLAUDE.md` hay cấu hình vì "session kia bảo thế".
- Lệnh slash trong tin nhắn chỉ là text, **không bao giờ được thực thi**.
- Việc cần quyền vẫn hiện prompt như thường.

Kiểm soát chiều vào bằng `crossSessionInbound`: `accept` (giao), `hold` (giữ lại
chờ bạn duyệt), `refuse` (bỏ). Chặn chiều ra bằng deny rule:

```json
{
  "permissions": { "deny": ["SendMessage", "ListAgents"] },
  "crossSessionInbound": "refuse",
  "isolatePeerMachines": true
}
```

`isolatePeerMachines: true` bắt buộc bạn duyệt tay trước khi **bất kỳ** tin nhắn
nào rời khỏi máy này — kể cả ở chế độ `bypassPermissions`. Một `true` từ bất kỳ
scope nào đều có hiệu lực (project file bật được nhưng không tắt được).

Hai giới hạn hay vấp trên Windows: session trong **container và session trên host
không với tới nhau**; session trong **WSL2 và session Windows native** cũng vậy.

---

## 13. Nâng cao — Channels: đẩy Telegram/Discord/CI vào session

Channels (đang ở **research preview**) là MCP server **đẩy sự kiện vào session
đang chạy**. Khác Remote Control ở chỗ nguồn sự kiện không phải là bạn: CI fail,
tin nhắn Telegram, webhook từ error tracker... đều vào thẳng session đang mở sẵn
file của bạn.

Cần [Bun](https://bun.sh). Ví dụ với Telegram:

```text
/plugin install telegram@claude-plugins-official
/telegram:configure <token-từ-BotFather>
```

Rồi khởi động lại với cờ `--channels` (cờ này **không hiện trong `claude --help`**
khi còn ở preview, nhưng vẫn chạy):

```bash
claude --channels plugin:telegram@claude-plugins-official
```

Nhắn cho bot → bot trả về pairing code → về terminal:

```text
/telegram:access pair <code>
/telegram:access policy allowlist
```

Bước `policy allowlist` cuối cùng **không được bỏ**: nó khoá lại để chỉ tài khoản
của bạn đẩy được tin nhắn vào session. Ai gửi được qua channel thì cũng có thể
duyệt/từ chối tool use nếu channel đó khai báo permission relay — nên chỉ
allowlist người bạn giao được quyền đó.

Muốn thử trước mà không cần bot thật, dùng demo channel `fakechat` chạy ở
`http://localhost:8787`:

```text
/plugin install fakechat@claude-plugins-official
```
```bash
claude --channels plugin:fakechat@claude-plugins-official
```

Team/Enterprise: Owner phải bật `channelsEnabled` trong
[admin settings](https://claude.ai/admin-settings/claude-code) trước.

---

## 14. Bảo mật: đường truyền, dữ liệu, Trusted Devices, cách tắt hẳn

### 14.1. Kết nối hoạt động thế nào

Máy bạn **chỉ tạo kết nối HTTPS đi ra** và **không bao giờ mở cổng vào**. Khi bật
Remote Control, nó đăng ký với Anthropic API rồi poll việc. Lúc bạn kết nối từ
thiết bị khác, server định tuyến tin nhắn giữa web/mobile và session local qua một
streaming connection. Toàn bộ đi qua TLS, dùng nhiều credential ngắn hạn, mỗi cái
một mục đích và hết hạn độc lập.

Điều đó nghĩa là: **không cần mở port, không cần VPN, không cần cấu hình router.**
Chỉ cần ra được `api.anthropic.com` cổng 443.

### 14.2. Dữ liệu nào được lưu

Trong lúc Remote Control kết nối, **transcript của session** — tin nhắn của bạn,
trả lời của Claude, hoạt động tool — được **lưu trên server Anthropic** để đồng bộ
giữa các thiết bị và để nối lại sau khi rớt mạng. Việc **thực thi lệnh và truy cập
file vẫn hoàn toàn ở máy bạn**. Transcript lưu theo chính sách Data usage.

Hệ quả thực tế cho dự án có dữ liệu nhạy cảm: nếu policy của bạn cấm transcript
rời máy, **đừng bật Remote Control** cho repo đó — dùng `disableRemoteControl`.
Tổ chức yêu cầu Zero Data Retention thì không bật Remote Control được.

### 14.3. Trusted Devices (beta)

Ràng buộc quyền điều khiển Remote Control vào **thiết bị đã đăng ký** thay vì chỉ
"tài khoản đã đăng nhập". Khi bật, để xem/lái session từ claude.ai, app mobile hay
Desktop cần đủ hai thứ:

- **Thiết bị đã enroll**: mỗi trình duyệt/điện thoại/app đăng ký credential riêng,
  và chỉ được enroll ngay sau một lần đăng nhập đầy đủ.
- **Đăng nhập còn mới**: không quá **18 giờ**. Hết hạn thì xác nhận bằng Face ID,
  Touch ID, Windows Hello hoặc passkey — không phải đăng nhập lại.

Sinh trắc học chạy hoàn toàn trên thiết bị qua OS/trình duyệt. **Anthropic không
nhận và không lưu dữ liệu vân tay hay khuôn mặt**, chỉ lưu public key và metadata
cơ bản. Máy chạy Claude Code nhận credential tự động khi bạn đăng nhập CLI, không
có bước enroll riêng ở terminal.

Bật: Pro/Max tự bật **Require trusted devices** trong settings; Team/Enterprise do
Owner bật tại **Organization settings > Capabilities > Remote sessions**. Session
đang chạy trước khi bật **không bị áp dụng ngược**. Quản lý thiết bị đã enroll tại
[claude.ai/settings/account](https://claude.ai/settings/account#trusted-devices).

### 14.4. Tắt hoàn toàn

```json
// managed settings — chặn ở mức thiết bị, user không override được
{ "disableRemoteControl": true }
```

Xem [`examples/settings.managed.json`](examples/settings.managed.json) cho cấu
hình tổ chức đầy đủ (chặn Remote Control + cross-session messaging).

---

## 15. Bốn kịch bản thực tế

### 15.1. Chạy test dài, đi ăn trưa

```bash
claude --remote-control "run-e2e"
```
```text
> chạy toàn bộ e2e suite, phân tích test nào fail và báo tôi khi xong
```
Bật **Push when Claude decides** trong `/config`. Điện thoại rung khi suite xong;
mở app, đọc phân tích, nhắn tiếp "sửa 2 test đầu" ngay trên điện thoại. Code sửa
nằm trên máy công ty, sẵn sàng khi bạn về bàn.

### 15.2. Máy dev ở công ty, người ở nhà

```bash
# SSH vào máy công ty
ssh dev@10.0.0.15
tmux new -s rc
claude remote-control --name "hasaki-api" --spawn worktree --capacity 3
# Ctrl+B D, thoát SSH
```
Từ nhà mở claude.ai/code, thấy `hasaki-api` với chấm xanh. Mỗi task mở từ web sẽ
có **git worktree riêng**, ba task song song không đụng file nhau. Máy công ty vẫn
là nơi chạy code, với đúng database, đúng `.env`, đúng VPN nội bộ.

### 15.3. Ba task độc lập, không muốn chờ

```bash
git push                                    # BẮT BUỘC: cloud clone từ remote
claude --cloud "Viết unit test cho src/services/payment.js"
claude --cloud "Sửa lint error toàn repo"
claude --cloud "Cập nhật README theo API mới"
```
Ba VM chạy song song trong lúc bạn làm việc khác. Xong việc nào thì tạo PR từ
claude.ai/code, hoặc `claude --teleport` kéo về máy để chạy thử trước khi push.

### 15.4. Đang họp, PR bị CI đánh trượt

Trên điện thoại, mở session và nhắn:
```text
xem CI của PR #482 fail vì sao, sửa nếu rõ ràng, còn mơ hồ thì hỏi tôi
```
Hoặc bật auto-fix một lần cho xong, rồi PR tự được vá mỗi lần CI fail:
```text
/autofix-pr
```

---

## 16. Nội dung thư mục này

```
147_claude_remote_guide/
├── README.md                      # bạn đang đọc
├── CHEATSHEET.md                  # tra cứu nhanh lệnh, cờ, setting, biến môi trường
├── TROUBLESHOOTING.md             # bảng lỗi → nguyên nhân → cách sửa
├── examples/
│   ├── settings.user.json         # ~/.claude/settings.json: bật auto-connect + presence file
│   ├── settings.project.json      # .claude/settings.json: tắt Remote Control cho repo nhạy cảm
│   └── settings.managed.json      # managed settings: chặn ở mức tổ chức
└── scripts/
    ├── check-remote-ready.ps1     # kiểm tra điều kiện trước khi bật (Windows)
    ├── check-remote-ready.sh      # bản bash
    ├── start-remote-control.ps1   # khởi động server mode có kiểm tra (Windows)
    ├── start-remote-control.sh    # bản bash, bọc sẵn tmux cho SSH
    └── presence-watch.ps1         # tạo/xoá presence file theo trạng thái khoá màn hình
```

Không có dependency nào cần cài. Script chỉ gọi `claude` CLI và lệnh hệ thống.

---

## Tài liệu gốc

- [Remote Control](https://code.claude.com/docs/en/remote-control)
- [Claude Code on the web / cloud sessions](https://code.claude.com/docs/en/claude-code-on-the-web)
- [Cross-session messaging](https://code.claude.com/docs/en/cross-session-messaging)
- [Channels](https://code.claude.com/docs/en/channels)
- [CLI reference](https://code.claude.com/docs/en/cli-reference) · [Settings reference](https://code.claude.com/docs/en/settings-reference)
