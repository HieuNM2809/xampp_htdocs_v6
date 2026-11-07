# Observability cho Node.js với SigNoz (OpenTelemetry + Docker)

Demo chạy được về **observability** cho ứng dụng Node.js: hai service Express được gắn
**OpenTelemetry**, gửi đủ ba loại tín hiệu — **traces, metrics, logs** — qua OTLP/HTTP tới
**SigNoz** (tự host bằng Docker hoặc SigNoz Cloud). README đi lần lượt từng bước: cài SigNoz, chạy
app, sinh traffic, rồi đọc Services / Traces / Logs / Dashboard trên giao diện SigNoz, kèm phần xử lý
các lỗi hay gặp.

```
 ┌──────────── project nodejs-signoz-demo (docker-compose.yml của thư mục này) ─────────────────┐
 │                                                                                              │
 │   order-service :3400  ──── HTTP + header traceparent ───►    payment-service :3401          │
 │   Express 5 + OpenTelemetry SDK                               Express 5 + OpenTelemetry SDK  │
 │   PostgreSQL/Redis giả lập (mỗi lệnh 1 span)                  fraud.check, bank.authorize    │
 │                                                                                              │
 └────────────┬────────────────────────────────────────────────────────┬────────────────────────┘
              │   OTLP/HTTP :4318  (/v1/traces, /v1/metrics, /v1/logs) │
              ▼                                                        ▼
 ┌──────────── SigNoz (network Docker: signoz-network) ─────────────────────────────────────────┐
 │   signoz-ingester (OTel Collector)  ──►  ClickHouse  ◄──  signoz (API + UI :8080)            │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
```

Đã chạy thử toàn bộ ngày 05/11/2026 trên Windows 11 + Docker Desktop 28.5 với:

| Thành phần | Phiên bản |
|---|---|
| SigNoz | v0.149.0, cài bằng Foundry v0.5.0 (flavor compose) |
| OpenTelemetry JS | SDK 3.0 — `@opentelemetry/sdk-node` 0.300.0, `auto-instrumentations-node` 0.82.0 |
| Ứng dụng | Node.js 26.13 (image `node:26-slim`), Express 5.3, pino 10.4 |

Kiểm thử tự động đi kèm (mục 8.3): `npm test` 11/11 test (không cần SigNoz) và `npm run verify` 35/35
check trên SigNoz thật — đạt với cả cách A, cách B và bản SigNoz compose cũ v0.129.0.

---

## Mục lục

1. [Chạy nhanh](#1-chạy-nhanh)
2. [Luồng hoạt động: App → SDK → Collector → ClickHouse → UI](#2-luồng-hoạt-động-app--sdk--collector--clickhouse--ui)
3. [Cấu trúc thư mục](#3-cấu-trúc-thư-mục)
4. [Yêu cầu](#4-yêu-cầu)
5. [Bước 1: Cài và chạy SigNoz](#5-bước-1-cài-và-chạy-signoz)
6. [Bước 2: Cấu hình môi trường (.env)](#6-bước-2-cấu-hình-môi-trường-env)
7. [Bước 3: Build và chạy ứng dụng](#7-bước-3-build-và-chạy-ứng-dụng)
8. [Bước 4: Sinh traffic để test](#8-bước-4-sinh-traffic-để-test)
9. [Bước 5: Xem dữ liệu trên SigNoz](#9-bước-5-xem-dữ-liệu-trên-signoz)
10. [Giải thích code](#10-giải-thích-code)
11. [Biến môi trường OpenTelemetry hay dùng](#11-biến-môi-trường-opentelemetry-hay-dùng)
12. [Xử lý sự cố](#12-xử-lý-sự-cố)
13. [Dọn dẹp](#13-dọn-dẹp)
14. [Lưu ý khi đưa lên production](#14-lưu-ý-khi-đưa-lên-production)
15. [Tham khảo](#15-tham-khảo)

---

## 1. Chạy nhanh

```bash
# 1) Cài và chạy SigNoz (cần foundryctl, xem mục 5.2)
cd signoz
foundryctl cast -f casting.yaml
cd ..

# 2) Mở http://localhost:8080 và TẠO TÀI KHOẢN ADMIN ĐẦU TIÊN.
#    Bắt buộc: trước bước này collector của SigNoz chưa mở cổng 4317/4318 (mục 5.2, bước 4).

# 3) Build và chạy app (2 service), nối vào network của SigNoz
docker compose up -d --build

# 4) Sinh traffic 60 giây, chạy ngay trong container (không cần cài Node trên máy)
docker compose exec order-service node scripts/generate-traffic.js

# 5) Mở http://localhost:8080 → Services: thấy order-service và payment-service
```

| Cổng | Thành phần |
|---|---|
| 8080 | Giao diện SigNoz (UI + API) |
| 4317 | OTLP gRPC — collector của SigNoz |
| 4318 | OTLP HTTP — collector của SigNoz, **app trong demo gửi vào cổng này** |
| 3400 | order-service (API chính của demo) |
| 3401 | payment-service (service thanh toán giả lập) |

> **Cổng UI 3301 hay 8080?** Bản SigNoz đến v0.75 có container frontend riêng chạy ở **3301**. Từ
> v0.76 frontend gộp vào container `signoz`, giao diện chuyển sang **8080**. Hướng dẫn cũ trên mạng
> ghi 3301 là của các bản trước đó.

---

## 2. Luồng hoạt động: App → SDK → Collector → ClickHouse → UI

```
 ① App Node.js — order-service, payment-service
    Route Express, log pino, counter/histogram. Code nghiệp vụ chỉ dùng @opentelemetry/api,
    không hề biết SigNoz là gì.
          │
          ▼
 ② OpenTelemetry SDK — src/tracing.js, nạp TRƯỚC app bằng `node --require`
    • auto-instrumentation tự tạo span cho HTTP server, Express, fetch; tự truyền header traceparent
    • instrumentation-pino biến mỗi dòng log thành LogRecord, gắn trace_id/span_id
    • gom thành lô: span ~5 giây, log ~1 giây, metric 15 giây → gửi OTLP/HTTP (JSON)
          │  POST http://signoz-ingester:4318/v1/traces | /v1/metrics | /v1/logs
          ▼
 ③ OpenTelemetry Collector của SigNoz — container signoz-ingester-1
    receiver otlp (4317 gRPC, 4318 HTTP)
      → processor signozspanmetrics: TÍNH metric APM (số request, lỗi, độ trễ) từ chính các span
      → processor batch
      → exporter clickhousetraces / clickhouselogsexporter / signozclickhousemetrics
          │  TCP 9000
          ▼
 ④ ClickHouse — container signoz-telemetrystore-clickhouse-0-0
    database signoz_traces, signoz_logs, signoz_metrics. Lưu dạng cột, nén tốt,
    gom nhóm hàng triệu span trong vài trăm mili giây.
          ▲  SQL
          │
 ⑤ SigNoz — container signoz-signoz-0, cổng 8080
    query service + giao diện: Services, Traces, Logs, Dashboards, Alerts.
    PostgreSQL (metastore) giữ user, dashboard, alert. SigNoz còn đẩy cấu hình xuống
    collector qua giao thức OpAMP.
```

Từng chặng làm gì:

| Chặng | Việc chính | Trong demo này |
|---|---|---|
| ① App | Sinh ra sự kiện: request, câu SQL, lỗi, dòng log, con số nghiệp vụ | `src/server.js`, `src/payment-service.js`, `src/routes/*` |
| ② SDK | Biến sự kiện thành span/metric/log theo chuẩn OpenTelemetry, gom lô, gửi đi | `src/tracing.js` |
| ③ Collector | Nhận OTLP, làm giàu và tính thêm metric APM, ghi xuống kho | container `signoz-ingester-1` |
| ④ ClickHouse | Lưu trữ và truy vấn | container `signoz-telemetrystore-clickhouse-0-0` |
| ⑤ SigNoz UI | Truy vấn ClickHouse, vẽ biểu đồ, cảnh báo | http://localhost:8080 |

Ba điểm đáng nhớ:

- **App không nói chuyện với SigNoz, chỉ nói OTLP.** Đổi sang Jaeger, Grafana Tempo, Datadog... chỉ
  là đổi `OTEL_EXPORTER_OTLP_ENDPOINT`, không sửa dòng code nào.
- **Trace nối được qua 2 service nhờ header `traceparent`.** Khi order-service gọi
  `fetch('http://payment-service:3401/payments')`, instrumentation tự chèn
  `traceparent: 00-<trace-id 32 ký tự>-<span-id 16 ký tự>-01`. payment-service đọc header đó và tạo span
  của mình làm con của span phía gọi, nên cả hai nằm chung một trace.
- **Trang Services không cần metric nào từ app.** Số request/giây, tỉ lệ lỗi, P99 là do processor
  `signozspanmetrics` trong collector tính từ span (thành các metric `signoz_calls_total`,
  `signoz_latency`...). Metric riêng của app (`shop.orders`...) dùng cho Dashboard.

Từ lúc gọi API tới lúc thấy trên SigNoz mất khoảng **5–20 giây**: chờ SDK gửi lô (5 giây với trace,
15 giây với metric) cộng thời gian collector gom lô.

---

## 3. Cấu trúc thư mục

```
150_nodejs_signoz/
├── README.md
├── package.json, package-lock.json
├── Dockerfile                       multi-stage, node:26-slim, chạy bằng user "node", có HEALTHCHECK
├── .dockerignore, .gitignore
├── .env.example                     mẫu biến môi trường, copy thành .env
├── docker-compose.yml               CÁCH A: app chung network với SigNoz → http://signoz-ingester:4318
├── docker-compose.standalone.yml    CÁCH B: SigNoz chạy riêng / SigNoz Cloud → http://host.docker.internal:4318
├── signoz/
│   └── casting.yaml                 cấu hình Foundry để cài SigNoz bằng Docker Compose
├── src/
│   ├── tracing.js                   khởi tạo OpenTelemetry SDK (traces + metrics + logs), nạp bằng --require
│   ├── server.js                    order-service: Express 5, cổng 3400
│   ├── payment-service.js           payment-service giả lập "service bên ngoài", cổng 3401
│   ├── routes/
│   │   ├── products.js              GET /api/products, GET /api/products/:id
│   │   ├── orders.js                POST /api/orders (luồng nghiệp vụ chính), GET /api/orders/:id
│   │   └── demo.js                  GET /api/error (cố tình lỗi), GET /api/slow (cố tình chậm)
│   └── lib/
│       ├── telemetry.js             tracer, meter, hàm withSpan(), các metric của app
│       ├── logger.js                pino; trace_id/span_id do instrumentation-pino tự chèn
│       ├── fake-db.js               PostgreSQL + Redis giả lập, mỗi thao tác là một span
│       ├── payment-client.js        gọi payment-service bằng fetch
│       ├── middlewares.js           header X-Trace-Id, access log, 404, error handler
│       └── utils.js                 sleep, randomInt, HttpError
├── scripts/
│   ├── generate-traffic.js          sinh traffic giả lập, in thống kê và vài trace lỗi để mở trên SigNoz
│   ├── check-otlp.js                chẩn đoán kết nối tới OTLP receiver (dùng khi không thấy dữ liệu)
│   └── verify.js                    kiểm thử end-to-end trên SigNoz thật: 35 check qua ClickHouse
└── test/
    └── telemetry.test.js            test tích hợp với OTLP receiver giả, không cần SigNoz (npm test)
```

| Lệnh npm | Làm gì |
|---|---|
| `npm start` | chạy order-service: `node --require ./src/tracing.js src/server.js` |
| `npm run start:payment` | chạy payment-service |
| `npm run dev` | chạy cả hai service trên máy (ngoài Docker), cổng 3400 + 3401 |
| `npm test` | test tích hợp telemetry, không cần SigNoz (mục 8.3) |
| `npm run verify` | kiểm thử end-to-end trên SigNoz đang chạy (mục 8.3) |
| `npm run traffic` | `node scripts/generate-traffic.js` |
| `npm run check:otlp` | `node scripts/check-otlp.js` |
| `npm run docker:up` / `docker:down` / `docker:logs` | `docker compose up -d --build` / `down` / `logs -f` |

---

## 4. Yêu cầu

- **Docker** có Compose v2 (Docker Desktop trên Windows/macOS, Docker Engine 20.10+ trên Linux).
- **RAM cho Docker ≥ 4 GB.** SigNoz gồm ClickHouse, ClickHouse Keeper, PostgreSQL, collector và
  server; ít RAM hơn thì container khởi động lại liên tục.
- Các cổng trống: 8080, 4317, 4318 (SigNoz), 3400, 3401 (app).
- **Node.js ≥ 22.15** chỉ khi muốn chạy app ngoài Docker (OpenTelemetry JS SDK 3.x yêu cầu bản này).
  Riêng hai script trong `scripts/` chạy được với mọi bản Node có `fetch` (≥ 18).

---

## 5. Bước 1: Cài và chạy SigNoz

### 5.1 Chọn cách cài

| Cách | Khi nào dùng | App kết nối bằng |
|---|---|---|
| **Foundry** (mục 5.2) | Cách chính thức hiện nay, khuyến nghị | `docker-compose.yml`, `http://signoz-ingester:4318` |
| **Clone repo + docker compose cũ** (mục 5.3) | Muốn đúng kiểu "git clone rồi docker compose up", hoặc đang có bản cũ | `docker-compose.yml` + sửa `.env`, `http://otel-collector:4318` |
| **SigNoz Cloud** (mục 5.4) | Không muốn tự vận hành | `docker-compose.standalone.yml` + ingestion key |

> Từ **SigNoz v0.130.0** (tháng 6/2026), script `install.sh` và các file docker-compose trong thư mục
> `deploy/` của repo SigNoz bị **ngừng hỗ trợ và đã xoá khỏi nhánh main**. Hướng dẫn trên mạng bảo
> `git clone` rồi `cd signoz/deploy/docker && docker compose up` sẽ không chạy được với code mới nhất;
> cách thay thế chính thức là **Foundry**.

### 5.2 Cách 1 (khuyến nghị): cài bằng Foundry

Foundry là CLI của SigNoz: đọc một file cấu hình (`casting.yaml`), sinh ra file Docker Compose của
SigNoz vào thư mục `pours/`, rồi chạy nó.

**Bước 1 — Cài `foundryctl`**

Linux / macOS (script tự nhận hệ điều hành, kiểm tra checksum, cài vào `~/.local/bin`):

```bash
curl -fsSL https://signoz.io/foundry.sh | bash
foundryctl --help
```

Windows PowerShell — tải bản build cho Windows rồi thêm vào PATH (cách demo đã chạy thử):

```powershell
New-Item -ItemType Directory -Force C:\tools\foundry | Out-Null
Set-Location C:\tools\foundry
$ARCH = if ($env:PROCESSOR_ARCHITECTURE -eq "ARM64") { "arm64" } else { "amd64" }
Invoke-WebRequest -Uri "https://github.com/SigNoz/foundry/releases/latest/download/foundry_windows_${ARCH}.tar.gz" -OutFile foundry.tar.gz -UseBasicParsing
tar -xzf foundry.tar.gz
# Chỉ có hiệu lực trong cửa sổ PowerShell này; muốn lâu dài thì thêm vào PATH của Windows.
$env:Path += ";C:\tools\foundry\foundry_windows_${ARCH}\bin"
foundryctl --help
```

**Bước 2 — Chạy SigNoz bằng casting có sẵn trong demo**

File [`signoz/casting.yaml`](signoz/casting.yaml) là cấu hình tối thiểu: Docker, flavor compose.

```bash
cd signoz
foundryctl cast -f casting.yaml
```

`cast` = kiểm tra công cụ (`gauge`) → sinh file (`forge`) → `docker compose up`. Lần đầu phải tải
image (ClickHouse, ClickHouse Keeper, PostgreSQL, collector, SigNoz — khoảng 3,5 GB trên đĩa); máy thử
mất 186 giây. Thêm `--no-ledger` nếu không muốn gửi thống kê sử dụng ẩn danh cho SigNoz.

Muốn **tự chạy docker compose của SigNoz** thay vì để `cast` làm:

```bash
cd signoz
foundryctl forge -f casting.yaml          # chỉ sinh file vào ./pours, không chạy gì
cd pours/deployment
docker compose up -d                      # pours/deployment/compose.yaml chính là compose của SigNoz
```

File sinh ra (`signoz/pours/`, `signoz/casting.yaml.lock`) đã nằm trong `.gitignore`.

**Bước 3 — Kiểm tra container**

```bash
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

```
NAMES                                       STATUS                  PORTS
signoz-telemetrystore-clickhouse-0-0        Up 45 seconds (healthy) 8123/tcp, 9000/tcp, 9009/tcp
signoz-telemetrykeeper-clickhousekeeper-0   Up 53 seconds (healthy) 2181/tcp, 9181/tcp, ...
signoz-metastore-postgres-0                 Up 53 seconds (healthy) 5432/tcp
signoz-signoz-0                             Up 48 seconds (healthy) 0.0.0.0:8080->8080/tcp
signoz-ingester-1                           Up 53 seconds           0.0.0.0:4317-4318->4317-4318/tcp
```

Hai container `signoz-telemetrystore-migrator` và `signoz-telemetrystore-clickhouse-user-scripts`
chạy một lần rồi dừng với `Exited (0)`: đó là bước tạo bảng trong ClickHouse, không phải lỗi.

| Thành phần | Container | Vai trò |
|---|---|---|
| signoz | `signoz-signoz-0` | API + giao diện web, cổng **8080** |
| ingester | `signoz-ingester-1` | OpenTelemetry Collector, cổng **4317** (gRPC), **4318** (HTTP) |
| telemetrystore | `signoz-telemetrystore-clickhouse-0-0` | ClickHouse, nơi lưu traces/metrics/logs |
| telemetrykeeper | `signoz-telemetrykeeper-clickhousekeeper-0` | ClickHouse Keeper, điều phối cho ClickHouse |
| metastore | `signoz-metastore-postgres-0` | PostgreSQL, lưu user, dashboard, alert |

Tất cả nằm trong network Docker **`signoz-network`**; collector có thêm alias **`signoz-ingester`**.
Đây là hai tên mà [`docker-compose.yml`](docker-compose.yml) của demo dùng để kết nối.

**Bước 4 — Tạo tài khoản admin đầu tiên (BẮT BUỘC)**

Mở **http://localhost:8080**. Lần đầu SigNoz hiện trang **Sign Up**: điền **Email address**, mật
khẩu (**Set your password**, nhập lại ở **Confirm your new password**) rồi bấm **Access My Workspace**.

Bước này không chỉ để đăng nhập. Collector của SigNoz nhận cấu hình pipeline từ server qua OpAMP, mà
server chỉ cấp cấu hình khi đã có **tổ chức** (organization) — thứ được tạo cùng tài khoản đầu tiên.
Trước đó collector chạy với pipeline rỗng và **không mở cổng 4317/4318**. Log của SigNoz cho thấy:

```bash
docker logs signoz-signoz-0 2>&1 | grep "cannot create agent"
```

```
{"level":"ERROR","msg":"failed to find or create agent", ... "exception.message":"cannot create agent without orgId"}
```

Chỉ vài giây sau khi tạo tài khoản, collector nạp cấu hình thật; `docker logs signoz-ingester-1` hiện
dòng `Starting HTTP server`.

**Bước 5 — Kiểm tra cổng OTLP/HTTP đã nhận dữ liệu**

```bash
curl -X POST http://localhost:4318/v1/traces -H "content-type: application/json" -d '{"resourceSpans":[]}'
# {"partialSuccess":{}}
```

PowerShell (gửi body nguyên văn, chạy giống nhau trên PowerShell 5.1 và 7):

```powershell
Invoke-RestMethod -Method Post http://localhost:4318/v1/traces -ContentType "application/json" -Body '{"resourceSpans":[]}'
```

Nhận `{"partialSuccess":{}}` (PowerShell in ra dòng `partialSuccess`, không báo lỗi) là collector đã
sẵn sàng. Nhận `Empty reply from server` hoặc `Connection reset` nghĩa là chưa làm bước 4.

### 5.3 Cách 2: clone repo SigNoz và chạy docker compose cũ (≤ v0.129.0)

Đúng kiểu "git clone rồi docker compose up" mà nhiều bài hướng dẫn vẫn ghi. File compose đã bị xoá
khỏi nhánh main từ v0.130.0, nên phải clone **tag `v0.129.0`** — bản cuối cùng còn giữ chúng:

```bash
git clone -b v0.129.0 --depth 1 https://github.com/SigNoz/signoz.git
cd signoz/deploy/docker
docker compose up -d --remove-orphans
```

Chỉ cần thư mục `deploy/` thì clone nhẹ hơn nhiều:

```bash
git clone -b v0.129.0 --depth 1 --filter=blob:none --sparse https://github.com/SigNoz/signoz.git
cd signoz && git sparse-checkout set deploy && cd deploy/docker
docker compose up -d --remove-orphans
```

Trên máy thử mất 162 giây (gồm tải image). Kết quả:

```
NAMES                            STATUS                    PORTS
signoz-otel-collector            Up 2 minutes              0.0.0.0:4317-4318->4317-4318/tcp
signoz                           Up 2 minutes (healthy)    0.0.0.0:8080->8080/tcp
signoz-clickhouse                Up 2 minutes (healthy)    8123/tcp, 9000/tcp, 9009/tcp
signoz-zookeeper-1               Up 3 minutes (healthy)    2181/tcp, 2888/tcp, 3888/tcp, 8080/tcp
signoz-telemetrystore-migrator   Exited (0)
signoz-init-clickhouse           Exited (0)
```

Khác biệt so với Foundry — **phải đặt lại trong `.env` của demo**:

| | Foundry | docker compose cũ (v0.129.0) |
|---|---|---|
| Network Docker | `signoz-network` | `signoz-net` |
| Tên collector trong network | `signoz-ingester` (service `ingester`) | `otel-collector` (container `signoz-otel-collector`) |
| ClickHouse | `signoz-telemetrystore-clickhouse-0-0` | `signoz-clickhouse` |
| UI | http://localhost:8080 | http://localhost:8080 |

```dotenv
SIGNOZ_NETWORK=signoz-net
SIGNOZ_OTLP_ENDPOINT=http://otel-collector:4318
```

Với hai dòng này, app gửi tới đúng `http://otel-collector:4318` như các hướng dẫn cũ — đã chạy thử,
dữ liệu cả ba loại đều vào ClickHouse của bản v0.129.0.

Bản này cũng **phải tạo tài khoản admin đầu tiên** ở http://localhost:8080 thì collector mới mở cổng
4318 (giống bước 4 ở mục 5.2). Cảnh báo `the attribute 'version' is obsolete` khi chạy compose là vô
hại. Lưu ý:

- v0.129.0 không còn được vá lỗi. Dùng để học thì được; dùng lâu dài thì chuyển sang Foundry theo
  [MIGRATION.md](https://github.com/SigNoz/signoz/blob/main/deploy/MIGRATION.md) (giữ được dữ liệu).
- **Không chạy song song** bản cũ và bản Foundry: cả hai cùng chiếm cổng 8080, 4317, 4318.

### 5.4 Cách 3: SigNoz Cloud

Không phải cài gì; app gửi thẳng lên SigNoz Cloud qua Internet.

1. Đăng ký tại https://signoz.io/teams/, tạo workspace.
2. Vào **Settings → Ingestion**: lấy **Ingestion Endpoint** (chứa region, ví dụ `us`, `eu`, `in`) và
   tạo một **Ingestion Key**.
3. Điền vào `.env`:

   ```dotenv
   OTEL_EXPORTER_OTLP_ENDPOINT=https://ingest.<region>.signoz.cloud:443
   OTEL_EXPORTER_OTLP_HEADERS=signoz-ingestion-key=<your-ingestion-key>
   ```

4. Chạy app bằng file compose "standalone" (không nối network SigNoz nào):

   ```bash
   docker compose -f docker-compose.standalone.yml up -d --build
   ```

SigNoz Cloud nhận cả OTLP/HTTP lẫn OTLP/gRPC trên cùng cổng **443**, và mọi request phải có header
`signoz-ingestion-key`. Ingestion key **chỉ dùng cho Cloud**; bản tự host không cần.

> Demo đã chạy thử với SigNoz tự host (cách 1 và 2). Phần SigNoz Cloud viết theo tài liệu chính thức
> (https://signoz.io/docs/ingestion/signoz-cloud/overview/), chưa chạy thử với tài khoản Cloud thật.

---

## 6. Bước 2: Cấu hình môi trường (.env)

```bash
cp .env.example .env          # PowerShell: Copy-Item .env.example .env
```

Không có `.env` thì các file compose dùng giá trị mặc định ghi sẵn, demo vẫn chạy với SigNoz cài
bằng Foundry. `docker compose` tự đọc `.env` cùng thư mục để thay các biến `${...}` trong file compose.

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `ORDER_SERVICE_PORT` / `PAYMENT_SERVICE_PORT` | `3400` / `3401` | Cổng mở ra máy host |
| `LOG_LEVEL` | `info` | Mức log của pino |
| `PAYMENT_FAILURE_RATE` | `0.15` | Tỉ lệ payment-service giả lập lỗi ngân hàng (0 = tắt) |
| `SERVICE_VERSION` | `1.0.0` | Ghép vào `OTEL_RESOURCE_ATTRIBUTES` thành `service.version` |
| `DEPLOYMENT_ENVIRONMENT` | `docker-demo` | Ghép thành `deployment.environment`, dùng cho bộ lọc Environment của SigNoz |
| `OTEL_LOG_LEVEL` | `warn` | Log nội bộ của SDK. `debug` khi điều tra lỗi gửi dữ liệu |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000` | Chu kỳ đẩy metric (ms) |
| `SIGNOZ_NETWORK` | `signoz-network` | **Cách A**: tên network Docker của SigNoz |
| `SIGNOZ_OTLP_ENDPOINT` | `http://signoz-ingester:4318` | **Cách A**: địa chỉ collector trong network đó |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://host.docker.internal:4318` | **Cách B**: địa chỉ collector nhìn từ trong container |
| `OTEL_EXPORTER_OTLP_HEADERS` | (trống) | **Cách B**: header kèm theo, ví dụ ingestion key của SigNoz Cloud |

> Cổng mặc định của app là 3400/3401, cố ý tránh 3000: máy dev Node thường đã có app khác chiếm
> 3000, và Docker Desktop trên Windows có khi **không báo lỗi** mà lặng lẽ bỏ qua việc mở cổng
> (xem mục 12.6).

---

## 7. Bước 3: Build và chạy ứng dụng

### 7.1 Cách A — chung network với SigNoz (`docker-compose.yml`)

Dùng khi SigNoz tự host chạy bằng Docker **trên cùng máy** (cách 1 hoặc 2 ở mục 5).

```bash
docker compose up -d --build
docker compose ps
```

```
NAME                                   STATUS                    PORTS
nodejs-signoz-demo-order-service-1     Up 12 seconds (healthy)   0.0.0.0:3400->3400/tcp
nodejs-signoz-demo-payment-service-1   Up 19 seconds (healthy)   0.0.0.0:3401->3401/tcp
```

Điều gì xảy ra trong [`docker-compose.yml`](docker-compose.yml) (rút gọn, bỏ các biến `${...}` phụ):

```yaml
x-app: &app
  build: .
  image: nodejs-signoz-demo:1.0.0
  networks:
    - default   # network riêng của project: order-service gọi payment-service
    - signoz    # network của SigNoz: gửi telemetry tới collector

x-otel-env: &otel-env
  OTEL_EXPORTER_OTLP_ENDPOINT: ${SIGNOZ_OTLP_ENDPOINT:-http://signoz-ingester:4318}
  OTEL_RESOURCE_ATTRIBUTES: service.namespace=shop-demo,service.version=1.0.0,deployment.environment=docker-demo

services:
  order-service:
    <<: *app
    environment:
      <<: *otel-env
      OTEL_SERVICE_NAME: order-service
      PAYMENT_SERVICE_URL: http://payment-service:3401
  payment-service:
    <<: *app
    command: ["node", "--require", "./src/tracing.js", "src/payment-service.js"]
    environment:
      <<: *otel-env
      OTEL_SERVICE_NAME: payment-service

networks:
  signoz:
    name: ${SIGNOZ_NETWORK:-signoz-network}
    external: true      # network do SigNoz tạo; project này chỉ "mượn", không tạo cũng không xoá
```

- Mỗi container nằm trong **hai** network. Docker có DNS nội bộ: trong `signoz-network`, tên
  `signoz-ingester` trỏ tới container collector, nên app gửi thẳng tới `http://signoz-ingester:4318`
  mà không đi vòng qua máy host.
- Cùng một image cho cả hai service; khác nhau ở **lệnh chạy** và **`OTEL_SERVICE_NAME`**. Đó cũng là
  thứ duy nhất khiến SigNoz thấy hai service riêng biệt.
- `OTEL_RESOURCE_ATTRIBUTES` gắn vào mọi span/metric/log. `deployment.environment` là thuộc tính mà
  SigNoz dùng cho bộ lọc **Environment**; collector của SigNoz còn lấy `service.namespace`,
  `service.version`, `deployment.environment` làm chiều cho metric APM.

Kiểm tra app gửi được tới collector — chạy ngay trong container, tức là đúng network và đúng biến
môi trường mà app đang dùng:

```bash
docker compose exec order-service node scripts/check-otlp.js
```

```
Endpoint gốc : http://signoz-ingester:4318
URL traces   : http://signoz-ingester:4318/v1/traces
Chạy ở       : bên trong container Docker

  [OK]   DNS: signoz-ingester → 172.20.0.6
  [OK]   POST /v1/traces → HTTP 200 {"partialSuccess":{}}

Kết luận: gửi được tới OTLP receiver.
```

### 7.2 Cách B — SigNoz chạy riêng hoặc SigNoz Cloud (`docker-compose.standalone.yml`)

Dùng khi app **không** chung network Docker với SigNoz: SigNoz ở máy khác, cài kiểu khác, hoặc là
SigNoz Cloud. App gửi tới một địa chỉ "từ bên ngoài":

| SigNoz ở đâu | `OTEL_EXPORTER_OTLP_ENDPOINT` trong `.env` |
|---|---|
| Chính máy này, đã mở cổng 4318 ra host | `http://host.docker.internal:4318` (mặc định) |
| Máy khác trong mạng LAN | `http://<ip-máy-đó>:4318` |
| SigNoz Cloud | `https://ingest.<region>.signoz.cloud:443` + `OTEL_EXPORTER_OTLP_HEADERS` |

```bash
docker compose -f docker-compose.standalone.yml up -d --build
docker compose -f docker-compose.standalone.yml exec order-service node scripts/check-otlp.js
```

```
  [OK]   DNS: host.docker.internal → 192.168.65.254
  [OK]   POST /v1/traces → HTTP 200 {"partialSuccess":{}}
```

`host.docker.internal` là tên Docker Desktop (Windows/macOS) đặt sẵn cho máy host. Trên Linux không có
tên này, nên file compose khai báo thêm:

```yaml
extra_hosts:
  - "host.docker.internal:host-gateway"
```

Hai file compose dùng chung tên project (`nodejs-signoz-demo`): chuyển qua lại giữa cách A và B thì
container được tạo lại, không bị trùng cổng.

### 7.3 Cách C — chạy app trên máy, không dùng Docker

Cần Node.js ≥ 22.15. App gửi tới `http://localhost:4318` (giá trị mặc định của SDK), tức collector
của SigNoz đã mở cổng ra máy host.

```bash
npm install
npm run dev          # order-service :3400 + payment-service :3401, có màu theo từng service
```

`npm run dev` dùng `cross-env` để đặt `OTEL_SERVICE_NAME` cho từng process. Chạy tay từng service:

```bash
# Git Bash / macOS / Linux
OTEL_SERVICE_NAME=order-service node --require ./src/tracing.js src/server.js
```

```powershell
# PowerShell
$env:OTEL_SERVICE_NAME = "order-service"; node --require ./src/tracing.js src/server.js
```

---

## 8. Bước 4: Sinh traffic để test

### 8.1 Script sinh traffic

```bash
# Trong container — không cần Node trên máy
docker compose exec order-service node scripts/generate-traffic.js

# Hoặc trên máy (Node >= 18)
node scripts/generate-traffic.js                       # 60 giây, 5 request/giây → http://localhost:3400
node scripts/generate-traffic.js --duration 300 --rps 10
node scripts/generate-traffic.js --duration 0          # chạy tới khi bấm Ctrl+C
```

Script trộn 9 kịch bản theo trọng số (phần lớn bình thường, xen ít lỗi), in tiến độ mỗi 5 giây, cuối
cùng in bảng thống kê và vài trace lỗi kèm đường dẫn mở thẳng trên SigNoz:

```
Kịch bản                          Số lần    2xx    4xx    5xx  Lỗi mạng   TB (ms)
─────────────────────────────────────────────────────────────────────────────────
GET  /api/products                   489    489      0      0         0         8
GET  /api/products/:id               361    361      0      0         0        26
GET  /api/products/:id  (404)         84      0     84      0         0        21
POST /api/orders                     878    748     26    104         0       321
POST /api/orders  (400)               87      0     87      0         0         3
GET  /api/orders/:id                 195    195      0      0         0        28
GET  /api/error                       74      0      0     74         0         7
GET  /api/error?type=db               62      0      0     62         0       273
GET  /api/slow                       168    168      0      0         0      1066
─────────────────────────────────────────────────────────────────────────────────
Tổng: 2398 request — 2xx=1961 4xx=197 5xx=240 lỗi mạng=0

Vài trace lỗi gần nhất, mở trên SigNoz (hoặc dán trace ID vào ô tìm kiếm của Traces):
  502 POST /api/orders  http://localhost:8080/trace/dd3c91322aa40bcee8646fb5e72a6b42
      payment-service trả về 502: Bank gateway timeout: ngân hàng không phản hồi
  500 GET  /api/error?type=db  http://localhost:8080/trace/4c49421b559736b23fc9568b81fdd4d0
      canceling statement due to statement timeout
```

(Kết quả một lần chạy 10 phút, 4 request/giây.)

### 8.3 Kiểm thử tự động: `npm test` và `npm run verify`

Hai lớp kiểm thử, chạy lại được bất cứ lúc nào:

| Lệnh | Cần gì | Kiểm tra gì |
|---|---|---|
| `npm test` | chỉ Node.js (≥ 22.15), **không** cần Docker hay SigNoz | Ứng dụng phát ra đúng telemetry |
| `npm run verify` | SigNoz tự host (Docker) + app đang chạy | Telemetry đi hết đường App → Collector → ClickHouse |

**`npm test`** ([`test/telemetry.test.js`](test/telemetry.test.js)) chạy order-service và payment-service
thật, đúng lệnh `node --require ./src/tracing.js ...`, nhưng thay SigNoz bằng một OTLP receiver giả
dựng ngay trong test, rồi kiểm tra từng gói traces/metrics/logs mà SDK gửi tới: trace nối qua 2
service bằng `traceparent`, span DB có `db.system`, lỗi gốc nằm ở `bank.authorize`, 4xx không bị tô đỏ,
`/health` không sinh span, log mang trace_id và `exception.*`, metric của app/HTTP/runtime có mặt,
SIGTERM thì flush rồi thoát.

```
✔ order thành công: một trace đi qua cả 2 service, cha-con nối đúng qua traceparent
✔ resource: lấy từ OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES, không có host.id
✔ thanh toán thất bại: lỗi gốc ở bank.authorize, order trả 502 và chạy bù trừ
✔ GET /api/error: exception được ghi, span gốc là ERROR với mã 500
✔ GET /api/error?type=db: exception nằm ở span DB, exception.type = 57014
✔ 4xx (400, 404, 409) KHÔNG bị đánh dấu là lỗi
✔ /health không tạo span nào (healthcheck của Docker không làm ngập trace)
✔ logs: gửi qua OTLP, mang trace_id/span_id, log lỗi có exception.*
✔ metrics: metric của app, của HTTP và của Node runtime đều được gửi
✔ khởi động sạch: có dòng [otel], không có cảnh báo của SDK
✔ SIGTERM: SDK flush telemetry rồi thoát
ℹ tests 11
ℹ pass 11
```

Trên Windows, test SIGTERM tự bỏ qua (Windows không gửi được tín hiệu đó cho process con). Chạy đủ
11 test trên Node 26 Linux, ngay trong image của app (cần build image trước: `docker compose build`):

```powershell
# PowerShell
docker run --rm -v "${PWD}\test:/app/test:ro" --entrypoint node nodejs-signoz-demo:1.0.0 --test --test-reporter=spec test/telemetry.test.js
```

```bash
# macOS / Linux (Git Bash trên Windows: thêm MSYS_NO_PATHCONV=1 ở đầu lệnh)
docker run --rm -v "$PWD/test:/app/test:ro" --entrypoint node nodejs-signoz-demo:1.0.0 --test --test-reporter=spec test/telemetry.test.js
```

**`npm run verify`** ([`scripts/verify.js`](scripts/verify.js)) gọi API thật, giữ lại trace ID từ header
`X-Trace-Id`, rồi truy vấn thẳng ClickHouse của SigNoz (qua `docker exec`, không cần API key) để
kiểm tra 35 điểm: trace đủ 2 service và nối đúng cha-con, *Database Calls* / *External Calls* có dữ
liệu, exception vào bảng lỗi, log khớp trace_id, metric mới được ghi (kể cả `signoz_calls_total` do
collector tính cho trang Services). Script tự nhận ra ClickHouse của cả bản Foundry lẫn bản compose cũ.

```
[3] Chờ trace vào ClickHouse (tối đa 90 s) ... 6 s
  ✓ đủ 5 trace đã vào ClickHouse (kể cả phần của payment-service)  — 5/5

[4] Traces
  ✓ đơn thành công: trace đi qua cả order-service và payment-service  — order-service, payment-service
  ✓ traceparent: span của payment-service là con của span fetch bên order-service
  ✓ Database Calls: span DB có dbSystem = postgresql, dbName = shop
  ...
Kết quả: 35/35 check đạt (13 s)
```

Cấu hình sai (ví dụ endpoint trỏ nhầm `otel-collector` khi dùng Foundry) thì verify báo lỗi ở các check
trace/log/metric và thoát với mã 1. Verify cần có cả đơn thành công lẫn đơn thất bại, nên
`PAYMENT_FAILURE_RATE` phải nằm giữa 0 và 1 (không phải đúng 0 hay đúng 1); có thể ghi đè tạm khi chạy:

```bash
PAYMENT_FAILURE_RATE=0.15 docker compose up -d     # PowerShell: $env:PAYMENT_FAILURE_RATE="0.15"; docker compose up -d
npm run verify
```

### 8.2 Gọi tay từng endpoint

| Endpoint | Kết quả | Thấy gì trên SigNoz |
|---|---|---|
| `GET /health` | 200 | Không có gì: cố ý bỏ qua để healthcheck của Docker không làm ngập trace |
| `GET /api/products` | 200 | Span `redis GET`; cache miss thì thêm `SELECT shop.products` + `redis SET` |
| `GET /api/products/p-1001` | 200 / 404 | 404 **không** bị tính là lỗi (lỗi của client) |
| `POST /api/orders` | 201 / 400 / 404 / 409 / 502 | Trace 17–18 span qua 2 service; 502 khi ngân hàng giả lập lỗi (~15%) |
| `GET /api/orders/ORD-000001` | 200 / 404 | Span `SELECT shop.orders` |
| `GET /api/error` | 500 | Exception trong span `request handler - /api/error` |
| `GET /api/error?type=db` | 500 | Exception bắt nguồn từ span DB `SELECT shop.order_reports` (SQLSTATE 57014) |
| `GET /api/slow` | 200 sau 0,5–2 s | Span `report.generate` → DB chậm, `report.aggregate` (chặn event loop), `report.render` |

Mọi response đều có header **`X-Trace-Id`**; response lỗi có thêm trường `traceId`. Dán trace ID vào
`http://localhost:8080/trace/<traceId>` là mở đúng trace của request đó.

```bash
curl -i http://localhost:3400/api/products                    # xem header X-Trace-Id
curl -X POST http://localhost:3400/api/orders -H "content-type: application/json" \
     -d '{"productId":"p-1001","quantity":2,"customerId":"c-007"}'
curl http://localhost:3400/api/error
curl "http://localhost:3400/api/error?type=db"
curl http://localhost:3400/api/slow
```

PowerShell:

```powershell
Invoke-RestMethod http://localhost:3400/api/products
Invoke-RestMethod -Method Post http://localhost:3400/api/orders -ContentType "application/json" `
  -Body '{"productId":"p-1001","quantity":2,"customerId":"c-007"}'
(Invoke-WebRequest http://localhost:3400/api/products -UseBasicParsing).Headers["X-Trace-Id"]
```

Một đơn hàng thành công:

```json
{
  "id": "ORD-000001",
  "productId": "p-1001",
  "quantity": 2,
  "customerId": "c-007",
  "amount": 770000,
  "status": "PAID",
  "paymentId": "pay_58f84872",
  "createdAt": "2026-11-05T11:41:05.581Z",
  "updatedAt": "2026-11-05T11:41:05.813Z"
}
```

Sản phẩm `p-1005` cố ý chỉ có 25 hộp: đặt vài đơn là hết hàng (409). Một job chạy nền mỗi phút nhập
lại hàng cho sản phẩm sắp hết — job này tự mở trace riêng tên `inventory.restock`, ví dụ cho trace
không xuất phát từ HTTP.

---

## 9. Bước 5: Xem dữ liệu trên SigNoz

Mở **http://localhost:8080**, đăng nhập. Menu bên trái (bản v0.149): **Home, Alerts, Dashboards**,
nhóm lối tắt **Services, Logs, Traces, Infrastructure**, nhóm **More** có **Metrics, Exceptions,
External APIs, Service Map**... Góc phải trên mỗi trang có ô chọn khoảng thời gian (mặc định
*Last 30 minutes*) và nút làm mới.

### 9.1 Services — sức khoẻ từng service (APM)

**Services** liệt kê mọi service đã gửi trace:

| Application | P99 latency (in ms) | Error Rate (% of total) | Operations Per Second |
|---|---|---|---|
| order-service | ~1300 | ~9.5 | ~0.3 |
| payment-service | ~940 | ~12.3 | ~0.1 |

Ô **Select Environment/s** phía trên lọc theo `deployment.environment` (demo đặt `docker-demo`).

Bấm vào `order-service` để xem chi tiết. Ba tab:

- **Overview**
  - *Latency*: đường p50, p90, p99 theo thời gian. `/api/slow` kéo p99 lên trên 1 giây.
  - *Rate (ops/s)*: số request mỗi giây.
  - *Apdex*: chỉ số hài lòng 0–1 so với ngưỡng thời gian phản hồi (góc biểu đồ ghi `Threshold 0.5`).
  - *Key Operations*: bảng từng operation (`POST /api/orders`, `GET /api/slow`, `SELECT shop.orders`...)
    với P50/P95/P99, số lần gọi, tỉ lệ lỗi. Bật **Entrypoint Spans** để chỉ xem span điểm vào của service.
  - Các nút **View traces** / **View logs** đi kèm biểu đồ dẫn sang trace/log của service này.
- **DB Call Metrics**: số lần gọi và độ trễ theo `db.system` (postgresql, redis), lấy từ các span
  DB giả lập — có được nhờ các span đó đặt thuộc tính `db.system`.
- **External Metrics**: lời gọi HTTP ra ngoài, theo địa chỉ đích (`payment-service`).

### 9.2 Service Map

**Service Map** (trong nhóm More) vẽ đồ thị phụ thuộc: `order-service` nối tới `payment-service`,
`postgresql` và `redis`. Hai nút database xuất hiện chỉ nhờ thuộc tính `db.system` trên span; màu đỏ
là nút có tỉ lệ lỗi cao.

### 9.3 Traces — tìm và lọc

**Traces** mở *Traces Explorer*. Các kiểu xem: **List View** (từng span), **Trace View** (gom theo
trace), **Time Series**, **Table**. Bên trái là bộ lọc nhanh (Duration, Deployment Environment,
Has Error, Service Name, Response Status Code, Http Route...). Ô filter nhận biểu thức, bấm
**Run Query**. Các biểu thức đã chạy thử:

```
service.name = 'order-service' AND has_error = true
app.customer.id = 'c-007'
```

Biểu thức thứ hai lọc theo thuộc tính nghiệp vụ mà code tự gắn (mục 10.3), và trả về span của **cả
hai** service, vì payment-service cũng gắn `app.customer.id`.

### 9.4 Đọc một trace

Bấm một dòng, hoặc mở `http://localhost:8080/trace/<traceId>`. Trang trace có **Flame Graph** và
**Waterfall**, góc phải ghi số span và số lỗi, có công tắc **Highlight errors**. Một đơn hàng thanh
toán **thất bại** (18 span, 5 span lỗi), đúng như SigNoz hiển thị:

```
POST /api/orders                              order-service      502   878 ms
├── middleware - jsonParser
├── middleware - requestContext
├── request handler - /api/orders                                     ✗
│   ├── order.validate                        span tự tạo
│   ├── SELECT shop.products                  DB giả lập
│   ├── UPDATE shop.products                  trừ kho
│   ├── INSERT shop.orders                    ghi đơn
│   ├── POST                                  fetch → payment-service  502
│   │   └── POST /payments                    payment-service    502
│   │       ├── middleware - jsonParser
│   │       ├── middleware - requestContext
│   │       └── request handler - /payments
│   │           ├── fraud.check
│   │           └── bank.authorize            ✗ LỖI GỐC: Bank gateway timeout (781 ms)
│   ├── UPDATE shop.orders                    đánh dấu PAYMENT_FAILED
│   └── UPDATE shop.products                  hoàn lại kho
└── router - /
```

Cách đọc: lỗi lan từ dưới lên. Span sâu nhất bị đánh dấu lỗi (`bank.authorize`) là nguyên nhân; các
span cha chỉ chịu hậu quả. Hai span `UPDATE` cuối cho thấy code đã chạy bước bù trừ. Bấm một span để
xem chi tiết của nó: thuộc tính (`db.statement`, `http.response.status_code`, `app.order.id`...) và
event `exception` kèm stack trace với span bị lỗi.

Trace của một đơn **thành công** có cùng cấu trúc, nhưng không có hai span bù trừ và cuối cùng là
`UPDATE shop.orders` đặt trạng thái PAID.

### 9.5 Logs — và nối log với trace

**Logs** mở *Logs Explorer*. Bộ lọc nhanh: Severity Text, Deployment Environment, Service Name, Host
Name. Biểu thức đã chạy thử:

```
service.name = 'order-service' AND severity_text = 'error'
```

Bấm một dòng log để mở bảng chi tiết: SERVICE, SEVERITY, NAMESPACE, ENVIRONMENT, **TRACE ID** (là
link) và SPAN ID, cùng toàn bộ thuộc tính. Log lỗi có `exception.type`, `exception.message`,
`exception.stacktrace` — chuyển từ key `err` của pino. **Bấm vào TRACE ID là mở thẳng trace** chứa dòng
log đó; chiều ngược lại, nút **View logs** trên trang service, hoặc lọc log theo `trace_id`.

Dòng log trên stdout của container (`docker compose logs order-service`) cũng mang sẵn trace_id:

```json
{"level":"info","time":"2026-11-05T11:41:05.814Z","pid":1,"hostname":"60e922a4e7af",
 "trace_id":"823e7ea5ed3edf7c56bd9673de78a6cb","span_id":"fa41fdb25cb2ab07","trace_flags":"01",
 "orderId":"ORD-000001","paymentId":"pay_58f84872","amount":770000,"msg":"Đơn đã thanh toán"}
```

### 9.6 Exceptions và External APIs

- **Exceptions** (nhóm More): gom exception theo kiểu và thông báo, kèm số lần, lần đầu/lần cuối, service.
  Demo sinh 4 nhóm: `Error` (từ `/api/error`), `57014` (timeout DB), `HttpError` (order-service nhận
  502) và `Error` "Bank gateway timeout" (payment-service). Kiểu `57014` là vì OpenTelemetry lấy
  `err.code` làm `exception.type` khi có — giống hệt lỗi thật của thư viện `pg`.
- **External APIs**: các domain mà service gọi ra ngoài: `payment-service` và `api.bank.example` (span
  `bank.authorize` giả lập), kèm tốc độ gọi, tỉ lệ lỗi, độ trễ trung bình.

### 9.7 Dashboards — vẽ biểu đồ từ metric của app

Các bước đã chạy thử trên v0.149:

1. **Dashboards → New dashboard → tab Blank**, đặt tên (ví dụ `Shop Demo`) → **Create dashboard**.
2. **New Panel** → chọn **Time Series** → **Add panel**.
3. Trong *Configure panel*, tab **Query Builder**, nguồn dữ liệu **Metrics**. Bấm ô
   *Search for a metric...* và gõ `shop`, danh sách gợi ý hiện kèm loại metric:

   ```
   shop.orders                      Sum
   shop.payment.duration.bucket     Histogram   (.count, .sum, .min, .max đi kèm)
   shop.product.stock               Gauge
   shop.revenue                     Sum
   ```

4. Chọn `shop.orders`. SigNoz tự đặt **Aggregate within time series = Rate** (vì là counter) và
   **Aggregate across time series = Sum**. Ở ô **by**, chọn `order.status`.
5. **Run Query**: hiện 4 đường `success`, `payment_failed`, `rejected`, `out_of_stock`.
6. Đặt **Title** ở khung bên phải → **Save changes**.

Gợi ý thêm vài panel:

| Panel | Metric | Cấu hình |
|---|---|---|
| Đơn hàng/giây theo kết quả | `shop.orders` | Rate, Sum by `order.status` |
| Doanh thu/giây (VND) | `shop.revenue` | Rate, Sum |
| Thời gian chờ thanh toán p95 | `shop.payment.duration.bucket` | P95, by `payment.outcome` |
| Tồn kho từng sản phẩm | `shop.product.stock` | Avg, by `product.id` |
| Độ trễ HTTP p99 của server | `http.server.request.duration.bucket` | P99, by `service.name` |
| Event loop delay p99 | `nodejs.eventloop.delay.p99` | Max, by `service.name` |
| Heap đang dùng | `v8js.memory.heap.used` | Sum, by `service.name` |

Metric `http.*`, `nodejs.*`, `v8js.*` do auto-instrumentation sinh ra, không cần viết code. Gọi
`/api/slow` vài lần sẽ thấy `nodejs.eventloop.delay.p99` nhô lên — do vòng lặp CPU cố ý trong span
`report.aggregate`.

Dashboard dựng sẵn cho nhiều công nghệ phổ biến: https://github.com/SigNoz/dashboards (nhập bằng
**New dashboard → Import JSON**).

### 9.8 Kiểm tra trực tiếp trong ClickHouse (tuỳ chọn)

Khi UI trống, truy vấn thẳng kho dữ liệu để biết vấn đề nằm ở phía gửi hay phía hiển thị:

```bash
docker exec signoz-telemetrystore-clickhouse-0-0 clickhouse-client -q "
  SELECT serviceName, count() AS spans, countIf(has_error) AS error_spans
  FROM signoz_traces.distributed_signoz_index_v3
  WHERE timestamp > now() - INTERVAL 15 MINUTE
  GROUP BY serviceName"
```

```
order-service     2401   86
payment-service    654   28
```

Có dòng nghĩa là dữ liệu đã vào kho. Bảng logs là `signoz_logs.distributed_logs_v2`, metric là
`signoz_metrics.distributed_time_series_v4` + `distributed_samples_v4`. Với SigNoz cài bằng docker
compose cũ, container ClickHouse tên là `signoz-clickhouse`.

---

## 10. Giải thích code

### 10.1 `src/tracing.js` — khởi tạo SDK

```js
const sdk = new NodeSDK({
  resource,                                     // service.version, service.namespace, host.name mặc định
  resourceDetectors: [envDetector, processDetector, osDetector, serviceInstanceIdDetector],
  traceExporter: new OTLPTraceExporter(),       // → ${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),       // → /v1/metrics
      exportIntervalMillis: 15_000,
    }),
  ],
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })], // → /v1/logs
  instrumentations: [getNodeAutoInstrumentations({ /* ... */ })],
});
sdk.start();
```

- **Vì sao `--require`.** Auto-instrumentation vá module `http`, `express`, `pino`... đúng lúc chúng được
  `require` lần đầu. Nạp tracing.js sau `express` thì Express không được vá, trace chỉ còn span HTTP
  trơ trọi. `--require` chạy file trước cả file chính, nên không bao giờ sai thứ tự. App viết ESM
  (`import`) thì dùng `node --import ./tracing.mjs` thay cho `--require`.
- **Không truyền `url` cho exporter.** Exporter tự đọc `OTEL_EXPORTER_OTLP_ENDPOINT` rồi nối
  `/v1/traces` (`/v1/metrics`, `/v1/logs`). Không có biến này thì mặc định `http://localhost:4318`.
- **Resource.** Code chỉ đặt giá trị mặc định; `envDetector` đọc `OTEL_SERVICE_NAME` và
  `OTEL_RESOURCE_ATTRIBUTES`, và giá trị từ biến môi trường **thắng**. `hostDetector` bị bỏ khỏi danh
  sách: image `node:*-slim` không có `/etc/machine-id` nên nó in cảnh báo vô hại
  `dropping invalid resource attribute value for key "host.id"` mỗi lần khởi động.
- **Bật log cảnh báo của SDK.** Mặc định SDK **im lặng** khi gửi thất bại. tracing.js bật mức WARN
  (`OTEL_LOG_LEVEL` ghi đè được) để lỗi như `ECONNREFUSED` hiện ra trong `docker compose logs`.
- **Bỏ bớt instrumentation gây nhiễu.** `/health` bị bỏ qua; `dns`, `net` tắt; `router` tắt vì Express 5
  chạy trên package `router`, bật cả hai thì mỗi middleware bị tạo span hai lần.
- **Tắt êm.** Bắt `SIGTERM`/`SIGINT`, gọi `sdk.shutdown()` để gửi nốt dữ liệu còn trong buffer rồi mới
  thoát. Không có bước này, vài giây telemetry cuối cùng trước `docker stop` sẽ mất.

Đổi so với các bài viết cũ (SDK 1.x/2.x): từ SDK 3.0, `metricReader` (số ít) không còn, dùng
`metricReaders: [...]`; `BatchLogRecordProcessor` nhận object `{ exporter }`; `@opentelemetry/sdk-node`
không còn re-export `metrics`, `logs`, nên import thẳng từ `@opentelemetry/sdk-metrics`,
`@opentelemetry/sdk-logs`.

### 10.2 Span tự tạo — `withSpan()` trong `src/lib/telemetry.js`

```js
function withSpan(name, options, fn) {
  return tracer.startActiveSpan(name, options, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err);                                   // exception + stack trace
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();                                                  // luôn đóng span
    }
  });
}
```

`startActiveSpan` đặt span thành **active** trong lúc `fn` chạy, nên mọi span con (kể cả span fetch của
auto-instrumentation) và mọi dòng log bên trong tự gắn vào nó. Ví dụ trong `payment-service.js`:

```js
await withSpan('bank.authorize', {
  kind: SpanKind.CLIENT,                 // gọi ra hệ thống bên ngoài
  attributes: { 'peer.service': 'bank-gateway', 'url.full': 'https://api.bank.example/v1/authorize' },
}, async (span) => { /* ... */ });
```

`src/lib/fake-db.js` làm tương tự cho từng câu SQL, với các thuộc tính chuẩn cho database
(`db.system`, `db.name`, `db.operation`, `db.statement`...). Đó là lý do SigNoz vẽ được tab
*DB Call Metrics* và hai nút `postgresql`, `redis` trên Service Map dù không có database thật nào.
Với `pg`, `mysql2`, `ioredis`... thật, auto-instrumentation tự sinh span y hệt.

### 10.3 Thuộc tính nghiệp vụ, lỗi 4xx và 5xx

```js
span?.setAttributes({ 'app.customer.id': customerId, 'app.product.id': productId, 'app.order.quantity': quantity });
```

Thuộc tính tự đặt có tiền tố `app.` để không đụng tên chuẩn của OpenTelemetry; nhờ chúng mà lọc được
`app.customer.id = 'c-007'` ở mục 9.3.

Kết quả **4xx** (400, 404, 409) được trả thẳng bằng `res.status(4xx)` thay vì ném lỗi: instrumentation
HTTP không đánh dấu span server là lỗi với mã 4xx, nên tỉ lệ lỗi trên SigNoz chỉ phản ánh sự cố thật
(5xx). Lỗi nghiệp vụ đã được xử lý (thanh toán thất bại) thì code tự gọi `span.recordException()` để
nó vẫn hiện ở tab Exceptions. Lỗi không lường trước (`/api/error`) cứ ném ra: Express 5 chuyển tới
`errorHandler`, instrumentation-express tự ghi exception, instrumentation-http tự đánh dấu span gốc là
lỗi vì mã 500.

### 10.4 Metric của app

```js
const ordersCounter  = meter.createCounter('shop.orders',  { unit: '{order}' });   // chỉ tăng
const revenueCounter = meter.createCounter('shop.revenue', { unit: 'VND' });
const paymentDuration = meter.createHistogram('shop.payment.duration', { unit: 'ms' }); // p50/p95/p99

ordersCounter.add(1, { 'order.status': 'success' });   // thuộc tính = chiều để "group by"

meter.createObservableGauge('shop.product.stock')       // SDK tự gọi callback mỗi lần xuất metric
  .addCallback((result) => {
    for (const p of products.values()) result.observe(p.stock, { 'product.id': p.id });
  });
```

SigNoz giữ nguyên tên có dấu chấm (`shop.orders`). Histogram hiện thành nhóm
`shop.payment.duration.bucket/.count/.sum/.min/.max`. Thuộc tính nên ít giá trị (trạng thái, mã sản
phẩm), **không** đưa mã đơn hay user ID vào metric: mỗi giá trị khác nhau là một chuỗi thời gian mới.

### 10.5 Log nối với trace

[`src/lib/logger.js`](src/lib/logger.js) chỉ là pino bình thường. instrumentation-pino (bật sẵn trong
auto-instrumentations-node) lo hết: chèn `trace_id`, `span_id`, `trace_flags` vào mỗi dòng log ghi
trong lúc có span đang chạy, và gửi bản sao mỗi dòng thành LogRecord qua OTLP. Điều kiện duy nhất:
pino phải được `require` **sau** tracing.js — `--require` đảm bảo việc đó.

---

## 11. Biến môi trường OpenTelemetry hay dùng

| Biến | Ví dụ | Ý nghĩa |
|---|---|---|
| `OTEL_SERVICE_NAME` | `order-service` | Tên service trên SigNoz. Thiếu thì thành `unknown_service:node` |
| `OTEL_RESOURCE_ATTRIBUTES` | `deployment.environment=docker-demo,service.version=1.0.0` | Thuộc tính gắn vào mọi tín hiệu |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://signoz-ingester:4318` | Địa chỉ **gốc**; SDK tự nối `/v1/traces`... |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | `http://x:4318/v1/traces` | URL **đầy đủ** riêng cho traces, ưu tiên hơn biến trên |
| `OTEL_EXPORTER_OTLP_HEADERS` | `signoz-ingestion-key=abc` | Header gửi kèm (SigNoz Cloud) |
| `OTEL_LOG_LEVEL` | `debug` | Log nội bộ của SDK |
| `OTEL_SDK_DISABLED` | `true` | Tắt hẳn OpenTelemetry, app vẫn chạy |
| `OTEL_TRACES_SAMPLER` / `OTEL_TRACES_SAMPLER_ARG` | `parentbased_traceidratio` / `0.1` | Chỉ giữ 10% trace (production) |
| `OTEL_BSP_SCHEDULE_DELAY` | `5000` | Chu kỳ gửi lô span (ms) |
| `OTEL_METRIC_EXPORT_INTERVAL` | `15000` | Chu kỳ gửi metric (ms) — tracing.js đọc biến này |
| `OTEL_NODE_DISABLED_INSTRUMENTATIONS` | `fs,dns` | Tắt instrumentation theo tên rút gọn |

---

## 12. Xử lý sự cố

Câu hỏi đầu tiên luôn là: **dữ liệu kẹt ở chặng nào** trong luồng ở mục 2? Theo thứ tự:

1. App có chạy không? → `docker compose ps`, `docker compose logs order-service`
2. App có gửi được tới collector không? → `docker compose exec order-service node scripts/check-otlp.js`
3. Collector có ghi vào ClickHouse không? → `npm run verify` (mục 8.3), hoặc truy vấn ở mục 9.8
4. UI có đang xem đúng khoảng thời gian, đúng environment không?

### 12.1 Không thấy service nào trên SigNoz

- **Chưa tạo tài khoản admin đầu tiên** (mục 5.2, bước 4). Collector chưa mở cổng 4318. Dấu hiệu: từ
  máy host `curl` báo `Empty reply from server`; trong container app báo `ECONNREFUSED`; log của
  `signoz-signoz-0` có `cannot create agent without orgId`.
- **Chưa đợi đủ lâu.** Trace mất ~5–20 giây mới hiện, metric 15 giây.
- **Sai khoảng thời gian.** Chọn lại *Last 15 minutes* ở góc phải.
- **Xem log của app.** tracing.js bật mức WARN nên mọi lần gửi thất bại đều có dòng báo lỗi:

  ```bash
  docker compose logs order-service | grep -iE "error|timed out|ECONN|EAI_AGAIN"
  ```

  Cần chi tiết hơn: đặt `OTEL_LOG_LEVEL=debug` trong `.env`, chạy lại `docker compose up -d`.

### 12.2 Sai endpoint — đối chiếu thông báo lỗi

Gửi telemetry thất bại **không làm hỏng app**: request vẫn được phục vụ bình thường, chỉ là dữ liệu
không tới SigNoz và log có dòng báo lỗi. Các dòng dưới đây là log thật của app khi cố tình cấu hình sai:

| Log của app | Nguyên nhân | Sửa |
|---|---|---|
| `getaddrinfo EAI_AGAIN otel-collector` (hoặc `ENOTFOUND`) | Tên collector không tồn tại trong network của container: dùng tên của bản cũ (`otel-collector`) với SigNoz cài bằng Foundry, hoặc container không chung network | Foundry: `http://signoz-ingester:4318`; bản cũ: `http://otel-collector:4318` + `SIGNOZ_NETWORK=signoz-net` |
| `connect ECONNREFUSED 127.0.0.1:4318` | Dùng `localhost` **trong container**: localhost là chính container đó | Dùng tên collector (cách A) hoặc `host.docker.internal` (cách B) |
| `connect ECONNREFUSED 192.168.65.254:4318` | Cách B: tới được máy host (`host.docker.internal`) nhưng không có gì nghe ở 4318 — SigNoz chưa chạy, chưa tạo tài khoản đầu tiên, hoặc chưa mở cổng ra host | Bật SigNoz, làm bước 4 ở mục 5.2 |
| `OTLPExporterError: Not Found` | Tự thêm `/v1/traces` vào `OTEL_EXPORTER_OTLP_ENDPOINT` → URL thành `/v1/traces/v1/traces`; hoặc sai cổng | Endpoint chỉ là địa chỉ gốc: `http://signoz-ingester:4318` |
| `Parse Error: Expected HTTP/, RTSP/ or ICE/` | Gửi vào cổng **4317** (gRPC) bằng exporter HTTP | Đổi sang **4318** |
| `PeriodicExportingMetricReader: metrics export timed out after 15000ms` | Đi kèm các lỗi trên: không gửi được nên hết giờ chờ | Sửa lỗi gốc ở dòng log phía trên nó |
| HTTP 401 / 403 | SigNoz Cloud: thiếu hoặc sai `signoz-ingestion-key` | Kiểm tra `OTEL_EXPORTER_OTLP_HEADERS` |

`scripts/check-otlp.js` tự phát hiện các trường hợp này:

```
Endpoint gốc : http://signoz-ingester:4318/v1/traces
URL traces   : http://signoz-ingester:4318/v1/traces/v1/traces
  [LỖI]  Endpoint đã có sẵn /v1/... nên thành ".../v1/traces/v1/traces". OTEL_EXPORTER_OTLP_ENDPOINT chỉ là địa chỉ GỐC, SDK tự nối /v1/traces.
  [OK]   DNS: signoz-ingester → 172.20.0.6
  [LỖI]  HTTP 404: có server trả lời nhưng không có /v1/traces/v1/traces. Sai cổng (không phải 4318?) hoặc sai đường dẫn.
```

### 12.3 Network giữa các container

**`network signoz-network declared as external, but could not be found`** khi `docker compose up`:
SigNoz chưa chạy, hoặc network của nó tên khác. Xem tên thật:

```bash
docker network ls | grep -i signoz
```

| Thấy network | Cài bằng | Đặt trong `.env` |
|---|---|---|
| `signoz-network` | Foundry | mặc định, không cần đặt |
| `signoz-net` | docker compose cũ của repo (≤ v0.129.0) | `SIGNOZ_NETWORK=signoz-net`, `SIGNOZ_OTLP_ENDPOINT=http://otel-collector:4318` |
| không thấy gì | SigNoz chạy ở máy khác / Cloud | dùng `docker-compose.standalone.yml` |

Đổi `metadata.name` trong `casting.yaml` thì tên network đổi theo — nhớ sửa `SIGNOZ_NETWORK`.

Xem container nào đang ở trong network của SigNoz, và tên/alias của collector:

```bash
docker network inspect signoz-network --format "{{range .Containers}}{{.Name}} {{end}}"
docker inspect signoz-ingester-1 --format "{{json .NetworkSettings.Networks}}"
```

Container của app phải có mặt trong danh sách đầu (`nodejs-signoz-demo-order-service-1`...).

Vì network thuộc về SigNoz, thứ tự an toàn là: **bật SigNoz trước rồi mới bật app; tắt app trước rồi
mới tắt SigNoz**. Lỡ dựng lại SigNoz trong lúc app đang chạy thì chạy lại `docker compose up -d` cho app
để nó nối lại vào network.

**`host.docker.internal` không phân giải được** (cách B): trên Linux cần dòng `extra_hosts` (đã có sẵn
trong `docker-compose.standalone.yml`). Vẫn không được thì kiểm tra firewall có chặn cổng 4318 từ
bridge của Docker không.

### 12.4 Service hiện tên `unknown_service:node`

Thiếu `OTEL_SERVICE_NAME`. tracing.js in cảnh báo ngay khi khởi động:

```
[otel] Chưa đặt OTEL_SERVICE_NAME: trong SigNoz service sẽ hiện là "unknown_service:node"
```

### 12.5 Có span HTTP nhưng không có span Express, log không có trace_id

tracing.js không được nạp **trước** app. Kiểm tra lệnh chạy có `--require ./src/tracing.js`. Đặt
`require('./tracing')` ở giữa file app là quá muộn nếu `express` hay `pino` đã được require trước đó.
App ESM thì phải dùng `--import`, không dùng `--require`.

### 12.6 Cổng của app bị chiếm, Docker không báo lỗi

Gặp thật khi làm demo: một app Node khác đang nghe `127.0.0.1:3000`, Docker Desktop trên Windows **không
báo lỗi** mà bỏ qua việc mở cổng. `docker compose ps` chỉ hiện `3000/tcp` (thiếu `0.0.0.0:3000->...`),
và `curl localhost:3000` trả lời từ app kia. Script sinh traffic phát hiện tình huống này:

```
http://localhost:3400/health trả lời {"status":"ok"}: đây KHÔNG phải order-service.
```

Đổi `ORDER_SERVICE_PORT` trong `.env`, chạy lại `docker compose up -d`. Tìm process đang chiếm cổng:

```powershell
Get-NetTCPConnection -LocalPort 3400 | Select-Object LocalAddress, OwningProcess
```

```bash
lsof -i :3400        # macOS / Linux
```

### 12.7 Container của SigNoz khởi động lại liên tục

- **Thiếu RAM**: tăng bộ nhớ cho Docker Desktop lên ít nhất 4 GB (Settings → Resources).
- **ClickHouse Keeper thoát với mã 139 trên Windows** (segmentation fault dưới lớp ảo hoá của Docker
  Desktop, tài liệu SigNoz có ghi nhận). Máy thử của demo không gặp, nhưng nếu gặp: chạy Docker Engine
  trong WSL 2, hoặc đổi keeper sang ZooKeeper bằng cách thêm vào `signoz/casting.yaml`:

  ```yaml
  spec:
    telemetrykeeper:
      kind: zookeeper
  ```

  rồi `foundryctl cast -f casting.yaml` lại.
- Xem log từng thành phần: `docker compose -f signoz/pours/deployment/compose.yaml logs -f signoz-signoz-0`.

### 12.8 Có trace nhưng chưa có metric hoặc log

- Metric được gửi mỗi 15 giây (`OTEL_METRIC_EXPORT_INTERVAL`) — đợi ít nhất một chu kỳ.
- Không thấy log: kiểm tra logger là **pino** (hoặc winston/bunyan, cũng có instrumentation) và được
  require sau tracing.js. `console.log` **không** được gửi đi.
- Metric riêng của app chỉ xuất hiện sau lần ghi đầu tiên: `shop.orders` cần ít nhất một đơn hàng.

---

## 13. Dọn dẹp

```bash
# App
docker compose down                      # cách A
docker compose -f docker-compose.standalone.yml down   # cách B
docker image rm nodejs-signoz-demo:1.0.0 # xoá luôn image nếu muốn

# SigNoz (Foundry)
cd signoz/pours/deployment
docker compose down                      # dừng, GIỮ dữ liệu trong volume
docker compose down -v                   # dừng và XOÁ toàn bộ dữ liệu, tài khoản, dashboard
```

---

## 14. Lưu ý khi đưa lên production

- **Sampling.** Demo giữ 100% trace. Traffic lớn thì đặt
  `OTEL_TRACES_SAMPLER=parentbased_traceidratio` và `OTEL_TRACES_SAMPLER_ARG=0.1` (giữ 10%). Chữ
  `parentbased` đảm bảo service phía sau theo quyết định của service phía trước, trace không bị đứt.
- **Không đưa dữ liệu nhạy cảm vào span và log**: mật khẩu, token, số thẻ, thông tin cá nhân.
  `db.statement` nên là câu SQL có tham số (`$1`), không chứa giá trị thật.
- **Ingestion key là bí mật**: để trong secret manager / Docker secret, không commit `.env`.
- **Không trả `err.message` của lỗi 500 ra ngoài** như demo đang làm cho dễ học.
- **Cardinality của metric**: thuộc tính chỉ nên có ít giá trị; ID đơn, user ID đặt vào span chứ không
  vào metric.
- **Alert**: từ một panel hoặc trang Services có thể tạo alert (tỉ lệ lỗi > 5%, P99 > 1 s...) gửi
  Slack, email, webhook.
- Image của demo nặng ~440 MB chủ yếu vì `auto-instrumentations-node` kéo theo instrumentation của mọi
  thư viện phổ biến. Production có thể chỉ cài các instrumentation thật sự dùng (`instrumentation-http`,
  `instrumentation-express`, `instrumentation-pino`...) để image nhỏ và khởi động nhanh hơn.

---

## 15. Tham khảo

- SigNoz — cài bằng Docker (Foundry): https://signoz.io/docs/install/docker/
- Foundry: https://github.com/SigNoz/foundry
- Chuyển từ docker compose cũ sang Foundry: https://github.com/SigNoz/signoz/blob/main/deploy/MIGRATION.md
- SigNoz Cloud — ingestion: https://signoz.io/docs/ingestion/signoz-cloud/overview/
- OpenTelemetry JS: https://opentelemetry.io/docs/languages/js/
- Biến môi trường của SDK: https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/
- auto-instrumentations-node: https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/auto-instrumentations-node
- Semantic conventions: https://opentelemetry.io/docs/specs/semconv/
- W3C Trace Context (`traceparent`): https://www.w3.org/TR/trace-context/
