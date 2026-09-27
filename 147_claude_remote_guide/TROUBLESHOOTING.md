# Xử lý sự cố — Claude Code Remote

Tra theo **thông báo lỗi Claude Code in ra**. Thông báo giữ nguyên tiếng Anh để
bạn copy-paste tìm được; phần giải thích và cách sửa bằng tiếng Việt.

Ba lệnh chẩn đoán dùng trước tiên:

```bash
claude doctor      # kiểm tra nào trượt: eligibility, Organization policy, env
claude --version   # nhiều lỗi chỉ là do bản cũ
```
```text
/status            # plan, tổ chức đang đăng nhập, Compliance, Peer address
```

---

## 1. Không bật được Remote Control

### `Remote Control requires a claude.ai subscription`

Biến thể khác: `/remote-control requires a claude.ai subscription.` hoặc
`You must be logged in to use Remote Control.`

Bạn chưa đăng nhập bằng tài khoản claude.ai, hoặc có credential khác đang chiếm
quyền. Nếu thông báo có kèm `ANTHROPIC_API_KEY is set, so this session is using
API-key auth` thì nguyên nhân đã rõ.

```bash
claude auth login      # chọn phương án claude.ai
```

Rồi gỡ credential đang chiếm quyền — trong shell environment **và** trong khối
`env` của file settings: `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, hoặc
setting `apiKeyHelper`.

### `Remote Control requires a full-scope login token`

Bạn đang dùng token dài hạn từ `claude setup-token` hoặc biến
`CLAUDE_CODE_OAUTH_TOKEN`. Loại token này **chỉ gọi được model**, không tạo được
Remote Control session.

```bash
claude auth login      # lấy session token đầy đủ quyền
```

### `Remote Control isn't enabled for this account`

Entitlement cache cũ sau khi đổi gói cước.

```bash
claude auth logout
claude auth login
claude update
claude doctor          # xem chính xác bước kiểm tra nào trượt
```

Trước v2.1.239 thông báo này ghi là *"Remote Control is not yet enabled for your
account"*.

### `Remote Control is only available when using Claude via api.anthropic.com`

Session không nói chuyện trực tiếp với Anthropic API. Thông báo nêu rõ thứ gì đã
định tuyến đi chỗ khác. Gỡ biến đó khỏi shell **và** khỏi khối `env` trong
settings, rồi khởi động lại:

| Nguyên nhân | Gỡ gì |
| --- | --- |
| Amazon Bedrock | `CLAUDE_CODE_USE_BEDROCK` |
| Google Cloud Agent Platform / Microsoft Foundry | Biến cấu hình tương ứng |
| LLM gateway / proxy | `ANTHROPIC_BASE_URL` |

### `Remote Control requires feature-flag evaluation`

| Biến trong thông báo | Cách xử lý |
| --- | --- |
| `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`, `DISABLE_GROWTHBOOK` | **Bắt buộc gỡ** — Remote Control không chạy được khi có chúng |
| `DISABLE_TELEMETRY`, `DO_NOT_TRACK` | Vẫn dùng được RC nếu **v2.1.283+**. Bản cũ hơn thì `claude update`. Ngoại lệ: tổ chức yêu cầu Trusted Devices thì phải gỡ |

### `Remote Control is disabled by your organization's policy`

Kiểm tra theo thứ tự:

1. Thông báo nhắc `disableRemoteControl` → IT đã chặn ở mức thiết bị bằng managed
   settings. Không tự sửa được.
2. Gói của bạn là Pro/Max nhưng Claude Code vẫn đăng nhập dưới tổ chức Team/
   Enterprise cũ. Gõ `/status` để xem plan và tổ chức đang dùng, rồi
   `claude auth logout` + `claude auth login`.
3. Thông báo **không** bảo liên hệ admin → tổ chức có cấu hình HIPAA không tương
   thích (`/status` hiện `HIPAA` ở dòng `Compliance`). Toggle trong admin panel bị
   khoá xám, phải liên hệ Anthropic support.
4. Còn lại: Owner chưa bật. Remote Control **mặc định tắt** trên Team/Enterprise —
   bật tại [claude.ai/admin-settings/claude-code](https://claude.ai/admin-settings/claude-code).

### `Couldn't verify your organization's policy for remote control`

Claude Code không lấy được policy và cũng không có bản lưu trên máy, nên nó giữ
Remote Control tắt cho an toàn. Thường do khởi động lúc chưa có mạng, VPN chưa
lên, hoặc proxy chặn.

Khôi phục mạng rồi gõ `/remote-control` — mỗi lần thử là một lần kiểm tra lại,
**không cần khởi động lại Claude Code**. Lặp mãi thì `claude doctor` và đọc dòng
`Organization policy`.

### `Remote credentials fetch failed`

```bash
claude remote-control --verbose      # xem lỗi đầy đủ
```

Ba nguyên nhân thường gặp: chưa đăng nhập; firewall/proxy chặn HTTPS ra
`api.anthropic.com:443`; hoặc kèm `Session creation failed — see debug log` thì
kiểm tra subscription còn hiệu lực không.

### `Couldn't verify Remote Control eligibility`

Không gọi được dịch vụ feature flag — thường do offline hoặc proxy. Có mạng rồi
thử lại, hoặc `claude doctor`.

### Trusted Devices

| Thông báo | Cách sửa |
| --- | --- |
| `Your organization requires Trusted Devices... this device is not enrolled` | Gõ `/login` trong Claude Code. Enroll diễn ra trong lúc đăng nhập, **không có lệnh enroll riêng** |
| `session expired for trusted-device check` | Đăng nhập quá 18 giờ. `/login`, hoặc xác nhận bằng Face ID / Touch ID / Windows Hello / passkey khi app nhắc |

---

## 2. Mất kết nối, không nối lại được

### `Couldn't reconnect to your Remote Control session`

Xảy ra khi `claude --resume` / `--continue`: Claude Code thử nối lại session ghi
trong hội thoại đó nhưng thất bại (mạng chập chờn hoặc lỗi server). Gõ
`/remote-control` để thử lại, hoặc `claude --remote-control` để tạo session mới.
Session local vẫn chạy bình thường trong lúc đó.

### `Previous session is unavailable — run /remote-control to start a new one`

Gõ `/remote-control` để tạo session mới. **Lưu ý**: nếu gõ ngay mà không khởi
động lại Claude Code trước, các tin nhắn cũ của hội thoại **sẽ không** được đưa
vào session mới.

### `Remote Control got an unexpected server response`

Bản CLI này không đọc được phản hồi của server. Thử lại cũng vẫn hỏng.

```bash
claude update
```
rồi `/remote-control`.

### `Remote Control not started here`

Bạn mở lại hội thoại ở terminal thứ hai trong khi terminal đầu vẫn đang giữ Remote
Control. Đây là **hành vi cố ý** — nó không giành session. Gõ `/remote-control` ở
terminal thứ hai nếu thật sự muốn chuyển sang đó.

### Session tự biến mất khỏi danh sách

| Triệu chứng | Giải thích |
| --- | --- |
| *Another connection took over this session* | Thiết bị/session khác đã chiếm. `/remote-control` để giành lại |
| *This session was ended or archived from another device or app* | Bị kết thúc hoặc archive từ nơi khác. `/remote-control` sẽ mở lại bản đã archive |
| *The server no longer reports this session* | Có thể đã bị xoá hẳn. Tạo mới |

### Rớt mạng kéo dài

| Chế độ | Hành vi | Bạn cần làm |
| --- | --- | --- |
| Server mode | Bỏ cuộc sau ~10 phút, tiến trình thoát | Chạy lại `claude remote-control` |
| Session tương tác | Thử lại suốt thời gian mất mạng | Không cần làm gì, nó tự nối lại |

Gặp HTTP 403 (hay xảy ra sau khi đổi VPN/mạng): Claude Code thử lại **tối đa 3
phút** rồi mới ngắt, và nói rõ thứ gì đã từ chối — network edge hay proxy/VPN/
firewall trong mạng của bạn.

Thấy `could not reach the Remote Control server for about 30 minutes`: heartbeat
đã chết, gõ `/remote-control` để nối lại.

### Session bị crash trong server mode

Không cần restart server. Nhắn cho session đó từ thiết bị đang kết nối, Claude
Code sẽ phục vụ lại nó (cần **v2.1.238+**).

### Tắt server rồi, session đâu?

Trong **~4 giờ**, chạy lại trong **đúng thư mục cũ**:

```bash
claude remote-control                     # tất cả
claude remote-control --continue          # session server khởi đầu
claude remote-control --session-id <id>   # đúng một session
```

Không lấy lại được nếu: đã quá 4 giờ, đã có một `claude remote-control` khác chạy
trong cùng thư mục, hoặc bạn đã khởi động với `--no-create-session-in-dir` (trường
hợp này Claude Code archive session ngay khi dừng server).

Riêng `--continue`: nếu thư mục hiện tại không có bản ghi nào, Claude Code lấy bản
ghi mới nhất từ **git worktree khác của cùng repo**. Nó cũng **không dùng chung**
với `--session-id`, `--spawn`, `--capacity`, `--create-session-in-dir`.

### Bật lại rồi nhưng session không còn trong danh sách

Khi bạn gõ `/remote-control` để **nối lại sau một lần kết nối rớt**, Claude Code
**archive session cũ âm thầm** trong hai tình huống, không phải lỗi:

- Ở giữa, **compaction đã viết lại hội thoại**.
- Ở giữa, bạn đã `/resume` sang hội thoại khác.

Tìm nó bằng bộ lọc **archived** trong danh sách session ở claude.ai/code. Đổi hội
thoại trong lúc thiết bị **vẫn đang kết nối** thì không bị archive.

### Bật lại rồi nhưng mất hết việc đang chạy dở

Đúng như thiết kế. Hội thoại quay lại, nhưng **subagent, workflow và lệnh shell
đang chạy thì chết theo tiến trình** và không được khôi phục — kể cả với cloud
session sau khi VM bị thu hồi. Thay đổi đã ghi ra file thì vẫn còn, vì chúng nằm
trên đĩa chứ không nằm trong session.

Muốn việc dài hơi sống sót: chạy nó trong `tmux`/`screen` (xem README §10.1) thay
vì để nó chết cùng terminal.

### Resume ở máy khác không thấy session cũ

`--resume` chỉ đọc **lịch sử local của máy này**, không liệt kê session cloud và
không với sang máy khác. Với session cloud thì dùng `claude --teleport`. Với
session local trên máy khác thì không có cách mang hội thoại đi — bắt đầu session
mới ở đó.

Muốn resume mà không đụng vào session gốc, thêm `--fork-session`: nó tạo session
ID mới thay vì dùng lại ID cũ.

```bash
claude --resume --fork-session
```

---

## 3. Không nhận được thông báo đẩy

| Triệu chứng | Nguyên nhân | Cách sửa |
| --- | --- | --- |
| `/config` hiện **No mobile registered** | App chưa refresh push token | Mở app Claude trên điện thoại; cảnh báo tự mất ở lần kết nối RC kế tiếp |
| Im lặng hoàn toàn | Chưa bật công tắc | `/config` → bật **Push when Claude decides** và/hoặc **Push when actions required** |
| iOS không hiện | Focus mode, notification summary | Settings → Notifications → Claude |
| Android đến muộn | Battery optimization | Loại app Claude khỏi battery optimization |
| Chỉ im khi đang ngồi máy | **Đúng như thiết kế** | Claude Code bỏ qua push khi bạn đang gõ/focus terminal. Xem `CLAUDE_CLIENT_PRESENCE_FILE` nếu file đánh dấu chưa bị xoá |

Sai lầm hay gặp với `CLAUDE_CLIENT_PRESENCE_FILE`: **còn file là còn im lặng**.
Script tạo file lúc mở khoá máy mà không xoá khi khoá màn hình thì bạn sẽ không
bao giờ nhận được thông báo nữa.

---

## 4. Cloud session và teleport

### `Unable to get organization UUID`

`--cloud` và `--teleport` cần đăng nhập claude.ai. Nếu dùng API key hoặc thông tin
tài khoản đã cũ sẽ gặp lỗi này. Gõ `/login` rồi thử lại.

Dùng API key mà chạy `claude --teleport` không kèm session ID thì thấy
`Error loading Claude Code sessions` trong picker — cùng một nguyên nhân.

### Bảng lỗi khi gửi tin nhắn vào session cloud

| Thông báo | Nghĩa là |
| --- | --- |
| `Cloud sessions aren't available with <provider>` | Đang cấu hình provider bên thứ ba. Gỡ (ví dụ `CLAUDE_CODE_USE_BEDROCK`) và `claude auth login` |
| `Cloud sessions are disabled by your organization's policy` | Policy `allow_remote_sessions` đang tắt, Owner bật trong admin settings |
| `Attaching to an existing cloud session is not enabled for your account` | Bạn chạy `--cloud <session-id>` mà thiếu `-p`. Đúng cú pháp: `claude -p "tin nhắn" --cloud <id>` |
| `Session not found: <id>` | Sai ID/URL, hoặc session không thuộc tài khoản bạn |
| `cloud session <id> is archived and cannot accept new messages` | Session đã archive, tạo session mới |

### `Session creation failed` hoặc treo ở bước provisioning

- Kiểm tra [status.claude.com](https://status.claude.com)
- Thử lại sau một phút (VM cấp phát theo nhu cầu)
- Xác nhận kết nối GitHub với tới được repo

### Teleport không chạy

| Lỗi | Nguyên nhân |
| --- | --- |
| Đòi stash | Working directory còn thay đổi chưa commit |
| Báo sai repo | Phải chạy từ checkout của **cùng repo**, không phải fork. Claude Code nêu tên cả repo của session lẫn repo của bạn |
| Không tìm thấy branch | Branch của session cloud chưa được push lên remote |
| `Remote Control session expired` / `Access denied` | Teleport đi qua hạ tầng Remote Control nên lỗi hiện theo cách nói của RC. Gõ `/login` để làm mới credential, và xác nhận đúng tài khoản sở hữu session |

Remote có dạng SSH alias (`git@work:owner/repo.git`) khiến Claude Code không phân
tích được hostname → nó sẽ hỏi xác nhận, và chấp nhận nếu owner + tên repo khớp.

### Cloud session làm trên code cũ

Không phải lỗi. `--cloud` clone **GitHub remote tại branch hiện tại**, không phải
working directory. `git push` trước khi chạy.

### `Environment expired`

VM bị thu hồi sau một thời gian không hoạt động. Mở lại session từ claude.ai/code
để cấp VM mới kèm lịch sử hội thoại — nhưng **việc đang chạy nền (subagent, lệnh
shell) không được khôi phục**.

Bẫy: session bị tính là "không hoạt động" trong lúc **chờ bạn duyệt tool call của
MCP connector** hoặc chờ bạn đăng nhập MCP server. Đi họp lúc đang có prompt treo
thì rất dễ mất VM.

### Mọi cloud session đều lỗi xác thực

Tổ chức bật IP allowlisting. Cloud session gọi Anthropic API từ hạ tầng của
Anthropic chứ không từ mạng công ty, nên bị chặn hết. Liên hệ Anthropic support để
miễn trừ. Áp dụng cho cả Code Review và routines chạy trên môi trường Anthropic.

---

## 5. Nhắn tin giữa các session

| Triệu chứng | Nguyên nhân |
| --- | --- |
| `/list-agents` không được nhận dạng | Bản CLI quá cũ. Cần **v2.1.224+** (macOS/Linux/WSL2) hoặc **v2.1.234+** (Windows native) |
| `/list-agents` chạy nhưng tin nhắn không tới | Xem 5 khả năng dưới |
| Không thấy session cloud | Session hiện tại **chưa kết nối Remote Control** |
| Không thấy session ở máy khác | Máy đó phải đang chạy Remote Control **và** session này cũng phải đang kết nối |
| Session hiện `offline` | Tin nhắn vẫn gửi đi được, nhưng chỉ tới khi máy đó online lại |
| Tin nhắn bị nuốt | `crossSessionInbound` của bên nhận đang là `hold` hoặc `refuse` |
| Không gửi được | Có deny rule cho `SendMessage` / `ListAgents` |

Trường hợp **không bao giờ** với tới nhau, không phải lỗi cấu hình:

- Session trong container ↔ session trên host
- Session trong WSL2 ↔ session Windows native

Thấy `unavailable` ở dòng `Peer address` của `/status`: Claude Code không tạo được
inbox socket và nêu lý do ngay tại đó. Trên macOS/Linux nó từ chối thư mục không an
toàn (ví dụ thư mục của user khác) và tự dùng `/tmp/cc-socks-<uid>`.

Giới hạn kênh tin nhắn: tối đa ~1 triệu ký tự mỗi tin cùng máy; gửi dồn dập sẽ bị
từ chối ở phía gửi; vòng lặp tin nhắn giữa hai session tự dừng nhờ rate limit.

---

## 6. Channels

| Triệu chứng | Cách sửa |
| --- | --- |
| `Marketplace "claude-plugins-official" not found` | `/plugin marketplace add anthropics/claude-plugins-official` rồi cài lại |
| Cài xong báo `Run /reload-plugins to activate.` | Chạy `/reload-plugins`, hoặc khởi động lại là xong |
| Bot không trả lời pairing code | Claude Code phải đang chạy **kèm `--channels`** — bot chỉ trả lời khi channel đang hoạt động |
| Channel không đăng ký được | Team/Enterprise chưa bật `channelsEnabled`, hoặc plugin không nằm trong `allowedChannelPlugins` |
| Có trong `.mcp.json` mà vẫn không nhận tin | Phải được nêu tên trong `--channels`, chỉ khai báo MCP là chưa đủ |
| Session đứng im chờ duyệt quyền | Channel chưa khai báo permission relay. Xem lại permission mode trước khi rời máy |

Cần [Bun](https://bun.sh) cho mọi channel plugin: `bun --version`.

---

## 7. Khi mọi thứ vẫn không chạy

```bash
claude update
claude doctor
claude remote-control --verbose --debug=api --debug-file rc-debug.log
```

Đọc `rc-debug.log` trước khi mở issue. Báo lỗi tại
[github.com/anthropics/claude-code/issues](https://github.com/anthropics/claude-code/issues),
kèm `claude --version`, hệ điều hành, và thông báo lỗi nguyên văn.
