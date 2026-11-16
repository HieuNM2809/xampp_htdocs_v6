# Outline — wiki/knowledge base tự host bằng Docker

Đây là ví dụ hoàn chỉnh để tự host **Outline** bằng **Docker Compose**. Outline là wiki/knowledge base mã
nguồn mở cho đội nhóm: nhiều người soạn cùng lúc, gõ Markdown, phân quyền theo collection, tìm kiếm toàn
văn. Ngoài Outline và hai dịch vụ bắt buộc (**PostgreSQL**, **Redis**), demo chạy thêm **Dex** (nhà cung
cấp OpenID Connect) để đăng nhập ngay trên máy mà không cần tài khoản Google/Slack, và **Mailpit** để xem
các email Outline gửi. README đi lần lượt từng bước: cấu hình `.env`, khởi chạy, migration, đăng nhập lần
đầu, các thao tác cơ bản (collection, tài liệu, mời thành viên) và backup/restore. Cuối README có phần xử lý
sự cố.

```
 Trình duyệt ──► http://localhost:3500   Outline: giao diện web, API, WebSocket (soạn thảo realtime)
             ──► http://localhost:5556   Dex: trang đăng nhập (OpenID Connect)
             ──► http://localhost:8025   Mailpit: hộp thư chứa mọi email Outline gửi

 ┌──────── project outline-wiki (docker-compose.yml): network riêng, gọi nhau bằng tên service ─────────┐
 │                                                                                                      │
 │  outline :3000 ── SQL ────────────────────► postgres :5432   tài liệu, user, phân quyền, lịch sử     │
 │  (Node.js)     ── ioredis ────────────────► redis :6379      hàng đợi job, cache, đồng bộ realtime   │
 │                ── HTTP: token, userinfo ──► dex :5556        OIDC, 2 tài khoản thử                   │
 │                ── SMTP ───────────────────► mailpit :1025    giữ lại mọi email (giao diện :8025)     │
 │                ── ghi file ───────────────► volume outline-data   ảnh, file đính kèm                 │
 │                                                                                                      │
 └──────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

Viết ngày 16/11/2026 cho các phiên bản:

| Thành phần | Image | Phiên bản |
|---|---|---|
| Outline | `docker.getoutline.com/outlinewiki/outline` | 1.13.0 (phát hành 15/11/2026) |
| PostgreSQL | `postgres` | 18 |
| Redis | `redis` | 8 (alpine) |
| Dex | `ghcr.io/dexidp/dex` | v2.46.1 |
| Mailpit | `axllent/mailpit` | v1.33.1 |

> **Mức độ kiểm chứng.** Cấu hình được đối chiếu trực tiếp với mã nguồn của đúng các phiên bản trên: biến
> môi trường (`server/env.ts` và `plugins/*/server/env.ts` của Outline 1.13.0), luồng đăng nhập OIDC, cơ chế
> migration, các trang Settings, định dạng cấu hình của Dex v2.46.1. `docker compose config` chạy hợp lệ
> trên Docker Compose v2.40.3. **Chưa chạy end-to-end**: lúc viết, Docker Desktop trên máy thử bị treo vì ổ
> C: hết chỗ (mục 11.10). Chỗ nào log thật khác README thì tin log và sửa README theo.

---

## Mục lục

1. [Chạy nhanh](#1-chạy-nhanh)
2. [Các thành phần và luồng đăng nhập](#2-các-thành-phần-và-luồng-đăng-nhập)
3. [Cấu trúc thư mục](#3-cấu-trúc-thư-mục)
4. [Yêu cầu](#4-yêu-cầu)
5. [Bước 1: Cấu hình môi trường (.env)](#5-bước-1-cấu-hình-môi-trường-env)
6. [Bước 2: Khởi chạy, dừng và xem log](#6-bước-2-khởi-chạy-dừng-và-xem-log)
7. [Bước 3: Migration database](#7-bước-3-migration-database)
8. [Bước 4: Truy cập giao diện web và đăng nhập lần đầu](#8-bước-4-truy-cập-giao-diện-web-và-đăng-nhập-lần-đầu)
9. [Bước 5: Sử dụng cơ bản](#9-bước-5-sử-dụng-cơ-bản)
10. [Backup và restore dữ liệu](#10-backup-và-restore-dữ-liệu)
11. [Xử lý sự cố](#11-xử-lý-sự-cố)
12. [Dọn dẹp](#12-dọn-dẹp)
13. [Lưu ý khi đưa lên production](#13-lưu-ý-khi-đưa-lên-production)
14. [Tham khảo](#14-tham-khảo)

---

## 1. Chạy nhanh

```bash
# 1) Tạo .env từ file mẫu
cp .env.example .env                 # PowerShell: Copy-Item .env.example .env

# 2) Sinh 2 khoá bí mật và điền thẳng vào .env (Git Bash / Linux; macOS dùng: sed -i '' ...)
#    PowerShell: xem mục 5.2
sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$(openssl rand -hex 32)/; s/^UTILS_SECRET=.*/UTILS_SECRET=$(openssl rand -hex 32)/" .env

# 3) Chạy. Lần đầu tải khoảng 520 MB image; Outline tự tạo bảng trong PostgreSQL
docker compose up -d
docker compose ps                    # chờ outline, postgres, redis hiện (healthy)

# 4) Mở http://localhost:3500 → Continue with Dex → admin@example.com / password
```

| Cổng (máy host) | Thành phần |
|---|---|
| 3500 | Outline: giao diện web, API, WebSocket (cổng 3000 trong container) |
| 5556 | Dex: trang đăng nhập OIDC, trình duyệt phải mở được |
| 8025 | Mailpit: xem email Outline gửi |
| (không mở) | PostgreSQL 5432, Redis 6379, SMTP 1025 của Mailpit: chỉ dùng bên trong network của project |

Tài khoản thử, khai báo trong [`dex/config.yaml`](dex/config.yaml):

| Email | Mật khẩu | Dùng để |
|---|---|---|
| `admin@example.com` | `password` | Đăng nhập **đầu tiên**: người đầu tiên vào Outline thành **Admin** của workspace |
| `member@example.com` | `password` | Thử mời thành viên (mục 9.3) |

> Cổng mặc định là **3500**, cố ý tránh 3000 vì lý do giống demo `150_nodejs_signoz`: máy dev Node thường đã
> có app khác chiếm 3000, và Docker Desktop trên Windows có khi lặng lẽ bỏ qua việc mở cổng mà không báo lỗi
> (mục 11.8).

---

## 2. Các thành phần và luồng đăng nhập

### 2.1 Năm service

| Service | Vai trò | Dữ liệu |
|---|---|---|
| `outline` | Web + API + WebSocket. Một container chạy cả 4 dịch vụ con mặc định: `web`, `collaboration` (soạn thảo realtime), `websockets`, `worker` (job chạy nền) | volume `outline-data`: ảnh, file đính kèm |
| `postgres` | Dữ liệu chính: tài liệu (cả trạng thái soạn thảo realtime), collection, user, phân quyền, lịch sử sửa đổi. Tìm kiếm toàn văn cũng chạy trên PostgreSQL | volume `postgres-data` |
| `redis` | Hàng đợi job (gửi email, xuất dữ liệu...), cache, trao đổi giữa các process | volume `redis-data` (dữ liệu tạm) |
| `dex` | Nhà cung cấp OpenID Connect đóng vai "SSO của công ty", 2 tài khoản tĩnh | không, giữ trong RAM |
| `mailpit` | Nhận mọi email qua SMTP (cổng 1025), hiển thị trên web (cổng 8025) | database tạm, restart là mất |

Ngoài ra có service `backup` (image alpine) chỉ chạy khi gọi tên, dùng để backup/restore file đính kèm
(mục 10). `docker compose up` không chạy nó.

### 2.2 Luồng đăng nhập qua Dex (OIDC)

```
 Trình duyệt                        outline (container)                    dex (container)

 ① Continue with Dex ────────────►  GET /auth/oidc
   ◄──── 302 → http://localhost:5556/dex/auth?client_id=outline&redirect_uri=…
 ② trang đăng nhập Dex ─────────────────────────────────────────────────►  qua cổng 5556 của máy host
   admin@example.com / password
   ◄──── 302 → http://localhost:3500/auth/oidc.callback?code=…&state=…
 ③ GET /auth/oidc.callback ──────►  ④ POST http://dex:5556/dex/token ───►  đổi code lấy token
                                    ⑤ GET  http://dex:5556/dex/userinfo ►  email, name, email_verified
                                    ⑥ tạo workspace (lần đầu) và user, đặt cookie đăng nhập
   ◄──── 302 → /home: đã đăng nhập
```

Cùng một Dex nhưng có **hai địa chỉ**, tuỳ ai gửi request:

| Bước | Ai gửi request | Địa chỉ của Dex | Biến trong `.env` |
|---|---|---|---|
| ② | Trình duyệt trên máy host | `http://localhost:5556/dex/auth` | `OIDC_AUTH_URI` |
| ④ | Server Outline, trong container | `http://dex:5556/dex/token` | `OIDC_TOKEN_URI` |
| ⑤ | Server Outline, trong container | `http://dex:5556/dex/userinfo` | `OIDC_USERINFO_URI` |

Ba điểm đáng nhớ:

- **Outline không có mật khẩu riêng.** Luôn đăng nhập qua một nhà cung cấp (OIDC, Google, Slack,
  Microsoft...), hoặc bằng link/mã gửi qua email (cần SMTP), hoặc bằng passkey tạo sau khi đã đăng nhập. Dex
  ở đây thay cho SSO của công ty.
- **`localhost` trong container là chính container đó.** Server Outline gọi `http://localhost:5556` sẽ bị
  `ECONNREFUSED`, nên bước ④⑤ dùng tên service `dex`. Issuer của Dex vẫn là `http://localhost:5556/dex`
  mà không sao: Outline chỉ đọc nội dung `id_token`, không đối chiếu issuer
  (`plugins/oidc/server/auth/oidcRouter.ts`).
- **Ai đăng nhập qua SSO thành công là vào được workspace**, với vai trò mặc định (*Default role*). Bản
  tự host không có công tắc *Require invites* (công tắc này chỉ hiện ở bản cloud). Muốn giới hạn người vào
  thì cấp tài khoản ở IdP có chọn lọc và dùng *Allowed domains* (mục 9.3).

---

## 3. Cấu trúc thư mục

```
152_outline/
├── README.md               hướng dẫn: cấu hình, chạy, migration, sử dụng, backup/restore, xử lý sự cố
├── docker-compose.yml      outline + postgres + redis + dex + mailpit, kèm service "backup" chạy theo yêu cầu
├── .env.example            mẫu biến môi trường (có chú thích), copy thành .env
├── .gitignore              bỏ qua .env và các file trong backups/
├── dex/
│   └── config.yaml         cấu hình Dex: client "outline" và 2 tài khoản thử
└── backups/                nơi chứa file backup (pg_dump + nén file đính kèm), gắn vào container
    └── .gitkeep
```

Ba volume do Docker quản lý (xem bằng `docker volume ls`): `outline-wiki_outline-data`,
`outline-wiki_postgres-data`, `outline-wiki_redis-data`. Tiền tố `outline-wiki` là tên project, đặt ở dòng
`name:` trong `docker-compose.yml`.

---

## 4. Yêu cầu

- **Docker** có **Compose v2**: Docker Desktop trên Windows/macOS, Docker Engine trên Linux. Kiểm tra bằng
  `docker compose version` (máy viết tài liệu: v2.40.3; cần bản hỗ trợ `depends_on: condition` và
  `profiles`, tức mọi bản Compose v2 hiện hành).
- **RAM cho Docker ≥ 2 GB.** Outline ước khoảng 512 MB cho mỗi process web (`WEB_CONCURRENCY=1`), cộng
  PostgreSQL, Redis, Dex, Mailpit.
- **Ổ đĩa:** image tải về khoảng 520 MB (dạng nén: Outline 257 MB, PostgreSQL 161 MB, phần còn lại
  khoảng 100 MB) và chiếm nhiều hơn sau khi giải nén. Trên Windows, dữ liệu Docker nằm ở ổ C:; ổ đầy làm
  Docker và WSL treo (mục 11.10).
- **Các cổng trống:** 3500, 5556, 8025 (đổi được trong `.env`).
- Một trong các công cụ để sinh khoá bí mật: `openssl` (có sẵn trong Git Bash, macOS, Linux), Node.js, hoặc
  PowerShell.

---

## 5. Bước 1: Cấu hình môi trường (.env)

### 5.1 Tạo file `.env`

```bash
cp .env.example .env              # PowerShell: Copy-Item .env.example .env
```

File `.env` được dùng cho **hai việc**:

1. `docker compose` tự đọc `.env` cùng thư mục để thay các biến `${...}` trong `docker-compose.yml`: phiên
   bản image, cổng mở ra máy host, user/mật khẩu PostgreSQL.
2. Dòng `env_file: .env` của service `outline` nạp **toàn bộ** file làm biến môi trường của Outline.

Mọi biến trong [`.env.example`](.env.example) đều có chú thích. Trên máy cá nhân chỉ **bắt buộc** sửa hai
biến ở mục 5.2.

### 5.2 Sinh `SECRET_KEY` và `UTILS_SECRET`

| Biến | Yêu cầu | Dùng để |
|---|---|---|
| `SECRET_KEY` | **Đúng 64 ký tự hex** (32 byte ngẫu nhiên) | Ký phiên đăng nhập và **mã hoá** một số dữ liệu trong database |
| `UTILS_SECRET` | Chuỗi ngẫu nhiên bất kỳ, không được trống | Bảo vệ endpoint nội bộ dùng để kích hoạt tác vụ định kỳ |

Sinh rồi điền thẳng vào `.env`:

```bash
# Git Bash / Linux (macOS: sed -i '' "...")
sed -i "s/^SECRET_KEY=.*/SECRET_KEY=$(openssl rand -hex 32)/; s/^UTILS_SECRET=.*/UTILS_SECRET=$(openssl rand -hex 32)/" .env
```

```powershell
# PowerShell 5.1 / 7: sinh bằng bộ sinh số ngẫu nhiên mật mã của .NET, ghi lại .env dạng UTF-8 không BOM
$k = { $b = [byte[]]::new(32); [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); -join ($b | ForEach-Object { $_.ToString('x2') }) }
$t = [IO.File]::ReadAllText("$PWD\.env") -replace '(?m)^SECRET_KEY=.*$', "SECRET_KEY=$(& $k)" -replace '(?m)^UTILS_SECRET=.*$', "UTILS_SECRET=$(& $k)"
[IO.File]::WriteAllText("$PWD\.env", $t)
```

Muốn tự dán bằng tay thì chạy hai lần một trong các lệnh dưới, mỗi biến một giá trị:

```bash
openssl rand -hex 32
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Kiểm tra: `grep -E "^(SECRET_KEY|UTILS_SECRET)=" .env` (PowerShell: `Select-String '^(SECRET_KEY|UTILS_SECRET)=' .env`)
phải ra hai dòng, mỗi dòng 64 ký tự `0-9a-f` sau dấu `=`.

> **Đừng đổi `SECRET_KEY` sau khi đã dùng thật.** Đổi thì mọi người bị đăng xuất, còn dữ liệu đã mã hoá
> bằng khoá cũ không đọc lại được. Cất `.env` ở nơi an toàn (password manager...) và backup nó cùng database
> (mục 10.1).

### 5.3 Các biến quan trọng

| Biến | Giá trị mẫu | Ý nghĩa |
|---|---|---|
| `OUTLINE_VERSION` | `1.13.0` | Phiên bản image Outline, đổi khi nâng cấp (mục 7.4) |
| `OUTLINE_PORT` | `3500` | Cổng máy host, trỏ vào cổng 3000 trong container |
| `URL` | `http://localhost:3500` | Địa chỉ đầy đủ người dùng gõ trên trình duyệt. Dùng cho link trong email, callback đăng nhập, WebSocket |
| `PORT` | `3000` | Cổng Outline nghe **trong** container. Giữ nguyên |
| `FORCE_HTTPS` | `false` | Phải là `false` khi chạy http; `true` khi có HTTPS (mục 13) |
| `SECRET_KEY`, `UTILS_SECRET` | tự sinh | Mục 5.2 |
| `POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB` | `outline` / `doi-mat-khau-nay` / `outline` | Container postgres tạo user và database theo các biến này ở **lần chạy đầu** |
| `DATABASE_URL` | `postgres://outline:doi-mat-khau-nay@postgres:5432/outline` | Chuỗi kết nối của Outline, **phải khớp** `POSTGRES_*`. Host `postgres` là tên service |
| `PGSSLMODE` | `disable` | PostgreSQL trong compose không bật SSL. Thiếu thì Outline đòi SSL và dừng (mục 11.1) |
| `REDIS_URL` | `redis://redis:6379` | Host `redis` là tên service |
| `FILE_STORAGE` | `local` | Lưu file đính kèm vào volume. Mặc định của Outline là `s3`, nên phải đặt rõ |
| `OIDC_*` | trỏ tới Dex | Mục 2.2 và 5.4 |
| `SMTP_*` | trỏ tới Mailpit | Mục 5.5 |
| `DEFAULT_LANGUAGE` | `en_US` | Có `vi_VN` (đã dịch khoảng 60%); mỗi người tự đổi ở *Settings → Preferences* |
| `ENABLE_UPDATES` | `false` | `true`: gửi thống kê ẩn danh cho nhóm phát triển Outline để kiểm tra bản mới |

Các giá trị đi theo cặp, **đổi một chỗ phải đổi chỗ còn lại**:

| Muốn đổi | Sửa trong `.env` | Sửa trong `dex/config.yaml` |
|---|---|---|
| Cổng của Outline | `OUTLINE_PORT`, `URL` | `redirectURIs` |
| Cổng của Dex | `DEX_PORT`, `OIDC_AUTH_URI` | `issuer` |
| Client của Dex | `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | `staticClients[].id`, `secret` |
| Mật khẩu PostgreSQL | `POSTGRES_PASSWORD`, `DATABASE_URL` | không |

Sửa `.env` khi stack đang chạy thì áp dụng bằng `docker compose up -d`. Compose thấy cấu hình đổi nên tạo
lại container; `docker compose restart` **không** nạp lại `env_file`. Sửa `dex/config.yaml` thì chạy
`docker compose restart dex`.

### 5.4 Chọn phương thức đăng nhập

Cần **ít nhất một** phương thức. Bật nhiều phương thức cùng lúc thì trang đăng nhập có một nút cho mỗi
phương thức. Outline nhận ra cùng một người qua email (khi IdP xác nhận email đã được xác minh).

| Phương thức | Biến trong `.env` | Redirect URI khai báo ở nhà cung cấp | Ghi chú |
|---|---|---|---|
| OIDC với Dex (mặc định) | `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTH_URI`, `OIDC_TOKEN_URI`, `OIDC_USERINFO_URI` | `http://localhost:3500/auth/oidc.callback`, đã có trong `dex/config.yaml` | Chỉ để chạy thử |
| OIDC với IdP thật: Keycloak, Authentik, Authelia, GitLab... | `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET` | `<URL>/auth/oidc.callback` | Outline tự đọc `/.well-known/openid-configuration` lúc khởi động |
| Google | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | `<URL>/auth/google.callback` | Google chấp nhận `http://localhost` khi chạy thử |
| Slack | `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` | `<URL>/auth/slack.callback` | Slack chỉ nhận redirect **https**: cần tên miền có HTTPS hoặc tunnel (ngrok, cloudflared) |
| Microsoft Entra ID (Azure AD) | `AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, `AZURE_RESOURCE_APP_ID` | `<URL>/auth/azure.callback` | |
| Email (link/mã đăng nhập) | `SMTP_*` | không cần | Chỉ dùng cho người đã được mời hoặc đã có tài khoản (mục 5.5) |

**Ví dụ: thêm đăng nhập bằng Google**

1. Vào Google Cloud Console → **APIs & Services → Credentials → Create credentials → OAuth client ID**,
   loại **Web application** (lần đầu Google yêu cầu cấu hình OAuth consent screen).
2. **Authorized redirect URIs**: `http://localhost:3500/auth/google.callback`.
3. Trong `.env`, bỏ dấu `#` ở `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` rồi điền giá trị Google cấp.
4. `docker compose up -d`. Trang đăng nhập có thêm nút **Continue with Google**.

**Chuyển sang IdP OIDC thật** (Keycloak, Authentik...)

1. Ở IdP: tạo client kiểu *confidential* (có secret), redirect URI `<URL>/auth/oidc.callback`, scope
   `openid profile email`.
2. Trong `.env`: đặt `OIDC_ISSUER_URL`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_DISPLAY_NAME`, và
   **xoá** 3 dòng `OIDC_AUTH_URI`, `OIDC_TOKEN_URI`, `OIDC_USERINFO_URI` (còn đủ 3 dòng đó thì Outline dùng
   cấu hình thủ công và bỏ qua `OIDC_ISSUER_URL`). Đặt thêm `OIDC_LOGOUT_URI` (end session endpoint của IdP)
   để đăng xuất Outline thì đăng xuất luôn phiên ở IdP.
3. Container `outline` phải gọi được `OIDC_ISSUER_URL`. IdP cũng chạy trong Docker trên cùng máy và trình
   duyệt vào nó bằng `localhost` thì gặp đúng tình huống "hai địa chỉ" ở mục 2.2: khai báo thủ công 3 URI như
   đang làm với Dex.
4. Xoá service `dex` khỏi `docker-compose.yml` nếu không dùng nữa.

**Không dùng SSO, chỉ đăng nhập bằng email.** Theo mã nguồn Outline 1.13: khi không có phương thức SSO nào
(xoá hết `OIDC_*`) và chưa có workspace, lần đầu mở Outline sẽ hiện form **Create workspace** (*Workspace
name*, *Admin name*, *Admin email*). Gửi form là tạo workspace và đăng nhập luôn bằng tài khoản admin đó. Về
sau đăng nhập bằng link gửi qua email, nên **bắt buộc có SMTP**. Không có SMTP thì sau khi đăng xuất sẽ không
vào lại được, trừ khi đã tạo passkey.

### 5.5 Email (SMTP)

Demo gửi mọi email vào **Mailpit** (`SMTP_HOST=mailpit`, `SMTP_PORT=1025`, `SMTP_SECURE=false`): không email
nào ra Internet, đọc tại **http://localhost:8025**. Outline gửi email khi:

- mời thành viên: tiêu đề "*Admin Demo invited you to join Outline’s workspace*", nút **Join now**;
- đăng nhập bằng email: tiêu đề "*Magic Sign-in Link*", nút **Sign In**;
- có thông báo (được nhắc tên, bình luận, tài liệu theo dõi thay đổi...) theo cài đặt của từng người ở
  *Settings → Notifications*;
- xuất dữ liệu xong (mục 10.5).

`SMTP_SECURE=false` là bắt buộc với Mailpit: mặc định của Outline là `true`, tức bắt tay TLS ngay khi kết
nối (kiểu cổng 465). Dùng SMTP thật thì xem các mẫu đang để comment trong `.env.example`: dịch vụ có sẵn
(`SMTP_SERVICE=Gmail`, SendGrid, Mailgun, SES...) hoặc mail server riêng (`SMTP_HOST`, `SMTP_PORT=465`,
`SMTP_SECURE=true`).

Có SMTP thì trang đăng nhập có thêm ô email kèm nút **Continue with Email** (bật/tắt ở *Settings →
Authentication → Email*). Hai lưu ý rút ra từ mã nguồn (`plugins/email/server/auth/email.ts`):

- Chỉ người **đã được mời hoặc đã có tài khoản** mới nhận được link; email lạ không nhận gì, dù màn hình
  vẫn báo "*Check your email*".
- Tài khoản đã từng đăng nhập bằng SSO (ví dụ `admin@example.com` qua Dex) nhập email thì bị **chuyển thẳng
  sang SSO đó** thay vì nhận link.

---

## 6. Bước 2: Khởi chạy, dừng và xem log

### 6.1 Khởi chạy lần đầu

```bash
docker compose up -d
```

Lần đầu, theo thứ tự:

1. Tải 5 image (khoảng 520 MB dạng nén).
2. `postgres` khởi tạo cluster mới, tạo user và database theo `POSTGRES_*`.
3. `outline` đợi `postgres` và `redis` báo healthy (`depends_on: condition: service_healthy`).
4. `outline` kiểm tra biến môi trường (sai thì thoát ngay, mục 11.1), chạy migration (mục 7), rồi mở cổng
   3000.
5. Healthcheck gọi `http://localhost:3000/_health` trong container. Endpoint này truy vấn thử PostgreSQL
   (`SELECT 1`) và ping Redis, trả `OK` thì container chuyển sang `(healthy)`.

```bash
docker compose ps --format "table {{.Service}}\t{{.Status}}\t{{.Ports}}"
```

Kết quả mong đợi:

| Service | STATUS | PORTS (phần quan trọng) |
|---|---|---|
| outline | `Up … (healthy)`; lúc mới khởi động (tối đa khoảng 1 phút) là `(health: starting)` | `0.0.0.0:3500->3000/tcp` |
| postgres | `Up … (healthy)` | `5432/tcp` (không map ra máy host) |
| redis | `Up … (healthy)` | `6379/tcp` |
| dex | `Up …` (không có healthcheck) | `0.0.0.0:5556->5556/tcp` |
| mailpit | `Up … (healthy)` (healthcheck có sẵn trong image) | `0.0.0.0:8025->8025/tcp` |

`outline` hiện `Restarting` liên tục nghĩa là Outline thoát lúc khởi động: xem mục 11.1.

### 6.2 Kiểm tra nhanh từng thành phần

```bash
curl http://localhost:3500/_health                                # OK
curl http://localhost:5556/dex/.well-known/openid-configuration   # JSON có "issuer": "http://localhost:5556/dex"

# Từ TRONG container outline gọi Dex bằng tên service: đúng đường đi của bước ④⑤ ở mục 2.2
docker compose exec outline wget -qO- http://dex:5556/dex/.well-known/openid-configuration
```

```powershell
# PowerShell (curl trong PowerShell 5.1 là alias của Invoke-WebRequest, dùng Invoke-RestMethod cho gọn)
Invoke-RestMethod http://localhost:3500/_health
Invoke-RestMethod http://localhost:5556/dex/.well-known/openid-configuration | Select-Object issuer, authorization_endpoint
```

Mailpit: mở **http://localhost:8025**, hộp thư trống là bình thường.

### 6.3 Xem log

```bash
docker compose logs -f outline           # theo dõi log Outline; Ctrl+C để thoát, container vẫn chạy
docker compose logs --tail 100 outline   # 100 dòng cuối
docker compose logs -f                   # log của cả 5 service, có tên service ở đầu dòng
docker compose logs dex                  # lỗi phía Dex: redirect_uri, client, sai mật khẩu...
```

Với `NODE_ENV=production`, mỗi dòng log của Outline là một object JSON có các trường `level`, `label`,
`message`. Các thông điệp nên biết (lấy từ mã nguồn 1.13.0):

| `message` | `label` | Ý nghĩa |
|---|---|---|
| `Running migrations…` | `database` | Đang chạy migration; chỉ xuất hiện khi có migration mới |
| `OIDC plugin registered`, `OIDC endpoints mounted with manual configuration` | `plugins` | Đăng nhập OIDC (Dex) đã bật |
| `Enforced https was disabled with FORCE_HTTPS env variable` | (warn) | Bình thường khi chạy http |
| `Starting web service`, `Starting worker service`... | `lifecycle` | Các dịch vụ con khởi động |
| `Listening on http://localhost:3000 / http://localhost:3500` | `lifecycle` | Sẵn sàng; vế sau dấu `/` là `URL` |
| `Sending email "…" to …` | `email` | Outline gửi email: mở Mailpit để xem |

Lọc log:

```bash
docker compose logs outline | grep -E "migrations|Listening|error"
```

```powershell
docker compose logs outline | Select-String "migrations|Listening|error"
```

Cần chi tiết hơn: `LOG_LEVEL=debug` trong `.env`; muốn mỗi request HTTP một dòng log thì thêm `DEBUG=http`.
Sau đó chạy `docker compose up -d`.

### 6.4 Dừng, chạy lại, áp dụng thay đổi

| Lệnh | Tác dụng |
|---|---|
| `docker compose up -d` | Tạo và chạy những gì chưa chạy; **áp dụng thay đổi** của `.env` / `docker-compose.yml` |
| `docker compose stop` | Dừng mọi container, giữ nguyên container và dữ liệu |
| `docker compose start` | Chạy lại các container đã `stop` |
| `docker compose restart outline` | Khởi động lại một service; **không** nạp lại `.env` |
| `docker compose restart dex` | Nạp lại `dex/config.yaml` |
| `docker compose down` | Xoá container và network, **giữ** volume (dữ liệu còn nguyên) |
| `docker compose down -v` | Xoá cả volume: **mất toàn bộ** tài liệu, user, file đính kèm |

---

## 7. Bước 3: Migration database

### 7.1 Lần đầu: Outline tự chạy, không cần lệnh riêng

Mỗi lần container `outline` khởi động, **trước khi mở cổng**, Outline chạy một process con
(`build/server/scripts/checkMigrations.js`). Process này kết nối PostgreSQL, giữ một *advisory lock* để
nhiều container khởi động cùng lúc cũng chỉ một cái chạy migration, áp dụng các migration còn thiếu, xong
mới cho server chạy tiếp. Database trống ở lần đầu nên toàn bộ bảng được tạo ra; những lần sau không có gì
mới thì bỏ qua. Tài liệu chính thức: *"Migrations are ran automatically when the container starts up."*

Vì vậy "chạy migration lần đầu" chỉ là:

```bash
docker compose up -d
docker compose logs outline | grep -i migrat       # PowerShell: docker compose logs outline | Select-String migrat
```

Thấy `Running migrations…` rồi tới `Listening on ...` là xong.

### 7.2 Kiểm tra trạng thái migration

```bash
docker compose exec outline node node_modules/sequelize-cli/lib/sequelize db:migrate:status --env=production-ssl-disabled
```

Mỗi migration một dòng: `up <tên-file>.js` là đã chạy, `down` là chưa. Xem các bảng đã tạo:

```bash
docker compose exec postgres psql -U outline -d outline -c '\dt'
```

(đổi `outline` nếu đã đặt `POSTGRES_USER` / `POSTGRES_DB` khác).

Vì sao có `--env=production-ssl-disabled`: sequelize-cli đọc `server/config/database.js` trong image. Môi
trường `production` (lấy theo `NODE_ENV`) bắt kết nối SSL, nên không chạy được với PostgreSQL trong compose;
`production-ssl-disabled` là cùng cấu hình đó nhưng không SSL.

### 7.3 Tự chạy migration (tắt chế độ tự động)

Dùng khi muốn tự quyết thời điểm migration, ví dụ backup ngay trước đó.

1. Bỏ comment dòng `command: ["node", "build/server/index.js", "--no-migrate"]` của service `outline` trong
   `docker-compose.yml`.
2. Chạy migration bằng một container tạm (compose tự bật `postgres`, `redis` trước):

   ```bash
   docker compose run --rm outline node node_modules/sequelize-cli/lib/sequelize db:migrate --env=production-ssl-disabled
   ```

3. `docker compose up -d`.

Quên bước 2 thì Outline từ chối khởi động, log có dòng: *Database migrations are pending and were not run
because the --no-migrate flag was passed. Run the migrations with "yarn db:migrate".*

> **Đừng làm theo các hướng dẫn cũ dùng `yarn`.** Nhiều bài viết ghi
> `docker compose run --rm outline yarn db:migrate --env=production-ssl-disabled`. Image Outline 1.x dựng
> trên `node:26-slim`, mà image Node 26 không còn kèm Yarn, nên Docker báo
> `exec: "yarn": executable file not found in $PATH`. Script `db:migrate` trong `package.json` cũng chỉ là
> `sequelize db:migrate`, nên gọi thẳng sequelize-cli bằng `node` như trên là tương đương.

### 7.4 Nâng cấp phiên bản Outline

1. Đọc release notes: https://github.com/outline/outline/releases
2. Backup (mục 10.2). Migration chỉ chạy một chiều: muốn quay về bản cũ thì phải restore bản backup này.
3. Sửa `OUTLINE_VERSION` trong `.env`, ví dụ `OUTLINE_VERSION=1.14.0`.
4. Kéo image mới và chạy; migration tự chạy khi container mới khởi động:

   ```bash
   docker compose pull outline
   docker compose up -d
   docker compose logs -f outline       # Running migrations… rồi Listening on ...
   ```

Nâng **major** PostgreSQL (18 lên 19...) thì khác: đổi tag image thôi là container không chạy (mục 11.9).
Phải `pg_dump` bằng bản cũ rồi restore vào bản mới (mục 10.2, 10.3).

---

## 8. Bước 4: Truy cập giao diện web và đăng nhập lần đầu

### 8.1 Đăng nhập lần đầu bằng tài khoản admin

1. Mở **http://localhost:3500**. Dùng đúng địa chỉ trong `URL`; đừng mở bằng `127.0.0.1`, cookie và
   WebSocket sẽ không khớp.
2. Trang **Log in to Outline** có nút **Continue with Dex**. Bấm vào.
3. Trình duyệt sang trang đăng nhập của Dex (`http://localhost:5556/dex/auth/...`). Nhập
   `admin@example.com` / `password`.
4. Dex chuyển về Outline. Chưa có workspace nào nên Outline tạo workspace tên **Outline**; tài khoản
   **Admin Demo** là **Admin**. Outline tạo sẵn collection **Welcome** gồm 4 tài liệu hướng dẫn: *What is
   Outline*, *Getting Started*, *Our Editor*, *Integrations & API*.

Workspace được tạo bởi **người đăng nhập đầu tiên**, và người đó là Admin. Lỡ đăng nhập bằng
`member@example.com` trước thì member thành Admin. Muốn làm lại: `docker compose down -v`, rồi
`docker compose up -d` (xoá sạch dữ liệu).

### 8.2 Đặt tên workspace và ngôn ngữ

- **Settings → General**: đổi tên workspace (mặc định *Outline*) và logo.
- **Settings → Preferences → Language**: chọn **Tiếng Việt (Vietnamese)** cho tài khoản của mình. Bản dịch
  `vi_VN` mới khoảng 60% nên vẫn lẫn tiếng Anh. README ghi nhãn giao diện bằng tiếng Anh, kèm tiếng Việt ở
  chỗ cần.

Menu **Settings** của Outline 1.13 (đường dẫn `/settings/...`):

| Nhóm | Mục | Dùng để |
|---|---|---|
| Account | Profile, Preferences, Notifications, API & Access | Hồ sơ, ngôn ngữ, thông báo email, token cá nhân |
| Workspace | **General** (Chung) | Tên, logo workspace |
| | **Users** (Người dùng) | Danh sách thành viên, **Invite people**, đổi vai trò, treo tài khoản |
| | **Groups** (Nhóm) | Nhóm người dùng để phân quyền collection |
| | **Authentication** | Bật/tắt từng phương thức đăng nhập (Dex, Email, Passkeys), *Allowed domains* |
| | **Security** (Bảo mật) | *Default role*, chia sẻ công khai, ai được tạo collection, bình luận... |
| | Templates, Emojis, AI, Shared links | Mẫu tài liệu, emoji riêng, tính năng AI, danh sách link chia sẻ công khai |
| | **Import** (Nhập), **Export** (Xuất) | Nhập/xuất dữ liệu cả workspace (mục 10.5) |
| Integrations, Developer | Embeds..., API keys, Applications | Tích hợp, API |

### 8.3 Đăng xuất và đăng nhập tài khoản khác

- Menu tài khoản (tên và avatar ở góc dưới bên trái) → **Log out**.
- Dex trong demo không nhớ phiên đăng nhập: mỗi lần bấm **Continue with Dex** đều phải nhập email và mật
  khẩu, nên đổi người dùng rất dễ. Vì `OIDC_DISABLE_REDIRECT=true`, Outline luôn hiện trang đăng nhập của
  chính nó, không tự chuyển sang Dex.
- Muốn dùng 2 tài khoản **cùng lúc**: mở thêm một cửa sổ ẩn danh hoặc một trình duyệt khác (cookie riêng).

---

## 9. Bước 5: Sử dụng cơ bản

### 9.1 Tạo collection

Collection là nhóm tài liệu (ví dụ "Kỹ thuật", "Nhân sự", "Quy trình") và là đơn vị phân quyền.

1. Thanh bên trái, mục **Collections** → dấu **+** (hoặc dòng **New collection** ở cuối danh sách).
2. Hộp thoại **Create a collection**:
   - **Name**: tên collection; bấm biểu tượng bên trái tên để chọn icon và màu.
   - **Permission** (*Phân quyền*): quyền mặc định của mọi thành viên workspace với collection này:

     | Lựa chọn | Ý nghĩa |
     |---|---|
     | **Can edit** | Mọi thành viên đọc và sửa được |
     | **View only** | Mọi thành viên chỉ đọc |
     | **No access** | Collection riêng tư: chỉ người hoặc nhóm được thêm vào mới thấy |

   - **Advanced options**: bật/tắt **Commenting** (bình luận), **Public document sharing** (cho phép chia
     sẻ tài liệu ra ngoài bằng link công khai).
3. Bấm **Create**.

Đổi quyền về sau: menu **⋯** của collection → **Permissions**: thêm từng người hoặc cả nhóm (*Settings →
Groups* → **New group**) với quyền riêng. Collection **Welcome** tạo sẵn ở lần đăng nhập đầu có thể giữ để
đọc hoặc xoá đi.

### 9.2 Tạo và soạn tài liệu

1. Mở collection → **New doc** (phím tắt `n`), hoặc dấu **+** cạnh tên collection ở thanh bên trái.
2. Gõ tiêu đề (dòng trống ghi *Untitled*), Enter xuống phần nội dung (*Type '/' to insert, or start
   writing…*).
3. Soạn bằng cú pháp Markdown, gõ tới đâu định dạng tới đó:

   | Gõ | Kết quả |
   |---|---|
   | `#` / `##` / `###` + dấu cách | Tiêu đề cấp 1 / 2 / 3 |
   | `-` hoặc `*` + dấu cách | Danh sách gạch đầu dòng |
   | `1.` + dấu cách | Danh sách đánh số |
   | `[ ]` + dấu cách | Checklist |
   | `>` + dấu cách | Trích dẫn |
   | ```` ``` ```` + dấu cách (có thể kèm ngôn ngữ: ```` ```js ````) | Khối code |
   | `---` | Đường kẻ ngang |
   | `/` | Menu chèn khối: bảng, ảnh, file, sơ đồ, nhúng nội dung... |
   | `@` | Nhắc tên một người (họ nhận thông báo) hoặc liên kết tới tài liệu khác |

   Dán hoặc kéo thả ảnh/file vào trang là tải lên volume `outline-data` (giới hạn 250 MB mỗi file, đặt bằng
   `FILE_STORAGE_UPLOAD_MAX_SIZE`).
4. Nội dung tự lưu liên tục. Tài liệu mới là **bản nháp** (nằm trong **Drafts**), người khác chưa thấy; bấm
   **Publish** để đăng vào collection.
5. Các thao tác hay dùng trong menu **⋯** của tài liệu: **New nested document** (tài liệu con, tạo cây
   tài liệu), **History** (xem và khôi phục các phiên bản cũ), **Move**, **Duplicate**, **Download**.
6. **Share**: mời thêm người vào riêng tài liệu này, hoặc bật **Publish to internet** để ai có link cũng
   đọc được (collection phải bật *Public document sharing*).

Thử soạn realtime: mở cùng tài liệu ở cửa sổ ẩn danh bằng tài khoản thứ hai (mục 9.3), gõ ở một bên thì bên
kia thấy ngay. Đó là dịch vụ `collaboration` chạy qua WebSocket.

**Search** ở thanh bên tìm toàn văn trong mọi tài liệu mình có quyền xem. Kéo thả file HTML, Markdown, text
vào một collection là nhập thành tài liệu; menu **⋯** của collection có **Import documents**.

### 9.3 Mời thành viên

**Cách A: người được mời có tài khoản ở IdP** (ở đây là `member@example.com` trong Dex)

1. Đăng nhập bằng admin → **Settings → Users** → **Invite people**.
2. Hộp thoại **Invite to workspace**:
   - **Invite as**: vai trò của người được mời, mặc định **Editor**:

     | Vai trò | Mô tả trong giao diện | Quyền |
     |---|---|---|
     | **Admin** | *Can manage all workspace settings* | Mọi cài đặt workspace, user, collection |
     | **Editor** | *Can create, edit, and delete documents* | Tạo, sửa, xoá tài liệu |
     | **Viewer** | *Can view and comment* | Chỉ đọc và bình luận |

   - Nhập **Email** `member@example.com`, **Name** `Member Demo` (**Add another** để mời thêm người)
     → **Send invites**.
3. Trong **Settings → Users**, `member@example.com` hiện trạng thái **Invited**.
4. Mở Mailpit (http://localhost:8025): email "*Admin Demo invited you to join Outline’s workspace*". Nút
   **Join now** dẫn về trang đăng nhập của Outline.
5. Mở link đó trong **cửa sổ ẩn danh** → **Continue with Dex** → `member@example.com` / `password`.
6. Member vào workspace với vai trò đã chọn. Bên admin, trạng thái *Invited* mất đi, và admin nhận thêm một
   email báo lời mời đã được chấp nhận.

**Cách B: người được mời không có tài khoản SSO** (đăng nhập bằng email, cần SMTP)

1. Mời một email bất kỳ, ví dụ `an.nguyen@congty.vn`. Mailpit giữ lại mọi email nên không cần hộp thư
   thật.
2. Cửa sổ ẩn danh → http://localhost:3500 → nhập `an.nguyen@congty.vn` vào ô email → **Continue with Email**
   → màn hình *Check your email*.
3. Mailpit: email **Magic Sign-in Link** → bấm **Sign In** → vào workspace.

**Quản lý thành viên:** *Settings → Users*, menu của từng người có **Change role**, **Suspend user** (khoá
quyền truy cập), **Resend invite** (với người chưa nhận lời mời).

**Giới hạn ai được vào** (bản tự host):

- Người đăng nhập SSO thành công mà chưa có tài khoản sẽ được **tự tạo tài khoản** với **Default role**
  (*Settings → Security → Default role*, mặc định Editor). Ví dụ: không cần mời, `member@example.com` vẫn
  vào được. Công tắc *Require invites* chỉ có ở bản cloud.
- **Allowed domains** (*Settings → Authentication*, phần *Restrictions*): chỉ email thuộc các tên miền này
  mới được tự tạo tài khoản, ví dụ `congty.vn`. Người đã được mời và người đã có tài khoản vẫn vào được.
  Thử trước khi làm cách A: thêm `congty.vn`, rồi đăng nhập Dex bằng `member@example.com` (chưa được mời):
  bị từ chối vì `example.com` không nằm trong danh sách.
- Cách chắc nhất: chỉ cấp tài khoản IdP cho người cần dùng; tài khoản bị khoá ở IdP thì không đăng nhập
  Outline được nữa.
- Mời hoặc ghép tài khoản qua tên miền chỉ chạy khi IdP xác nhận email đã xác minh (`email_verified: true`;
  Dex trong demo đặt `emailVerified: true`). Thiếu thì lỗi ở mục 11.6.

---

## 10. Backup và restore dữ liệu

### 10.1 Cần backup những gì

| Thành phần | Nằm ở | Backup? |
|---|---|---|
| PostgreSQL | volume `postgres-data` | **Có**. Mọi tài liệu, collection, user, phân quyền, lịch sử. Dùng `pg_dump`, đừng chép thư mục dữ liệu khi DB đang chạy |
| File đính kèm | volume `outline-data` | **Có**. Ảnh, file tải lên |
| `.env` | thư mục dự án | **Có**, cất ở nơi an toàn. Thiếu đúng `SECRET_KEY` thì dữ liệu mã hoá trong DB không đọc được |
| `docker-compose.yml`, `dex/config.yaml` | thư mục dự án | Đã nằm trong git |
| Redis | volume `redis-data` | Không. Chỉ có hàng đợi và cache |

### 10.2 Backup

```bash
# 1) Database: pg_dump định dạng custom (-Fc, đã nén), ghi thẳng vào backups/ trên máy host
docker compose exec -T postgres sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f /backups/outline-db_$(date +%Y%m%d_%H%M).dump'

# 2) File đính kèm: nén volume outline-data bằng service tiện ích "backup"
docker compose run --rm backup sh -c 'tar czf /backups/outline-files_$(date +%Y%m%d_%H%M).tar.gz -C /data .'

# 3) Kiểm tra
ls -l backups
docker compose exec -T postgres sh -c 'pg_restore -l /backups/outline-db_20261116_0930.dump | head -20'   # đổi tên file
```

- Không cần dừng Outline khi backup: `pg_dump` đọc một snapshot nhất quán của database.
- Mọi lệnh nằm trong dấu nháy đơn `'...'`, nên `$POSTGRES_USER`, `$POSTGRES_DB`, `$(date ...)` được tính
  **bên trong container**: biến lấy từ service postgres, giờ là giờ UTC. Nhờ vậy cùng một dòng lệnh chạy
  được trong bash, Git Bash và PowerShell 5.1/7. Git Bash cũng không tự đổi `/backups` thành
  `C:/Program Files/Git/backups` như khi đường dẫn đứng riêng thành tham số.
- `-T`: không cấp pseudo-TTY, tránh lỗi *the input device is not a TTY* trên Git Bash (mintty).
- Service `backup` (alpine) gắn chung volume `outline-data` vào `/data` và thư mục `backups/` vào `/backups`.
  Nó thuộc profile `tools`, `docker compose up` không chạy, `docker compose run --rm backup ...` chạy xong
  thì tự xoá.

### 10.3 Restore

**Trên cùng máy** (đổi tên file cho đúng bản muốn khôi phục):

```bash
# 1) Dừng Outline (postgres vẫn chạy) để không ai ghi vào database trong lúc restore
docker compose stop outline

# 2) Database: xoá database cũ, tạo lại rỗng, nạp bản backup
docker compose exec -T postgres sh -c 'dropdb -U $POSTGRES_USER --if-exists $POSTGRES_DB && createdb -U $POSTGRES_USER $POSTGRES_DB && pg_restore -U $POSTGRES_USER -d $POSTGRES_DB --no-owner /backups/outline-db_20261116_0930.dump'

# 3) File đính kèm: xoá nội dung volume rồi giải nén bản backup (tar chạy bằng root nên giữ đúng chủ sở hữu uid 1001)
docker compose run --rm backup sh -c 'find /data -mindepth 1 -delete && tar xzf /backups/outline-files_20261116_0930.tar.gz -C /data'

# 4) Chạy lại Outline. Bản backup cũ hơn image thì Outline tự chạy các migration còn thiếu
docker compose start outline
```

Quên bước 1 thì `dropdb` báo `database "outline" is being accessed by other users`.

**Sang máy mới:**

1. Chép thư mục `152_outline` **kèm `.env` cũ** (đúng `SECRET_KEY`) và các file trong `backups/`.
2. `docker compose up -d postgres redis`: chỉ bật database, Outline chưa chạy nên chưa tạo bảng.
3. Làm bước 2 và 3 ở trên.
4. `docker compose up -d`.

Chỉ restore vào **cùng phiên bản Outline hoặc mới hơn** bản đã tạo backup; Outline không có migration chạy
ngược.

### 10.4 Backup tự động

Linux, crontab của user có quyền chạy docker (`crontab -e`): 2 giờ sáng hằng ngày, giữ 14 ngày. Trong
crontab, dấu `%` phải viết `\%`:

```cron
0 2 * * * cd /opt/outline && docker compose exec -T postgres sh -c 'pg_dump -U $POSTGRES_USER -d $POSTGRES_DB -Fc -f /backups/outline-db_$(date +\%Y\%m\%d).dump' && docker compose run --rm backup sh -c 'tar czf /backups/outline-files_$(date +\%Y\%m\%d).tar.gz -C /data .' && find backups -name 'outline-*' -mtime +14 -delete
```

Windows: tạo task trong Task Scheduler chạy một script PowerShell gồm `Set-Location` vào thư mục dự án và
hai lệnh backup ở mục 10.2. Nên chép thêm thư mục `backups/` sang máy hoặc dịch vụ lưu trữ khác, và thỉnh
thoảng thử restore để chắc bản backup dùng được.

### 10.5 Xuất dữ liệu ngay trong Outline

**Settings → Export → Export data**: chọn định dạng (Markdown, HTML hoặc JSON), có thể chọn **Include
attachments**. Xuất xong Outline gửi email (xem trong Mailpit) và hiện link tải trong trang Export.

- **JSON** giữ đủ cấu trúc để nạp sang một Outline khác: *Settings → Import → JSON*.
- **Markdown / HTML** để đọc hoặc lưu trữ ngoài Outline.

Đây là bản sao **nội dung** (collection, tài liệu, file đính kèm), không thay được backup PostgreSQL ở mục
10.2: không có user, phân quyền, lịch sử sửa đổi. Có thể tự động hoá bằng API `collections.export_all`.

---

## 11. Xử lý sự cố

Luôn bắt đầu bằng `docker compose ps` và `docker compose logs --tail 50 outline`.

### 11.1 `outline` khởi động lại liên tục (`Restarting`)

Outline kiểm tra biến môi trường ngay khi chạy; sai thì in danh sách lỗi rồi thoát:

```
Environment configuration is invalid, please check the following:

- ...
```

| Dòng lỗi trong log | Nguyên nhân | Sửa |
|---|---|---|
| ``The SECRET_KEY environment variable must be exactly 64 hexadecimal characters (Use `openssl rand -hex 32` to generate a value).`` | Chưa sinh `SECRET_KEY`, hoặc sai độ dài/ký tự | Mục 5.2 |
| `UTILS_SECRET should not be empty` | Chưa sinh `UTILS_SECRET` | Mục 5.2 |
| `URL must be a URL address` | `URL` thiếu `http://` hoặc sai cú pháp | `URL=http://localhost:3500` |
| ``The database does not support SSL connections. Set the `PGSSLMODE` environment variable to `disable` ...`` | Thiếu `PGSSLMODE=disable` | Thêm vào `.env` |
| `Could not connect to the database. Please check your connection settings.` | Sai host/cổng trong `DATABASE_URL` | Host phải là `postgres`, cổng `5432` |
| `password authentication failed for user "outline"` | `DATABASE_URL` khác `POSTGRES_PASSWORD`; hoặc volume đã tạo từ trước với mật khẩu cũ (`POSTGRES_*` chỉ có tác dụng lần đầu) | Sửa cho khớp. Chưa có dữ liệu cần giữ thì `docker compose down -v` rồi chạy lại |

Chưa tạo `.env` (hoặc thiếu `POSTGRES_PASSWORD`) thì chính `docker compose` báo lỗi trước khi chạy gì:

```
error while interpolating services.postgres.environment.POSTGRES_PASSWORD: required variable POSTGRES_PASSWORD is missing a value: Chưa đặt POSTGRES_PASSWORD trong .env
```

### 11.2 Trình duyệt bị chuyển sang `https://localhost:3500`

`FORCE_HTTPS` đang là `true` (mặc định của Outline) trong khi chạy http. Đặt `FORCE_HTTPS=false`, chạy
`docker compose up -d`. Trình duyệt đã nhớ lần chuyển hướng cũ thì thử cửa sổ ẩn danh hoặc xoá cache.

### 11.3 Không có nút "Continue with Dex", hoặc hiện form "Create workspace"

Cấu hình OIDC thủ công cần **đủ 5 biến**: `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_AUTH_URI`,
`OIDC_TOKEN_URI`, `OIDC_USERINFO_URI`. Thiếu một biến thì plugin OIDC không bật. Log lúc khởi động phải có
`OIDC plugin registered`. Không có phương thức SSO nào thì Outline 1.x hiện form **Create workspace**
(mục 5.4).

### 11.4 Lỗi hiện trên trang của Dex

| Thông báo | Nguyên nhân | Sửa |
|---|---|---|
| `Unregistered redirect_uri.` | `URL`/cổng của Outline không khớp `redirectURIs` trong `dex/config.yaml` | Sửa cho khớp, `docker compose restart dex` |
| `Invalid client_id.` | `OIDC_CLIENT_ID` khác `staticClients[].id` | Sửa cho khớp |
| Báo sai email/mật khẩu | Gõ sai, hoặc hash bcrypt tự tạo bị lỗi | Tài khoản mẫu: `admin@example.com` / `password` |

`docker compose logs dex` cho biết chi tiết, ví dụ dòng `unregistered redirect_uri` kèm `redirect_uri` thật
mà Outline đã gửi.

### 11.5 Đăng nhập ở Dex xong, quay về Outline thì báo lỗi

- Log của Outline có lỗi `ECONNREFUSED` tới cổng 5556 (`127.0.0.1:5556` hoặc `::1:5556`): `OIDC_TOKEN_URI` /
  `OIDC_USERINFO_URI` đang dùng `localhost`. Phải là `http://dex:5556/...` (mục 2.2).
- Lỗi `invalid_client` khi đổi code lấy token: `OIDC_CLIENT_SECRET` khác `secret` trong `dex/config.yaml`.

### 11.6 "Your email address has not been verified by Dex..."

Outline chỉ ghép tài khoản SSO với một lời mời có sẵn, hoặc cho qua *Allowed domains*, khi IdP trả
`email_verified: true`. Với Dex: kiểm tra `emailVerified: true` của tài khoản trong `dex/config.yaml`. Với IdP
thật: xác minh email ở IdP, hoặc cấu hình để IdP trả claim này.

### 11.7 Không thấy email

- Mở http://localhost:8025. Mailpit dùng database tạm: restart container `mailpit` là mất hết email cũ.
- Log của Outline: có `Sending email "..."` nghĩa là Outline đã gửi. Có `No mail transport available` nghĩa
  là thiếu `SMTP_HOST` / `SMTP_SERVICE`.
- `SMTP_SECURE` phải là `false` với Mailpit; để `true` thì Outline cố bắt tay TLS với một cổng không có TLS.
- Tài khoản đã đăng nhập bằng SSO nhập email ở trang đăng nhập thì bị chuyển sang SSO, không nhận link. Đây
  là hành vi đúng (mục 5.5).

### 11.8 Cổng bị chiếm, hoặc Docker Desktop không mở cổng

- `Bind for 0.0.0.0:3500 failed: port is already allocated`: đã có chương trình khác dùng cổng.
- Docker Desktop trên Windows có khi **không báo lỗi** mà lặng lẽ bỏ qua: `docker compose ps` chỉ hiện
  `3000/tcp`, thiếu `0.0.0.0:3500->3000/tcp`. Demo 150 đã gặp thật, xem
  [150_nodejs_signoz mục 12.6](../150_nodejs_signoz/docs/README.md#126-cổng-của-app-bị-chiếm-docker-không-báo-lỗi).

Tìm process đang giữ cổng:

```powershell
Get-NetTCPConnection -State Listen -LocalPort 3500 | Select-Object LocalAddress, OwningProcess
```

```bash
lsof -i :3500        # macOS / Linux
```

Đổi cổng thì sửa cả ba chỗ: `OUTLINE_PORT`, `URL` trong `.env` và `redirectURIs` trong `dex/config.yaml`
(mục 5.3).

### 11.9 PostgreSQL 18 báo lỗi về `/var/lib/postgresql/data`

```
Error: in 18+, these Docker images are configured to store database data in a
       format which is compatible with "pg_ctlcluster" (specifically, using
       major-version-specific directory names).
...
       Counter to that, there appears to be PostgreSQL data in:
         /var/lib/postgresql/data (unused mount/volume)
```

Có hai nguyên nhân:

- Volume gắn vào `/var/lib/postgresql/data` theo hướng dẫn cho bản ≤ 17. Từ bản 18 phải gắn vào
  `/var/lib/postgresql`, như `docker-compose.yml` đang làm.
- Volume chứa dữ liệu của PostgreSQL bản cũ hơn. Không nâng major bằng cách đổi tag image được: `pg_dump`
  bằng bản cũ rồi restore vào bản mới (mục 10).

### 11.10 Lệnh `docker` treo, Docker Desktop không phản hồi

Lúc viết README, máy thử gặp đúng lỗi này: `docker version` không trả lời, còn
`%LOCALAPPDATA%\Docker\log\host\monitor.log` có dòng `There is not enough space on the disk`, vì ổ C: chỉ
còn khoảng 3,5 GB. Cách xử lý (giải phóng ổ C:, `wsl --shutdown`, khởi động lại Docker Desktop, dọn dung
lượng bên trong Docker) có ở
[150_nodejs_signoz mục 12.9](../150_nodejs_signoz/docs/README.md#129-docker-và-wsl-treo-wslservice0x80072745-ổ-đĩa-đầy).

### 11.11 Tải ảnh lên bị lỗi sau khi đổi volume thành thư mục trên máy (Linux)

Đổi `outline-data:/var/lib/outline/data` thành bind mount kiểu `./data:/var/lib/outline/data` thì trên
Linux thư mục `./data` thuộc root, còn Outline chạy bằng user `nodejs` (uid 1001) nên không ghi được. Sửa:
`sudo chown -R 1001:1001 ./data`. Volume có tên như trong `docker-compose.yml` không gặp lỗi này.

---

## 12. Dọn dẹp

```bash
docker compose down        # xoá container và network, GIỮ dữ liệu trong 3 volume
docker compose down -v     # xoá luôn 3 volume: mất toàn bộ tài liệu, user, file đính kèm

# Xoá image nếu không dùng nữa
docker image rm docker.getoutline.com/outlinewiki/outline:1.13.0 postgres:18 redis:8-alpine ghcr.io/dexidp/dex:v2.46.1 axllent/mailpit:v1.33.1 alpine:3.24
```

`docker compose down -v` không đụng tới thư mục `backups/` trên máy host; xoá file backup bằng tay nếu muốn.

---

## 13. Lưu ý khi đưa lên production

- **HTTPS và tên miền.** Đặt Outline sau một reverse proxy (Caddy, Nginx, Traefik), đặt
  `URL=https://wiki.congty.vn` và `FORCE_HTTPS=true`. Proxy **phải chuyển tiếp WebSocket**, thiếu thì soạn
  thảo realtime không chạy. Caddy tự lo chứng chỉ và WebSocket:

  ```
  wiki.congty.vn {
      reverse_proxy 127.0.0.1:3500
  }
  ```

  Nginx:

  ```nginx
  server {
      listen 443 ssl;
      server_name wiki.congty.vn;
      # ssl_certificate ...; ssl_certificate_key ...;
      client_max_body_size 250m;                  # khớp FILE_STORAGE_UPLOAD_MAX_SIZE

      location / {
          proxy_pass http://127.0.0.1:3500;
          proxy_http_version 1.1;
          proxy_set_header Upgrade $http_upgrade;   # WebSocket cho soạn thảo realtime
          proxy_set_header Connection "upgrade";
          proxy_set_header Host $host;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
      }
  }
  ```

  Khi đó chỉ cho Outline nghe trên máy chủ: đổi dòng `ports` thành
  `"127.0.0.1:${OUTLINE_PORT:-3500}:3000"` để không ai vào thẳng cổng http từ bên ngoài.
- **Bỏ Dex và Mailpit.** Xoá hai service khỏi `docker-compose.yml`, dùng IdP thật (mục 5.4) và SMTP thật
  (mục 5.5). Với IdP OIDC, đặt `OIDC_LOGOUT_URI` để đăng xuất đồng bộ.
- **Bí mật.** `POSTGRES_PASSWORD` mạnh (nhớ sửa cả `DATABASE_URL`), `.env` chỉ chủ sở hữu đọc được
  (`chmod 600 .env`). Outline đọc được biến từ file nếu thêm hậu tố `_FILE`, ví dụ
  `SECRET_KEY_FILE=/run/secrets/outline_secret_key`, hợp với Docker secrets.
- **Ghim phiên bản** image (đang làm) và backup trước mỗi lần nâng cấp (mục 7.4). Lên lịch backup, chép ra
  ngoài máy chủ, thử restore định kỳ (mục 10).
- **Kiểm soát người vào:** *Allowed domains*, *Default role* (để **Viewer** nếu muốn người mới chỉ đọc), và
  quan trọng nhất là ai có tài khoản ở IdP (mục 9.3).
- **Lưu file:** một máy chủ thì volume local là đủ. Chạy nhiều máy chủ Outline, hoặc muốn tách phần lưu trữ,
  thì dùng S3/MinIO (`FILE_STORAGE=s3`, mẫu trong `.env.example`).
- **Tài nguyên:** `WEB_CONCURRENCY` khoảng bằng RAM trống chia 512 MB. Chạy nhiều instance cần thêm
  `REDIS_COLLABORATION_URL` (xem tài liệu *horizontal scaling* của Outline).
- **Không mở PostgreSQL và Redis ra ngoài.** `docker-compose.yml` đã không map cổng hai service này; giữ
  nguyên như vậy.

---

## 14. Tham khảo

- Outline, tài liệu tự host: https://docs.getoutline.com/s/hosting
  - Docker: https://docs.getoutline.com/s/hosting/doc/docker-7pfeLP5a8t
  - OIDC: https://docs.getoutline.com/s/hosting/doc/oidc-8CPBm6uC0I
  - SMTP: https://docs.getoutline.com/s/hosting/doc/smtp-cqCJyZGMIB
  - File storage: https://docs.getoutline.com/s/hosting/doc/file-storage-N4M0T6Ypu7
  - Backups: https://docs.getoutline.com/s/hosting/doc/backups-KZtPOADCHG
- Outline, toàn bộ biến môi trường: https://github.com/outline/outline/blob/main/.env.sample
- Outline, các bản phát hành: https://github.com/outline/outline/releases
- Dex: https://dexidp.io/docs/, cấu hình mẫu có `staticPasswords`:
  https://github.com/dexidp/dex/blob/master/config.dev.yaml
- Mailpit: https://mailpit.axllent.org/docs/
- Image PostgreSQL, thay đổi thư mục dữ liệu từ bản 18: https://github.com/docker-library/postgres/pull/1259
- Docker Compose profiles: https://docs.docker.com/compose/how-tos/profiles/
