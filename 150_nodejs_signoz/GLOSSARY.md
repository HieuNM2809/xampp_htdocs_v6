# Thuật ngữ hay dùng trong SigNoz

Bảng tra các thuật ngữ hay gặp khi làm việc với SigNoz và OpenTelemetry, kèm chỗ thấy chúng trong demo
này. Cách cài và chạy demo xem [README.md](README.md); đường đi của một request và cơ chế telemetry xem
[ARCHITECTURE.md](ARCHITECTURE.md).

- Thuật ngữ giữ nguyên tiếng Anh vì giao diện SigNoz và tài liệu OpenTelemetry đều dùng tiếng Anh.
- Đường dẫn file tính từ thư mục `150_nodejs_signoz/`. Số dòng ứng với mã nguồn ngày 08/11/2026; sửa code
  thì số dòng có thể lệch.
- Tên màn hình và nút bấm theo SigNoz v0.149 như README ghi lại; bản khác có thể đặt tên khác.

## Mục lục

1. [Khái niệm chung](#1-khái-niệm-chung)
2. [Trace và span](#2-trace-và-span)
3. [Metric](#3-metric)
4. [Log](#4-log)
5. [Phía ứng dụng: OpenTelemetry SDK](#5-phía-ứng-dụng-opentelemetry-sdk)
6. [Phía SigNoz: collector, ClickHouse, cài đặt](#6-phía-signoz-collector-clickhouse-cài-đặt)
7. [Giao diện SigNoz](#7-giao-diện-signoz)
8. [Query Builder, Dashboard, Alert](#8-query-builder-dashboard-alert)
9. [Các cặp hay nhầm](#9-các-cặp-hay-nhầm)
10. [Tham khảo](#10-tham-khảo)

Thuật ngữ nằm ở chặng nào trên đường đi của dữ liệu:

```text
App Node.js            instrumentation, tracer/meter, span, attribute, resource       mục 2–5
  │  SDK: processor gom lô → exporter
  ▼  OTLP/HTTP :4318
Collector (ingester)   receiver → processor (signozspanmetrics, batch) → exporter      mục 6.1
  ▼
ClickHouse             signoz_traces · signoz_logs · signoz_metrics                    mục 6.2
  ▲  SQL
SigNoz UI :8080        Services, Traces, Logs, Dashboards, Alerts                      mục 7–8
```

---

## 1. Khái niệm chung

| Thuật ngữ | Nghĩa | Trong demo |
|---|---|---|
| **Observability** | Khả năng hiểu hệ thống đang làm gì và vì sao lỗi, chỉ từ dữ liệu nó phát ra, không phải thêm code để debug | Mục tiêu của cả demo |
| **Telemetry** | Dữ liệu ứng dụng phát ra để quan sát | `src/tracing.js` gửi cả traces, metrics, logs |
| **Signal** | Một loại telemetry. OpenTelemetry có ba signal chính: traces, metrics, logs | Ba exporter ở `src/tracing.js:106`, `:112`, `:119` |
| **APM** (Application Performance Monitoring) | Theo dõi hiệu năng ứng dụng: số request, tỉ lệ lỗi, độ trễ của từng service và endpoint | Trang **Services** ([mục 7.2](#72-chỉ-số-apm)) |
| **Service** | Một ứng dụng, nhận diện bằng thuộc tính `service.name`. Mọi màn hình APM của SigNoz gom số liệu theo service | `order-service`, `payment-service`: cùng image, khác `OTEL_SERVICE_NAME` |
| **Instrumentation** | Phần code sinh ra telemetry. *Auto*: thư viện tự vá module (http, express, pino…). *Manual*: tự viết bằng API | Auto: `src/tracing.js:75-89`. Manual: `withSpan()` ở `src/lib/telemetry.js:37-53` |
| **OpenTelemetry** (OTel) | Chuẩn mở kèm bộ thư viện để sinh và gửi telemetry, không phụ thuộc backend. SigNoz nhận dữ liệu theo chuẩn này | Các gói `@opentelemetry/*` (`package.json:39-47`) |
| **OTLP** (OpenTelemetry Protocol) | Giao thức gửi telemetry của OTel: gRPC ở cổng 4317, HTTP ở cổng 4318 với các đường dẫn `/v1/traces`, `/v1/metrics`, `/v1/logs` | App gửi OTLP/HTTP tới `http://signoz-ingester:4318` (`docker-compose.yml:32`) |
| **Backend** | Nơi nhận, lưu và hiển thị telemetry. SigNoz là một backend; Jaeger, Grafana Tempo, Datadog cũng vậy | Đổi backend chỉ cần đổi `OTEL_EXPORTER_OTLP_ENDPOINT`, không sửa code |

---

## 2. Trace và span

Cây span rút gọn của một đơn thanh toán thất bại (cây đầy đủ ở [README §9.4](README.md#94-đọc-một-trace)),
để đối chiếu với các thuật ngữ bên dưới:

```text
Một trace = mọi span có chung trace_id (ở đây: một request POST /api/orders đi qua 2 service)

POST /api/orders                       root span · SERVER · order-service · 502
└─ request handler - /api/orders       INTERNAL · span con của root span
   ├─ SELECT shop.products             CLIENT · db.system = postgresql
   └─ POST                             CLIENT · fetch, tự chèn header traceparent
      └─ POST /payments                SERVER · entrypoint span của payment-service
         └─ request handler - /payments
            └─ bank.authorize          CLIENT · status ERROR · có event exception
```

| Thuật ngữ | Nghĩa | Trong demo / trên SigNoz |
|---|---|---|
| **Trace** | Toàn bộ hành trình của một request (hoặc một job) qua mọi service: một cây span có chung trace ID | Một `POST /api/orders` là một trace khoảng 15–18 span qua 2 service |
| **Span** | Một bước công việc: tên, thời điểm bắt đầu, thời lượng, thuộc tính, trạng thái, span cha | `fraud.check`, `SELECT shop.products`, `POST /payments` |
| **Trace ID** | Mã 32 ký tự hex (16 byte), chung cho mọi span của một trace | Trả về client qua header `X-Trace-Id` (`src/lib/middlewares.js:20-21`). Mở trace: `http://localhost:8080/trace/<traceId>` |
| **Span ID** | Mã 16 ký tự hex (8 byte), riêng cho từng span | Log ghi trong lúc có span active mang `span_id` của span đó |
| **Root span** (span gốc) | Span không có cha, mở đầu trace. Trong ClickHouse là span có `parent_span_id` rỗng | `POST /api/orders`. Job nền `inventory.restock` tự mở root span vì không có request HTTP nào (`src/lib/fake-db.js:244-245`) |
| **Parent span / child span** | Span tạo ra trong lúc một span khác đang *active* sẽ thành con của span đó; quan hệ cha–con tạo thành cây | `withSpan()` đặt span mới làm active (`src/lib/telemetry.js:42`), nên span DB và fetch bên trong thành con của nó |
| **Span name / Operation** | Tên span. SigNoz gọi là *operation* và gom số liệu theo tên, nên tên phải ít giá trị khác nhau: không đưa ID hay tham số vào tên | `SELECT shop.orders`, không phải câu SQL kèm mã đơn (`src/lib/fake-db.js:56-57`) |
| **SpanKind** | Vai trò của span: `SERVER` (nhận request), `CLIENT` (gọi ra ngoài), `INTERNAL` (xử lý bên trong), `PRODUCER`/`CONSUMER` (hàng đợi, demo không dùng) | Chi tiết: [ARCHITECTURE §4.2](ARCHITECTURE.md#42-spankind). ClickHouse lưu ở cột `kind_string`: `Server`, `Client`, `Internal` |
| **Attribute** | Cặp key=value gắn vào span để lọc và nhóm. Tên chuẩn theo semantic conventions; tên tự đặt nên có tiền tố riêng | `app.customer.id` (`src/routes/orders.js:55-59`), `app.order.id` (`:79`). Lọc: `app.customer.id = 'c-007'` |
| **Span event** | Sự kiện có mốc thời gian nằm trong một span. Hay gặp nhất là event `exception` | Chi tiết của span lỗi trên SigNoz có event `exception` kèm stack trace |
| **Exception** | Event tên `exception` với `exception.type`, `exception.message`, `exception.stacktrace`, tạo bằng `span.recordException(err)` | `src/lib/telemetry.js:46`, `src/routes/orders.js:94`. SigNoz gom lại ở trang **Exceptions** |
| **Span status** | `UNSET` (mặc định), `OK` hoặc `ERROR`. SigNoz coi span `ERROR` là lỗi: tô đỏ, lưu `has_error = true` | `withSpan()` đặt `ERROR` khi hàm bên trong ném lỗi (`src/lib/telemetry.js:47`). Lọc: `has_error = true` |
| **Duration / Latency** | Duration là thời lượng của một span (ClickHouse: `duration_nano`). Latency trên SigNoz là phân bố duration của nhiều span, đọc qua P50/P95/P99 | `GET /api/slow` cố ý chậm 0,5–2 giây (`src/routes/demo.js:38-62`) |
| **Context propagation** | Mang "span đang active" theo luồng xử lý: trong một process (AsyncLocalStorage) và sang service khác (qua header) | [ARCHITECTURE §4.3](ARCHITECTURE.md#43-lan-truyền-context) |
| **`traceparent`** (W3C Trace Context) | Header chuẩn dạng `00-<trace id>-<span id cha>-<flags>`. Service phía sau đọc header này để nối span của nó vào trace của service phía trước | instrumentation-undici tự chèn khi gọi `fetch` (`src/lib/payment-client.js:6-10`) |
| **Trace flags** | Phần cuối của `traceparent`. `01` nghĩa là trace được chọn giữ lại (sampled) | Mỗi dòng log của demo có `"trace_flags":"01"` |
| **Sampling** | Chỉ giữ một phần trace để giảm chi phí. *Head sampling*: SDK quyết định ngay đầu trace (`OTEL_TRACES_SAMPLER`). *Tail sampling*: collector quyết định sau khi thấy đủ trace, ví dụ giữ mọi trace lỗi | Demo giữ 100%. Gợi ý cho production: [README §14](README.md#14-lưu-ý-khi-đưa-lên-production) |
| **Entrypoint span** | Span tại đó request đi vào một service: root span, hoặc span có span cha thuộc service khác. Trang Services tính số liệu từ các span này | `POST /payments` là entrypoint của payment-service. Nút **Entrypoint Spans** ở bảng Key Operations |
| **Waterfall / Flame Graph** | Hai cách vẽ trace ở trang chi tiết. Waterfall: mỗi span một dòng trên trục thời gian. Flame Graph: span xếp chồng theo độ sâu, thấy ngay nhánh tốn thời gian | [README §9.4](README.md#94-đọc-một-trace) |

---

## 3. Metric

| Thuật ngữ | Nghĩa | Trong demo |
|---|---|---|
| **Metric** | Số đo theo thời gian (đếm, tổng, phân bố). Rẻ để lưu lâu, hợp để vẽ biểu đồ và đặt cảnh báo | Ba nguồn: code app (`shop.*`), auto-instrumentation (`http.*`, `nodejs.*`, `v8js.*`), collector của SigNoz (`signoz_*`) |
| **Meter / Instrument** | Meter tạo ra instrument; instrument là đối tượng dùng để ghi số liệu | `meter.createCounter(...)`, `meter.createHistogram(...)` (`src/lib/telemetry.js:60-75`) |
| **Counter** | Chỉ tăng. Thường xem theo tốc độ tăng (rate) | `shop.orders`, `shop.revenue` (`src/lib/telemetry.js:60-69`) |
| **UpDownCounter** | Tăng giảm được, ví dụ số kết nối đang mở | Demo không dùng |
| **Histogram** | Ghi phân bố giá trị vào các bucket để tính percentile. Trên SigNoz hiện thành nhóm `.bucket`, `.count`, `.sum`, `.min`, `.max` | `shop.payment.duration` (`src/lib/telemetry.js:72-75`), ghi ở `src/lib/payment-client.js:51` |
| **Gauge / Observable Gauge** | Giá trị tức thời (tồn kho, RAM). *Observable*: SDK tự gọi callback mỗi lần xuất metric, app không phải chủ động ghi | `shop.product.stock` (`src/lib/fake-db.js:259-268`) |
| **Label / attribute / dimension** | Cặp key=value đi kèm số liệu, dùng để group by | `order.status` của `shop.orders` (`src/routes/orders.js:107`), `payment.outcome` của `shop.payment.duration` |
| **Time series** | Một tên metric cộng một bộ giá trị label. `shop.orders{order.status=success}` và `shop.orders{order.status=rejected}` là hai time series | Bảng `distributed_time_series_v4` ([mục 6.2](#62-bảng-trong-clickhouse)) |
| **Cardinality** | Số time series khác nhau. Label có quá nhiều giá trị (user ID, mã đơn) làm số series phình to: tốn bộ nhớ, truy vấn chậm | ID đặt vào span, không đặt vào metric ([README §10.4](README.md#104-metric-của-app)) |
| **Temporality** | Cách cộng dồn số liệu. *Cumulative*: tổng từ lúc process khởi động (mặc định của SDK). *Delta*: chỉ phần tăng trong mỗi chu kỳ | Span metrics do collector SigNoz tính là delta, đóng dấu theo phút (`scripts/verify.js:236`) |
| **Export interval** | Chu kỳ SDK gửi metric | 15 giây (`src/tracing.js:93`); mặc định của SDK là 60 giây |
| **Percentile** (P50, P90, P95, P99) | P99 = 99% giá trị nhỏ hơn hoặc bằng mức này. P99 cho thấy nhóm request chậm nhất mà số trung bình che mất | Cột *P99 latency* ở trang Services |
| **Runtime metrics** | Metric của chính Node.js: event loop delay, heap, GC | instrumentation-runtime-node (`src/tracing.js:88`). `/api/slow` cố ý chặn event loop (`src/routes/demo.js:43-52`) nên `nodejs.eventloop.delay.p99` tăng |

---

## 4. Log

| Thuật ngữ | Nghĩa | Trong demo |
|---|---|---|
| **LogRecord** | Một dòng log theo mô hình của OTel: timestamp, severity, body, attributes, resource, kèm `trace_id`/`span_id` nếu có | instrumentation-pino chuyển mỗi dòng pino thành LogRecord (`src/lib/logger.js:6-14`) |
| **Body** | Nội dung chính của dòng log | Trường `msg` của pino, ví dụ `Đơn đã thanh toán` |
| **Severity** | Mức độ log. `severity_text` là chữ; `severity_number` là số theo thang OTel (INFO 9–12, WARN 13–16, ERROR 17–20…) | Mức `info`/`warn`/`error` của pino. Lọc: `severity_text = 'error'` |
| **Log attributes** | Các trường có cấu trúc đi kèm log | `orderId`, `paymentId`. Key `err` của pino thành `exception.type`, `exception.message`, `exception.stacktrace` (`src/lib/middlewares.js:59-61`) |
| **Structured log** | Log dạng JSON có từng trường riêng thay vì một chuỗi văn bản, nhờ đó lọc được theo trường | pino in JSON ra stdout (`src/lib/logger.js:19-28`) |
| **Log correlation** | Log mang `trace_id` + `span_id` của span đang active lúc ghi, nên đi được từ log sang trace và ngược lại | [ARCHITECTURE §4.4](ARCHITECTURE.md#44-log-được-gắn-trace_idspan_id-như-thế-nào). Trên SigNoz: bấm TRACE ID trong chi tiết log |
| **Logs Pipelines** | Quy tắc tách trường, đổi tên, che dữ liệu nhạy cảm cho log, cấu hình trên giao diện SigNoz và chạy trong collector | Demo không cần vì log đã có cấu trúc sẵn |

---

## 5. Phía ứng dụng: OpenTelemetry SDK

| Thuật ngữ | Nghĩa | Trong demo |
|---|---|---|
| **API và SDK** | *API* (`@opentelemetry/api`): giao diện để code gọi. *SDK*: phần thực sự tạo, gom lô và gửi dữ liệu. Không có SDK thì API thành no-op | Code nghiệp vụ chỉ gọi API; chỉ `src/tracing.js` dùng SDK |
| **No-op** | Tracer/meter "rỗng": gọi được nhưng không sinh dữ liệu. Meter lấy ra trước khi SDK khởi động sẽ no-op vĩnh viễn | `src/lib/telemetry.js:10-12`, `:23-25` |
| **NodeSDK** | Lớp gom cấu hình resource, exporter, processor, instrumentation cho Node.js | `src/tracing.js:95-124` |
| **auto-instrumentations-node** | Gói gom sẵn instrumentation cho các thư viện phổ biến. Demo dựa vào http, express, undici (fetch), pino, runtime-node | Cấu hình ở `src/tracing.js:75-89` |
| **Monkey-patch / `--require`** | Auto-instrumentation vá module đúng lúc module được `require` lần đầu, nên SDK phải nạp trước app: `--require` (ESM dùng `--import`) | `src/tracing.js:6-12`, `package.json:12-13` |
| **Tracer / Meter** | Đối tượng tạo span / tạo instrument, lấy từ API theo tên scope | `src/lib/telemetry.js:21`, `:25` |
| **Instrumentation scope** | Tên + phiên bản của thư viện sinh ra telemetry. SigNoz hiện ở thuộc tính `otel.scope.name` | `shop-demo` cho span tự tạo (`src/lib/telemetry.js:17-19`) |
| **Resource** | "Danh tính" của nơi phát dữ liệu (`service.name`, `service.version`, `host.name`…), gắn vào mọi span, metric, log | `src/tracing.js:61-73`. ClickHouse lưu ở cột `resources_string` |
| **Resource detector** | Tự phát hiện resource từ môi trường: biến môi trường, process, hệ điều hành… | `src/tracing.js:101`. `envDetector` đọc `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES` |
| **`service.name`** | Thuộc tính resource quan trọng nhất: tên service trên SigNoz. Thiếu thì hiện `unknown_service:node` | `OTEL_SERVICE_NAME` (`docker-compose.yml:47`, `:63`) |
| **`service.namespace`** | Nhóm các service thuộc cùng một hệ thống | `shop-demo` (`docker-compose.yml:35`) |
| **`deployment.environment`** | Môi trường chạy (dev, staging, prod…). SigNoz dùng cho ô chọn Environment ở trang Services | `docker-demo` (`docker-compose.yml:35`, `.env.example:31-32`) |
| **Semantic conventions** (semconv) | Bộ tên chuẩn cho attribute: `http.request.method`, `db.system`, `server.address`… SigNoz dựa vào tên chuẩn để dựng các màn hình có sẵn | `src/lib/fake-db.js:60-71`, `src/payment-service.js:70-76` |
| **Exporter** | Thành phần gửi dữ liệu ra ngoài theo một giao thức | `OTLPTraceExporter`, `OTLPMetricExporter`, `OTLPLogExporter` (`src/tracing.js:106`, `:112`, `:119`) |
| **BatchSpanProcessor** | Gom span đã kết thúc thành lô rồi mới gửi, khoảng 5 giây một lần (`OTEL_BSP_SCHEDULE_DELAY`) | NodeSDK tự bọc trace exporter trong processor này (`src/tracing.js:103-106`) |
| **BatchLogRecordProcessor** | Tương tự BatchSpanProcessor, nhưng cho log | `src/tracing.js:119` |
| **PeriodicExportingMetricReader** | Định kỳ thu số liệu từ mọi instrument rồi đẩy cho exporter | `src/tracing.js:110-115` |
| **Shutdown / flush** | Khi process tắt, gửi nốt dữ liệu còn trong bộ đệm | `sdk.shutdown()` khi nhận SIGTERM/SIGINT (`src/tracing.js:138-154`) |
| **Biến `OTEL_*`** | Biến môi trường chuẩn để cấu hình SDK mà không sửa code | [README §11](README.md#11-biến-môi-trường-opentelemetry-hay-dùng), [ARCHITECTURE §5](ARCHITECTURE.md#5-biến-môi-trường) |

---

## 6. Phía SigNoz: collector, ClickHouse, cài đặt

### 6.1 Thành phần

| Thuật ngữ | Nghĩa | Trong demo |
|---|---|---|
| **Self-host / SigNoz Cloud** | Tự chạy SigNoz trên hạ tầng của mình, hoặc dùng bản SigNoz vận hành sẵn | Demo chạy self-host. Cloud dùng `docker-compose.standalone.yml` + ingestion key |
| **OpenTelemetry Collector** | Chương trình nhận, xử lý rồi chuyển tiếp telemetry. SigNoz dùng bản collector riêng, có thêm processor và exporter cho ClickHouse | Container `signoz-ingester-1` |
| **Ingester** | Tên thành phần collector trong bản cài bằng Foundry. Bản compose cũ (≤ v0.129.0) gọi là `otel-collector` | `http://signoz-ingester:4318` hoặc `http://otel-collector:4318` (`.env.example:44-50`) |
| **Receiver / Processor / Exporter** (của collector) | Ba khâu trong collector: nhận (receiver `otlp`), xử lý (`signozspanmetrics`, `batch`…), ghi ra (exporter ClickHouse) | [README §2](README.md#2-luồng-hoạt-động-app--sdk--collector--clickhouse--ui), chặng ③ |
| **Pipeline** | Chuỗi receiver → processor → exporter cho từng signal | Collector chỉ mở cổng 4317/4318 sau khi nhận pipeline từ SigNoz ([README §5.2](README.md#52-cách-1-khuyến-nghị-cài-bằng-foundry), bước 4) |
| **signozspanmetrics** | Processor của SigNoz tính metric APM (số lần gọi, lỗi, độ trễ) từ chính các span. Nhờ vậy trang Services có số liệu mà app không cần gửi metric nào | Sinh ra `signoz_calls_total`, `signoz_latency`… (`scripts/verify.js:233`) |
| **OpAMP** | Giao thức để server SigNoz đẩy cấu hình xuống collector | Lý do phải tạo tài khoản admin trước: chưa có tổ chức (organization) thì server chưa cấp pipeline cho collector |
| **ClickHouse** | CSDL dạng cột, nơi SigNoz lưu traces, metrics, logs | Container `signoz-telemetrystore-clickhouse-0-0` |
| **ClickHouse Keeper / ZooKeeper** | Dịch vụ điều phối cho ClickHouse | `signoz-telemetrykeeper-clickhousekeeper-0`. Bản compose cũ dùng ZooKeeper |
| **Metastore** | CSDL lưu cấu hình của SigNoz: user, dashboard, alert. Không chứa telemetry | PostgreSQL, container `signoz-metastore-postgres-0` |
| **Query service** | Backend của SigNoz: nhận truy vấn từ giao diện, chuyển thành SQL chạy trên ClickHouse | Nằm chung container `signoz-signoz-0` với giao diện, cổng 8080 |
| **Retention** | Thời gian giữ dữ liệu; quá hạn thì ClickHouse tự xoá. Đặt riêng cho traces, logs, metrics | Settings → General |
| **Ingestion key** | Khoá xác thực khi gửi dữ liệu lên SigNoz Cloud, đặt trong header `signoz-ingestion-key`. Self-host không cần | `.env.example:62-64` |
| **Ingestion endpoint / region** | Địa chỉ nhận dữ liệu của SigNoz Cloud theo vùng: `https://ingest.<region>.signoz.cloud:443` | `.env.example:63` |
| **Foundry / `foundryctl`** | CLI cài SigNoz, cách cài chính thức từ v0.130.0 | [README §5.2](README.md#52-cách-1-khuyến-nghị-cài-bằng-foundry) |
| **Casting** (`casting.yaml`) | File khai báo bản cài: `mode`, `flavor`, `metadata.name` (quyết định tên network) | `signoz/casting.yaml:17-26` |
| **`gauge` / `forge` / `cast`** | `gauge`: kiểm tra công cụ cần có. `forge`: sinh file compose vào `pours/`. `cast`: làm cả hai rồi chạy `docker compose up` | `signoz/casting.yaml:3-9` |
| **Pours** | Thư mục Foundry sinh ra, chứa compose và cấu hình của SigNoz (đã có trong `.gitignore`) | `signoz/pours/deployment/compose.yaml`; cấu hình collector ở `signoz/pours/deployment/ingester/ingester.yaml` |

### 6.2 Bảng trong ClickHouse

Dùng khi muốn truy vấn thẳng dữ liệu, như ở [ARCHITECTURE §6](ARCHITECTURE.md#6-phụ-lục-tự-kiểm-chứng-bằng-clickhouse)
và `scripts/verify.js`. Tiền tố `distributed_` là bảng kiểu Distributed của ClickHouse, đọc dữ liệu từ các
bảng local trên mọi shard; nên truy vấn bảng này thay vì bảng local.

| Bảng | Chứa | Cột hay dùng |
|---|---|---|
| `signoz_traces.distributed_signoz_index_v3` | Mỗi dòng là một span | `trace_id`, `span_id`, `parent_span_id` (rỗng = root span), `serviceName`, `name`, `kind_string`, `duration_nano`, `has_error`, `response_status_code`, `dbSystem`, `externalHttpUrl`, `attributes_string[...]`, `resources_string[...]` |
| `signoz_traces.distributed_signoz_error_index_v2` | Exception, nguồn của trang Exceptions | `traceID`, `serviceName`, `exceptionType`, `exceptionMessage` |
| `signoz_logs.distributed_logs_v2` | Log | `trace_id`, `span_id`, `severity_text`, `body`, `attributes_string[...]`, `resources_string['service.name']` |
| `signoz_metrics.distributed_time_series_v4` | Danh sách time series: tên metric + bộ label | `metric_name`, `fingerprint`, `labels` |
| `signoz_metrics.distributed_samples_v4` | Các điểm số liệu theo thời gian | `metric_name`, `fingerprint`, `unix_milli` |

**Fingerprint** là mã băm của bộ label, dùng để nối hai bảng metric với nhau (`scripts/verify.js:242-248`).

---

## 7. Giao diện SigNoz

### 7.1 Màn hình

| Màn hình | Dùng để | Trong demo |
|---|---|---|
| **Services** | Danh sách service kèm P99 latency, Error Rate, Operations Per Second | [README §9.1](README.md#91-services--sức-khoẻ-từng-service-apm) |
| **Trang chi tiết service** | Ba tab: **Overview** (Latency, Rate, Apdex, Key Operations), **DB Call Metrics** (lời gọi DB theo `db.system`), **External Metrics** (lời gọi HTTP ra ngoài theo địa chỉ đích) | Bấm `order-service` ở trang Services |
| **Service Map** | Đồ thị phụ thuộc giữa các service và database | order-service → payment-service, postgresql, redis ([README §9.2](README.md#92-service-map)) |
| **Traces Explorer** | Tìm và lọc span/trace. Kiểu xem: **List View** (từng span), **Trace View** (gom theo trace), **Time Series**, **Table** | [README §9.3](README.md#93-traces--tìm-và-lọc) |
| **Trang chi tiết trace** | Một trace với Waterfall, Flame Graph, công tắc **Highlight errors**, chi tiết từng span | `http://localhost:8080/trace/<traceId>` |
| **Logs Explorer** | Tìm và lọc log; mở chi tiết một dòng, bấm TRACE ID để sang trace | [README §9.5](README.md#95-logs--và-nối-log-với-trace) |
| **Exceptions** | Gom exception theo kiểu và thông báo: số lần, lần đầu/lần cuối, service | 4 nhóm lỗi của demo ([README §9.6](README.md#96-exceptions-và-external-apis)) |
| **External APIs** | Các domain mà service gọi ra ngoài: tốc độ gọi, tỉ lệ lỗi, độ trễ | `payment-service`, `api.bank.example` |
| **Dashboards** | Tự dựng biểu đồ từ metric, trace, log | [Mục 8](#8-query-builder-dashboard-alert) |
| **Alerts** | Tạo và quản lý luật cảnh báo | [Mục 8](#8-query-builder-dashboard-alert) |
| **Metrics** | Duyệt các metric đang có | `shop.*`, `http.*`, `nodejs.*`, `signoz_*` |
| **Infrastructure** | Theo dõi host, container, Kubernetes; cần collector thu host metrics | Demo không gửi loại dữ liệu này |

### 7.2 Chỉ số APM

| Chỉ số | Nghĩa | Ghi chú |
|---|---|---|
| **RED** | Rate – Errors – Duration: ba chỉ số cơ bản để đánh giá một service | Trang Services hiện đúng ba chỉ số này |
| **Operations Per Second / Rate** | Số entrypoint span mỗi giây, xấp xỉ số request/giây | Cột *Operations Per Second* ở trang Services |
| **Error Rate** | Phần trăm entrypoint span bị lỗi | Span SERVER chỉ lỗi khi mã ≥ 500; 4xx không làm tăng Error Rate ([README §10.3](README.md#103-thuộc-tính-nghiệp-vụ-lỗi-4xx-và-5xx)) |
| **P99 latency** | 99% request có thời gian xử lý nhỏ hơn hoặc bằng mức này | `/api/slow` kéo P99 của order-service lên trên 1 giây |
| **Apdex** | Chỉ số hài lòng từ 0 đến 1 theo ngưỡng T. Request ≤ T: hài lòng; từ T đến 4T: tạm chấp nhận (tính một nửa); > 4T: không hài lòng. Apdex = (hài lòng + tạm chấp nhận / 2) / tổng | Biểu đồ Apdex ghi `Threshold 0.5` (giây) |
| **Key Operations** | Bảng từng operation của service: P50/P95/P99, số lần gọi, tỉ lệ lỗi | Bật **Entrypoint Spans** để chỉ xem span điểm vào |
| **Database Calls** | Số lần gọi và độ trễ theo `db.system` (tab DB Call Metrics) | Có được nhờ span CLIENT có `db.system` (`src/lib/fake-db.js:61`, `:89`) |
| **External Calls** | Lời gọi ra ngoài theo địa chỉ đích (tab External Metrics) | ClickHouse: cột `externalHttpUrl` (`scripts/verify.js:171`) |

### 7.3 Bộ lọc và thao tác chung

| Thuật ngữ | Nghĩa |
|---|---|
| **Time range** | Ô chọn khoảng thời gian ở góc phải trên mỗi trang (mặc định *Last 30 minutes*). Không thấy dữ liệu thì kiểm tra ô này trước tiên |
| **Environment** | Ô *Select Environment/s* ở trang Services, lọc theo `deployment.environment` |
| **Quick Filters** | Bộ lọc dựng sẵn bên trái Explorer: Service Name, Has Error, Duration, Severity Text… |
| **Filter expression** | Biểu thức lọc, ví dụ `service.name = 'order-service' AND has_error = true`, rồi bấm **Run Query** |
| **Saved Views** | Lưu bộ lọc và cách hiển thị của Explorer để mở lại sau |

---

## 8. Query Builder, Dashboard, Alert

| Thuật ngữ | Nghĩa | Ví dụ |
|---|---|---|
| **Query Builder** | Trình dựng truy vấn bằng form, dùng chung cho Explorer, Dashboard, Alert. Ngoài ra có tab **ClickHouse Query** (viết SQL) và **PromQL** | [README §9.7](README.md#97-dashboards--vẽ-biểu-đồ-từ-metric-của-app) |
| **Data source** | Nguồn dữ liệu của query: Metrics, Logs hoặc Traces | Panel `shop.orders` dùng Metrics |
| **Aggregate within time series** | Bước gộp thứ nhất, theo thời gian: gộp các điểm của TỪNG time series trong mỗi khoảng. Counter thường chọn Rate | `shop.orders` → Rate (SigNoz tự chọn vì là counter) |
| **Aggregate across time series** | Bước gộp thứ hai: gộp nhiều time series thành ít đường hơn (Sum, Avg, Max…). Histogram chọn P50/P95/P99 ở bước này | `shop.orders` → Sum; `shop.payment.duration.bucket` → P95 |
| **Group by** (ô **by**) | Tách kết quả thành nhiều đường theo label | `shop.orders` by `order.status` → 4 đường `success`, `payment_failed`, `rejected`, `out_of_stock` |
| **Having / Order by / Limit** | Lọc kết quả sau khi gộp, sắp xếp, giới hạn số nhóm | Chỉ giữ 5 operation chậm nhất |
| **Legend format** | Tên hiển thị của từng đường trên biểu đồ, chèn được giá trị label | — |
| **Formula** | Kết hợp nhiều query (A, B…) bằng biểu thức | A = mọi đơn, B = đơn `payment_failed` → `B / A * 100` là % thanh toán lỗi |
| **Panel** | Một biểu đồ trong dashboard: Time Series, Value, Table, List, Bar, Pie, Histogram… | Gợi ý panel ở [README §9.7](README.md#97-dashboards--vẽ-biểu-đồ-từ-metric-của-app) |
| **Dashboard variable** | Biến chọn từ dropdown ở đầu dashboard để mọi panel cùng lọc theo | Chọn `service.name` để xem từng service |
| **Import JSON** | Nhập dashboard dựng sẵn từ file JSON | https://github.com/SigNoz/dashboards |
| **Alert rule** | Điều kiện trên một query. Điều kiện đúng thì alert chuyển sang *firing* và gửi thông báo; hết thì *resolved*. Tạo được từ metric, log, trace hoặc exception | Error Rate của order-service > 5% trong 5 phút |
| **Notification channel** | Nơi nhận cảnh báo | Slack, email, webhook, PagerDuty… |

---

## 9. Các cặp hay nhầm

| Hay nhầm | Khác nhau ở chỗ |
|---|---|
| **Trace** và **span** | Trace là cả cây, span là một nút trong cây. Trace ID chung cho cả cây, span ID riêng từng nút |
| **Attribute** và **resource attribute** | Attribute gắn vào từng span hoặc log (`app.order.id`). Resource attribute gắn vào mọi dữ liệu của một service (`service.name`, `deployment.environment`). ClickHouse tách thành hai cột `attributes_string` và `resources_string` |
| **HTTP 4xx** và **span lỗi** | Span SERVER chỉ bị đánh dấu `ERROR` khi mã ≥ 500; 4xx là lỗi của client. Span CLIENT thì bị đánh dấu từ mã ≥ 400 |
| **Exception** và **status `ERROR`** | Hai thứ độc lập. Lỗi đã bắt và tự xử lý thì phải gọi cả `recordException()` lẫn `setStatus()` (`src/routes/orders.js:94-95`) |
| **Cổng 4317** và **4318** | 4317 là OTLP/gRPC, 4318 là OTLP/HTTP. Exporter HTTP gửi nhầm vào 4317 sẽ báo `Parse Error` ([README §12.2](README.md#122-sai-endpoint--đối-chiếu-thông-báo-lỗi)) |
| **`OTEL_EXPORTER_OTLP_ENDPOINT`** và **`OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`** | Biến đầu là địa chỉ gốc, SDK tự nối `/v1/traces`. Biến sau là URL đầy đủ. Tự nối `/v1/traces` vào biến đầu sẽ thành `/v1/traces/v1/traces` và nhận 404 |
| **`signoz_calls_total`**, **`http.server.request.duration`**, **`shop.orders`** | Thứ nhất do collector SigNoz tính từ span (trang Services). Thứ hai do auto-instrumentation trong app sinh ra. Thứ ba do code app tự ghi |
| **Counter**, **Gauge**, **Histogram** | Counter chỉ tăng, xem bằng Rate. Gauge là giá trị tức thời, xem bằng Avg/Max. Histogram là phân bố, xem bằng P95/P99 |
| **Aggregate within** và **across** time series | Within gộp theo thời gian, trên từng time series. Across gộp nhiều time series lại với nhau |
| **Log ở stdout** và **log trên SigNoz** | Cùng một dòng pino đi hai đường: stdout (`docker compose logs`) và OTLP (`/v1/logs`). `console.log` chỉ ra stdout, không lên SigNoz |
| **`db.system`** và **`peer.service`** | Span CLIENT có `db.system` tạo node database trên Service Map (postgresql, redis). Span `bank.authorize` có `peer.service: bank-gateway` nhưng không tạo node nào trên Service Map của demo; nó chỉ hiện ở External APIs dưới tên miền `api.bank.example` |
| **Metastore** và **telemetry store** | Metastore (PostgreSQL) lưu user, dashboard, alert. Telemetry store (ClickHouse) lưu traces, metrics, logs |

---

## 10. Tham khảo

- Tài liệu SigNoz: https://signoz.io/docs/
- OpenTelemetry Glossary: https://opentelemetry.io/docs/concepts/glossary/
- Semantic conventions: https://opentelemetry.io/docs/specs/semconv/
- W3C Trace Context (`traceparent`): https://www.w3.org/TR/trace-context/
