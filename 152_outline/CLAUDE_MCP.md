# Kết nối Claude với Outline qua MCP

Outline 1.13 có sẵn **MCP server** (Model Context Protocol) ở đường dẫn `/mcp`. Kết nối Claude vào đó là Claude
tự tìm, đọc, tạo và sửa tài liệu trong wiki: "tìm quy trình deploy rồi tóm tắt", "tạo tài liệu checklist release
trong collection Kỹ thuật", "tài liệu này hôm nay ai sửa gì". Không cần cài thêm gì phía Outline: stack trong
[`docker-compose.yml`](docker-compose.yml) đã bật sẵn.

Kiểm chứng ngày 16/11/2026 với **Outline 1.13.0** (stack của thư mục này), **Claude Code 2.1.325**, **mcp-remote
0.16.6**, trên Windows 11. Đã chạy thật: thêm server vào Claude Code bằng API key đến khi `claude mcp list` báo
`✔ Connected` (cả kiểu key nằm trong biến `${OUTLINE_API_KEY}`), tạo `.mcp.json`, một câu hỏi `claude -p` để Claude
gọi tool Outline và trả lời đúng (mục 3.5), từng bước của luồng OAuth (đăng ký client, trang *Authorize*, đổi code
lấy token, gọi `/mcp` bằng token), cầu nối `mcp-remote` mà Claude Desktop dùng, tool ghi (`create_document`,
`delete_document`), key chỉ đọc. Danh sách tool, thông báo và lỗi trong file này chép từ các lần chạy đó, trừ hai
dòng ghi rõ "theo mã nguồn" ở mục 10. **Chưa thử**: giao diện `/mcp` tương tác của Claude Code, ứng dụng Claude
Desktop (máy thử không cài), connector trên claude.ai và MCP connector của Claude API (hai cách này cần Outline có
tên miền HTTPS public; các bước ở mục 5, 6 lấy từ tài liệu chính thức).

```
  bạn: "tìm tài liệu về deploy, cho biết checklist xong mấy việc"
    │
    ▼
  Claude Code ── MCP (HTTP, JSON-RPC) ──► http://localhost:3500/mcp ──► Outline: tìm, đọc, sửa
    ▲                                       Authorization: Bearer ol_api_...   (đúng quyền của user sở hữu key)
    └──────── kết quả tool (JSON) ◄─────────┘
```

| Claude dùng ở đâu | Cách kết nối | Outline ở `localhost` | Đã thử |
|---|---|---|---|
| Claude Code (CLI, IDE) | `claude mcp add --transport http` với API key hoặc OAuth (mục 3) | Được | Có |
| Claude Desktop | Cầu nối `mcp-remote` trong `claude_desktop_config.json` (mục 4) | Được | Cầu nối: có. App: chưa |
| claude.ai (web, Desktop, mobile) | Custom connector, đăng nhập OAuth (mục 5) | **Không**, cần HTTPS public ở cổng 443 | Chưa |
| Claude API (code của bạn) | MCP connector: `mcp_servers` + `mcp_toolset` (mục 6) | **Không**, cần URL HTTPS public | Chưa |

---

## Mục lục

1. [Outline MCP server có gì](#1-outline-mcp-server-có-gì)
2. [Tạo API key](#2-tạo-api-key)
3. [Claude Code](#3-claude-code)
4. [Claude Desktop](#4-claude-desktop)
5. [claude.ai: custom connector](#5-claudeai-custom-connector)
6. [Claude API: MCP connector](#6-claude-api-mcp-connector)
7. [Các tool Claude dùng được](#7-các-tool-claude-dùng-được)
8. [Prompt mẫu](#8-prompt-mẫu)
9. [Bảo mật](#9-bảo-mật)
10. [Xử lý sự cố](#10-xử-lý-sự-cố)
11. [Tham khảo](#11-tham-khảo)

---

## 1. Outline MCP server có gì

| | |
|---|---|
| Địa chỉ | `<URL>/mcp`, ở demo này `http://localhost:3500/mcp`. **Settings → AI** hiện sẵn ô *Use this URL in your MCP client* với đúng địa chỉ này |
| Transport | Streamable HTTP (`POST`), không giữ phiên. Không có kiểu SSE cũ: `GET /mcp` trả `405`, `/mcp/sse` trả `404`. Trong client chọn transport **http**, không chọn **sse** |
| Bật/tắt | **Settings → AI → MCP server**, mặc định *Enabled*. Tắt thì `/mcp` trả `404` |
| Xác thực | API key cá nhân, gửi header `Authorization: Bearer ol_api_...` (mục 2), hoặc OAuth: client tự đăng ký với Outline, bạn bấm **Authorize** trên trình duyệt (mục 3.2) |
| Quyền | Bằng đúng quyền của user sở hữu key hoặc đã bấm Authorize. Giao diện ghi: *"Connected apps can read and edit content with the same permissions as the member who connects them."* |
| Phạm vi | Key không giới hạn scope, hoặc OAuth (`read write`): **20 tool**. Key có scope `read`: **8 tool** chỉ đọc, các tool ghi không xuất hiện (mục 7) |
| Giới hạn | 1000 request mỗi giờ |
| Custom instructions | **Settings → AI → Custom instructions**: đoạn văn gửi cho Claude mỗi lần kết nối, nối sau hướng dẫn mặc định của Outline. Nên ghi cách tổ chức wiki, ví dụ "Tài liệu kỹ thuật nằm trong collection Kỹ thuật, quy trình đặt tên ..." |

Hướng dẫn mặc định Outline gửi cho Claude khi kết nối (trường `instructions` của MCP), tóm tắt: nội dung tài liệu
không mở đầu bằng heading cấp 1 vì tiêu đề là trường riêng; nhắc tên người bằng cú pháp
`@[Tên](mention://user/<id>)` (lấy id bằng tool `list_users`); đọc ảnh và file đính kèm bằng tool `fetch`; nội dung
có thể chứa ảnh base64.

---

## 2. Tạo API key

Dùng cho Claude Code (mục 3.1), Claude Desktop (mục 4) và Claude API (mục 6). Cách OAuth ở mục 3.2 không cần key.

1. Đăng nhập Outline → **Settings → API & Access** → **New API key…**
2. Điền hộp thoại:

   | Trường | Điền |
   |---|---|
   | **Name** | Tên để nhận ra key, ví dụ `Claude Code` |
   | **Scopes** | Để trống: toàn quyền như user (20 tool). Gõ `read`: chỉ đọc (8 tool) |
   | **Expiration** | Mặc định *30 days*; có 7/60/90 ngày, *Custom*, *No expiration* |

3. **Create**, chép ngay key dạng `ol_api_...`: danh sách bên dưới về sau chỉ hiện dạng rút gọn `ol...KzHZ`.
4. Cất key vào biến môi trường để khỏi dán thẳng vào lệnh và file cấu hình:

   ```bash
   export OUTLINE_API_KEY=ol_api_xxxxxxxxxxxxxxxx          # Git Bash / macOS / Linux, thêm vào ~/.bashrc để giữ lâu
   ```

   ```powershell
   $env:OUTLINE_API_KEY = "ol_api_xxxxxxxxxxxxxxxx"        # PowerShell, chỉ trong cửa sổ hiện tại
   setx OUTLINE_API_KEY "ol_api_xxxxxxxxxxxxxxxx"          # lưu cho các cửa sổ mở sau (mở terminal mới)
   ```

Key được tạo bởi tài khoản nào thì Claude có quyền của tài khoản đó. Thử nghiệm thì tạo key bằng tài khoản Viewer
hoặc key scope `read`.

---

## 3. Claude Code

### 3.1. Cách 1: API key (nhanh nhất)

```bash
# Git Bash / macOS / Linux
claude mcp add --transport http outline http://localhost:3500/mcp --header "Authorization: Bearer $OUTLINE_API_KEY"
```

```powershell
# PowerShell
claude mcp add --transport http outline http://localhost:3500/mcp --header "Authorization: Bearer $env:OUTLINE_API_KEY"
```

```
Added HTTP MCP server outline with URL: http://localhost:3500/mcp to local config
```

`outline` là tên server, cũng là phần giữa trong tên tool: `mcp__outline__list_documents`.

Dấu nháy kép làm shell thay key vào ngay, nên Claude Code lưu **nguyên key** trong `~/.claude.json`. Muốn Claude Code
chỉ lưu tên biến `${OUTLINE_API_KEY}` và đọc giá trị mỗi lần chạy, dùng nháy đơn (cả bash lẫn PowerShell):

```bash
claude mcp add --transport http outline http://localhost:3500/mcp --header 'Authorization: Bearer ${OUTLINE_API_KEY}'
```

Đã thử: có biến `OUTLINE_API_KEY` thì kết nối được, thiếu thì báo lỗi 401 (mục 10).

Nơi lưu cấu hình, chọn bằng `--scope` (`-s`):

| Scope | Lưu ở | Dùng khi |
|---|---|---|
| `local` (mặc định) | `~/.claude.json`, gắn với thư mục hiện tại | Chỉ mình dùng, chỉ trong thư mục này |
| `user` | `~/.claude.json` | Mình dùng ở mọi thư mục |
| `project` | `.mcp.json` trong thư mục hiện tại | Commit cho cả team (mục 3.3) |

### 3.2. Cách 2: OAuth (không cần API key)

Không truyền `--header`:

```bash
claude mcp add --transport http outline http://localhost:3500/mcp
```

`claude mcp list` lúc này báo `! Needs authentication`. Trong phiên `claude`:

1. Gõ `/mcp`, chọn `outline`, chọn **Authenticate**.
2. Trình duyệt mở trang của Outline (đăng nhập trước nếu chưa): *"<tên ứng dụng> wants to access Outline"*, kèm hai
   quyền *Read all data*, *Write all data*. Bấm **Authorize**.
3. Trình duyệt chuyển về Claude Code, server chuyển sang trạng thái kết nối.

Phía sau: Claude Code đọc header `WWW-Authenticate` mà `/mcp` trả về khi chưa đăng nhập, tự đăng ký một OAuth client
với Outline (dynamic client registration, PKCE), rồi đổi code lấy token. Token sống 1 giờ và được làm mới bằng
refresh token. Ứng dụng đã cấp quyền hiện trong **Settings → API & Access → Application access**, thu hồi ở đó.

Các bước này đã được thử thủ công đúng thứ tự Claude Code làm: đăng ký client, trang *Authorize* ở trên, đổi code lấy
token (`expires_in: 3600`, `scope: read write`), gọi `/mcp` bằng token thấy đủ 20 tool. Màn hình `/mcp` của Claude
Code thì chưa chạy, vì môi trường thử không tương tác được.

Có header `Authorization` trong cấu hình thì Claude Code **không** chuyển sang OAuth: key sai là báo lỗi luôn.

### 3.3. Dùng chung cho cả team: `.mcp.json`

```bash
claude mcp add --scope project --transport http outline http://localhost:3500/mcp --header 'Authorization: Bearer ${OUTLINE_API_KEY}'
```

Lệnh tạo file `.mcp.json` trong thư mục hiện tại, commit được vì không chứa key:

```json
{
  "mcpServers": {
    "outline": {
      "type": "http",
      "url": "http://localhost:3500/mcp",
      "headers": {
        "Authorization": "Bearer ${OUTLINE_API_KEY}"
      }
    }
  }
}
```

Mỗi người tự đặt `OUTLINE_API_KEY` bằng key của mình (mục 2). Lần đầu mở `claude` trong thư mục đó, Claude Code hỏi
có dùng server khai báo trong `.mcp.json` không; trước khi đồng ý, `claude mcp list` hiện
`⏸ Pending approval (run claude to approve)`. Production thì thay URL bằng tên miền thật, ví dụ
`https://wiki.congty.vn/mcp`.

### 3.4. Kiểm tra

```bash
claude mcp list
```

```
outline: http://localhost:3500/mcp (HTTP) - ✔ Connected
```

| Lệnh | Tác dụng |
|---|---|
| `claude mcp list` | Trạng thái mọi server: `✔ Connected`, `! Needs authentication`, `⏸ Pending approval`, `✘ Failed to connect` |
| `claude mcp get outline` | Chi tiết một server: scope, URL, header (key bị che) |
| `/mcp` (trong phiên `claude`) | Xem trạng thái, đăng nhập OAuth, xem danh sách tool |
| `claude mcp remove outline -s local` | Gỡ server (đổi `-s` theo scope đã thêm) |

### 3.5. Quyền tool và chạy không tương tác (`claude -p`)

Mỗi lần Claude gọi tool Outline, Claude Code hỏi xác nhận. Cho phép sẵn các tool chỉ đọc trong
`.claude/settings.json` (hoặc `settings.local.json`); các tool ghi vẫn để hỏi:

```json
{
  "permissions": {
    "allow": [
      "mcp__outline__list_collections",
      "mcp__outline__list_documents",
      "mcp__outline__list_collection_documents",
      "mcp__outline__fetch"
    ]
  }
}
```

Viết `"mcp__outline"` là cho phép mọi tool của server, kể cả xoá. Không nên.

Chạy một câu hỏi không tương tác (đã chạy thật với stack của thư mục này):

```bash
claude -p "Dùng Outline MCP: liệt kê tên các collection, rồi tìm tài liệu có chữ 'deploy' và cho biết tiêu đề cùng số việc trong checklist đã xong. Trả lời ngắn gọn bằng tiếng Việt." \
  --allowedTools "mcp__outline__list_collections,mcp__outline__list_documents,mcp__outline__fetch"
```

Các tool Claude đã gọi, theo thứ tự:

```
ToolSearch                      {"query":"select:mcp__outline__list_collections,..."}   nạp schema tool MCP
mcp__outline__list_collections  {"limit":100}
mcp__outline__list_documents    {"query":"deploy","limit":25}
```

Kết quả:

```
**Collection:** Kỹ thuật, Welcome

**Tài liệu có chữ "deploy":** "Quy trình deploy" (thuộc collection Kỹ thuật). Checklist đã xong **1/2 việc**.
```

`ToolSearch` ở đầu là bình thường: khi có nhiều MCP server, Claude Code chỉ nạp schema của tool khi cần.

---

## 4. Claude Desktop

Phần cấu hình cục bộ của Claude Desktop chạy MCP server dạng **lệnh (stdio)**, nên nối tới Outline qua gói
[`mcp-remote`](https://www.npmjs.com/package/mcp-remote): Claude Desktop chạy `mcp-remote` như một server stdio,
`mcp-remote` chuyển tiếp sang `http://localhost:3500/mcp`. Cần Node.js (lệnh `npx`).

1. Mở file cấu hình (Claude Desktop → **Settings → Developer → Edit Config**):
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
2. Thêm server `outline` (giữ nguyên các server khác nếu có):

   ```json
   {
     "mcpServers": {
       "outline": {
         "command": "npx",
         "args": [
           "-y",
           "mcp-remote@latest",
           "http://localhost:3500/mcp",
           "--header",
           "Authorization:${AUTH_HEADER}"
         ],
         "env": {
           "AUTH_HEADER": "Bearer ol_api_xxxxxxxxxxxxxxxx"
         }
       }
     }
   }
   ```

3. Thoát hẳn Claude Desktop (cả biểu tượng ở khay hệ thống) rồi mở lại.

`Authorization:${AUTH_HEADER}` cố ý **không có dấu cách** quanh dấu hai chấm, phần `Bearer ...` có dấu cách nằm trong
`env`. README của `mcp-remote` giải thích: Claude Desktop trên Windows (cả Cursor, Codex CLI) không escape dấu cách
trong `args` khi gọi `npx`, nên giá trị có dấu cách bị cắt hỏng. `mcp-remote` tự thay `${AUTH_HEADER}` bằng giá trị
trong `env`.

Không muốn để key trong file cấu hình: thay cặp `--header` bằng `"--header-file", "C:\\path\\outline-headers.txt"`,
file đó ghi mỗi dòng một header dạng `Authorization: Bearer ol_api_...` (theo README của `mcp-remote`, chưa thử).

Đã thử đúng lệnh trong ví dụ như Claude Desktop sẽ chạy (stdio): `initialize` trả về `outline 1.13.0`, `tools/list`
đủ 20 tool. Bản thân ứng dụng Claude Desktop chưa thử vì máy thử không cài.

Cấu hình này là MCP server **cục bộ** của Claude Desktop, kết nối từ chính máy bạn nên dùng được `localhost`. Connector
thêm qua tài khoản claude.ai (mục 5) cũng hiện trong Claude Desktop nhưng là cơ chế khác, chạy từ máy chủ Anthropic.

---

## 5. claude.ai: custom connector

Theo trang trợ giúp của Claude (mục 11), custom connector được **máy chủ của Anthropic** kết nối tới MCP server, không
phải máy của bạn, trên mọi ứng dụng: claude.ai, Claude Desktop, Cowork, mobile. MCP server phải truy cập được từ
Internet qua HTTPS ở **cổng 443**. Vì vậy cả `http://localhost:3500/mcp` lẫn kiểu `https://ten-mien:3500/mcp` đều
không dùng được: đặt Outline sau reverse proxy có tên miền và HTTPS (README mục 13), `URL=https://wiki.congty.vn`
trong `.env`, địa chỉ MCP là `https://wiki.congty.vn/mcp`.

Gói Pro, Max (và Free, Ultra; Free chỉ được một custom connector):

1. claude.ai → **Customize → Connectors** → **+ Add** → **Add custom connector**.
2. Name `Outline`, URL `https://wiki.congty.vn/mcp` (đủ cả đường dẫn `/mcp`) → **Continue**. Xem phần xác thực Claude
   tự nhận ra → **Continue**.
3. **Authentication**: chọn *Sign in now*. **OAuth client**: giữ *Use Claude's published identity (Recommended)* hoặc
   chọn *Register automatically*; Outline nhận cả hai kiểu (metadata OAuth của Outline có
   `client_id_metadata_document_supported: true` và `registration_endpoint`). → **Add**.
4. Đăng nhập Outline nếu được hỏi, trang *Authorize* như mục 3.2 → **Authorize**.
5. Trong cuộc trò chuyện: nút **+** góc dưới bên trái → **Connectors** → bật `Outline`, rồi hỏi như mục 8.

Gói Team, Enterprise: Owner thêm connector ở **Organization settings → Connectors → Add → Custom → Web** với các bước
như trên; từng thành viên vào **Customize → Connectors**, tìm connector và bấm **Connect** để đăng nhập Outline bằng
tài khoản của mình.

Bước 3 còn có mục **Request headers** để gửi cố định `Authorization: Bearer ol_api_...` thay cho OAuth. Với connector
của tổ chức, mọi người dùng chung key đó, tức chung quyền của tài khoản tạo key: nên dùng OAuth.

Ứng dụng đã cấp quyền hiện trong **Settings → API & Access → Application access** của Outline, thu hồi ở đó. Chưa
thử, vì Outline của demo chỉ chạy ở `localhost`; các bước trên lấy từ trang trợ giúp của Claude.

---

## 6. Claude API: MCP connector

Dùng khi code của bạn gọi Claude API và muốn Claude dùng thẳng tool của Outline: Anthropic kết nối tới MCP server
phía máy chủ, code không phải tự chạy vòng lặp tool. Theo tài liệu MCP connector: URL phải bắt đầu bằng `https://` và
server phải mở ra Internet (như mục 5), không nối được server stdio cục bộ, và chỉ dùng được tool của server.

Cần hai phần đi cùng nhau, cùng beta `mcp-client-2025-11-20`: `mcp_servers` khai báo server, `tools` có một mục
`mcp_toolset` trỏ tới đúng `name` đó. Ví dụ dưới chỉ bật 3 tool đọc (`default_config` tắt hết, `configs` bật từng
tool). Anthropic gửi `authorization_token` làm Bearer token, mà `/mcp` của Outline nhận cả API key lẫn OAuth token
(mục 1), nên dùng thẳng API key, tốt nhất key scope `read` (mục 2):

```bash
# Cần ANTHROPIC_API_KEY, OUTLINE_API_KEY và jq. jq dựng JSON để key không phải nối chuỗi bằng tay.
response=$(jq -n --arg key "$OUTLINE_API_KEY" '{
  model: "claude-opus-5-5",
  max_tokens: 16000,
  fallbacks: "default",
  mcp_servers: [{
    type: "url",
    url: "https://wiki.congty.vn/mcp",
    name: "outline",
    authorization_token: $key
  }],
  tools: [{
    type: "mcp_toolset",
    mcp_server_name: "outline",
    default_config: {enabled: false},
    configs: {
      list_collections: {enabled: true},
      list_documents: {enabled: true},
      fetch: {enabled: true}
    }
  }],
  messages: [{role: "user", content: "Tìm tài liệu về quy trình deploy trong Outline và tóm tắt các bước."}]
}' | curl -s https://api.anthropic.com/v1/messages \
  -H "Content-Type: application/json" \
  -H "x-api-key: $ANTHROPIC_API_KEY" \
  -H "anthropic-version: 2023-06-01" \
  -H "anthropic-beta: mcp-client-2025-11-20,server-side-fallback-2026-07-01" \
  -d @-)

echo "$response" | jq -r '.stop_reason'                                                # "refusal" là bị bộ lọc an toàn từ chối
echo "$response" | jq -c '.content[] | select(.type == "mcp_tool_use") | {name, input}'  # các tool Claude đã gọi
echo "$response" | jq -r '.content[] | select(.type == "text") | .text'                 # câu trả lời
```

- `fallbacks: "default"` (beta `server-side-fallback-2026-07-01`): nếu bộ lọc an toàn của model từ chối, Anthropic
  tự chạy lại yêu cầu trên model được khuyên dùng cho loại từ chối đó. Không muốn thì bỏ cả trường lẫn beta này.
- Luôn xem `stop_reason` trước khi đọc `content`. Lượt gọi tool nằm trong các block `mcp_tool_use` và
  `mcp_tool_result` của `content`.
- Chưa thử gửi: Outline của demo không có URL public, máy thử cũng không có API key Anthropic. Khuôn request lấy theo
  tài liệu MCP connector (mục 11); phần `jq -n` dựng JSON thì đã chạy thử ra đúng body như trên.

---

## 7. Các tool Claude dùng được

Lấy từ `tools/list` của Outline 1.13.0. Cột *Key `read`* là tool còn lại khi key có scope `read`.

| Tool | Key `read` | Làm gì |
|---|---|---|
| `list_collections` | có | Danh sách collection user được xem |
| `list_documents` | có | Tìm toàn văn khi có `query`, không có thì liệt kê tài liệu gần đây; lọc theo `collectionId` |
| `list_collection_documents` | có | Cây tài liệu đã đăng của một collection |
| `fetch` | có | Lấy document, collection, user, attachment hoặc template theo ID. `current_user` là chính mình; attachment trả về link tải có hạn |
| `get_document_changes` | có | Tài liệu đổi gì giữa hai thời điểm và ai sửa (diff Markdown) |
| `list_comments` | có | Bình luận của một tài liệu hoặc collection |
| `list_templates` | có | Mẫu tài liệu |
| `list_users` | có | Thành viên workspace (lấy id để nhắc tên) |
| `create_document` | | Tạo tài liệu từ Markdown/HTML trong một collection, dưới một tài liệu cha, hoặc `collectionId: "personal"` (chỉ mình thấy) |
| `update_document` | | Sửa tài liệu. Nên dùng `editMode: "patch"` (`findText` + `text`) để chỉ thay đoạn cần sửa; `"replace"` ghi đè cả tài liệu, mất định dạng Markdown không biểu diễn được |
| `move_document` | | Chuyển chỗ hoặc đổi thứ tự |
| `delete_document` | | Đưa vào Trash, khôi phục được |
| `restore_document` | | Khôi phục tài liệu đã archive hoặc trong Trash |
| `create_collection` | | Tạo collection |
| `update_collection` | | Sửa collection |
| `delete_collection` | | Xoá collection **và các tài liệu chưa archive trong đó**; `archive: true` để archive thay vì xoá |
| `create_comment` | | Bình luận vào tài liệu (Markdown) |
| `update_comment` | | Sửa, resolve hoặc mở lại bình luận |
| `delete_comment` | | Xoá bình luận |
| `create_attachment` | | Xin link upload để tải file lên |

---

## 8. Prompt mẫu

Prompt đầu tiên là bản rút gọn của câu đã chạy thật ở mục 3.5; các prompt còn lại là gợi ý theo danh sách tool ở
mục 7.

| Prompt | Tool chính |
|---|---|
| "Liệt kê các collection, rồi tìm tài liệu có chữ 'deploy' và cho biết checklist đã xong mấy việc." | `list_collections`, `list_documents` |
| "Cho xem cây tài liệu của collection Kỹ thuật." | `list_collection_documents` |
| "Tài liệu *Quy trình deploy* thay đổi gì trong hôm nay, ai sửa?" | `get_document_changes` |
| "Tạo tài liệu *Checklist release 1.2* trong collection Kỹ thuật, gồm các bước: ..." | `create_document` |
| "Trong *Quy trình deploy*, sửa bước 2 thành 'Tag phiên bản và ghi changelog'. Dùng patch, không ghi đè cả tài liệu." | `update_document` |
| "Bình luận vào *Quy trình deploy*, nhắc @Member Demo kiểm tra lại bước backup." | `list_users`, `create_comment` |
| "Đọc `README.md` của thư mục này rồi tạo tài liệu tương ứng trong collection Kỹ thuật." (Claude Code) | đọc file + `create_document` |

Mẹo: gọi tên collection và tài liệu như trong Outline; với tài liệu nhiều người sửa, bảo Claude xem
`get_document_changes` trước rồi mới sửa.

---

## 9. Bảo mật

- **Claude có đúng quyền của tài khoản đã cấp key hoặc bấm Authorize.** Muốn Claude chỉ đọc: key scope `read` (tool
  ghi biến mất hẳn), hoặc cấp key từ tài khoản vai trò Viewer.
- **Không commit key.** `.mcp.json` dùng `${OUTLINE_API_KEY}`. Cấu hình `local`/`user` của Claude Code và file của
  Claude Desktop lưu key không mã hoá trên máy.
- **Đặt Expiration cho key**, thu hồi ngay khi không dùng: **Settings → API & Access** (*Personal keys* cho API key,
  *Application access* cho ứng dụng OAuth).
- **Nội dung wiki có thể chứa chỉ dẫn độc hại** (prompt injection), nhất là tài liệu người khác viết hoặc nhập từ
  ngoài. Đừng cho phép sẵn các tool ghi và xoá (mục 3.5); để Claude Code hỏi trước mỗi lần.
- **Tắt hẳn MCP** cho cả workspace: **Settings → AI → MCP server** → tắt, `/mcp` trả `404`.
- Mục 5, 6 cần Outline nghe trên Internet: chỉ dùng HTTPS, xem thêm README mục 13.

---

## 10. Xử lý sự cố

| Hiện tượng | Nguyên nhân | Sửa |
|---|---|---|
| `✘ Failed to connect — Server rejected the configured Authorization header (HTTP 401) ... "message":"Unable to decode token"` | Key sai, hết hạn, bị thu hồi, hoặc `${OUTLINE_API_KEY}` đang trống | Kiểm tra key ở **Settings → API & Access**, đặt lại biến môi trường, mở terminal mới |
| `[Warning] [outline] mcpServers.outline: Missing environment variables: OUTLINE_API_KEY` | `.mcp.json` dùng biến chưa đặt | Đặt `OUTLINE_API_KEY` (mục 2) |
| `! Needs authentication` | Cấu hình OAuth chưa đăng nhập | `/mcp` → `outline` → **Authenticate** |
| `⏸ Pending approval (run claude to approve)` | Server trong `.mcp.json` chưa được duyệt | Mở `claude` trong thư mục đó, đồng ý dùng server |
| `Tool create_document not found` | Key có scope `read` | Dùng key không giới hạn scope nếu thật sự cần ghi |
| `/mcp` trả `404 Resource not found` | MCP server đang tắt | **Settings → AI → MCP server** → bật |
| `405 Method not allowed. Use POST for MCP requests.` hoặc `404 Not found. MCP requests must be sent to /mcp.` | Client dùng transport SSE kiểu cũ, hoặc sai đường dẫn | `--transport http`, URL kết thúc bằng `/mcp` |
| `403 Invalid Origin: ...` (theo mã nguồn) | Request gửi từ một trang web khác origin của Outline | Chỉ gặp với client chạy trong trình duyệt; Claude Code, Claude Desktop không gặp |
| `429` (theo mã nguồn) | Quá 1000 request mỗi giờ | Đợi, hoặc hỏi gọn hơn để Claude gọi ít tool hơn |
| claude.ai hoặc Claude API không kết nối được | Dùng `localhost`, Outline không có HTTPS public, hoặc (claude.ai) không ở cổng 443 | Mục 5, 6 |
| Đổi cổng hoặc tên miền xong mất kết nối | Địa chỉ MCP đi theo `URL` trong `.env` | Lấy lại địa chỉ ở **Settings → AI**, sửa cấu hình Claude |

---

## 11. Tham khảo

- [Outline: hướng dẫn kết nối MCP](https://docs.getoutline.com/s/guide/doc/mcp-6j9jtENNKL) (link *setup guide* trong
  **Settings → AI**)
- [Claude Code: kết nối MCP server](https://code.claude.com/docs/en/mcp)
- [Claude Code: quyền (permissions)](https://code.claude.com/docs/en/permissions) ·
  [Settings](https://code.claude.com/docs/en/settings) · [CLI reference](https://code.claude.com/docs/en/cli-reference)
- [Claude API: MCP connector](https://platform.claude.com/docs/en/agents-and-tools/mcp-connector)
- [Claude Help Center: custom connector dùng remote MCP](https://support.claude.com/en/articles/11175166-get-started-with-custom-connectors-using-remote-mcp)
  · [MCP server cục bộ trên Claude Desktop](https://support.claude.com/en/articles/10949351-getting-started-with-local-mcp-servers-on-claude-desktop)
- [mcp-remote](https://github.com/punkpeye/mcp-remote) ([npm](https://www.npmjs.com/package/mcp-remote))
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- Ví dụ MCP khác trong repo này: [Playwright MCP với Claude Code](../151_playwright/CLAUDE_MCP.md)
