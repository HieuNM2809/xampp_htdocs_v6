# Phân tích dự án: Node.js + OpenTelemetry + SigNoz

Tài liệu này phân tích mã nguồn của demo: kiến trúc, điểm khởi chạy, đường đi của một request, cơ chế
telemetry và các biến môi trường. Cách cài đặt và chạy demo xem ở [README.md](README.md).

- Đường dẫn file tính từ thư mục `150_nodejs_signoz/`. Số dòng ứng với mã nguồn ngày 05/11/2026; sửa code
  thì số dòng có thể lệch.
- Các ví dụ "trace thật" lấy từ ClickHouse của SigNoz trong lần chạy thử ngày 05/11/2026 (trace
  `ba1f35bc…`). Cách tự xem lại: [mục 6](#6-phụ-lục-tự-kiểm-chứng-bằng-clickhouse).

## Mục lục

1. [Tổng quan kiến trúc](#1-tổng-quan-kiến-trúc)
2. [Điểm khởi chạy](#2-điểm-khởi-chạy)
3. [Luồng xử lý `POST /payments` của payment-service](#3-luồng-xử-lý-post-payments-của-payment-service)
4. [Cơ chế telemetry](#4-cơ-chế-telemetry)
5. [Biến môi trường](#5-biến-môi-trường)
6. [Phụ lục: tự kiểm chứng bằng ClickHouse](#6-phụ-lục-tự-kiểm-chứng-bằng-clickhouse)

---

## 1. Tổng quan kiến trúc

### 1.1 Hai service

| Service | File chính | Cổng | Vai trò |
|---|---|---|---|
| order-service | `src/server.js` | 3400 | API chính: sản phẩm, đơn hàng, các endpoint demo lỗi/chậm (`src/server.js:8-14`) |
| payment-service | `src/payment-service.js` | 3401 | Thanh toán giả lập, đóng vai một "service bên ngoài" |

Hai service dùng chung một image Docker và chung file `src/tracing.js`. Chúng chỉ khác nhau ở lệnh chạy
và giá trị `OTEL_SERVICE_NAME` (`docker-compose.yml:47`, `:58`, `:63`).

### 1.2 Các module trong `src/lib/`

| Module | Vai trò | Điểm chính |
|---|---|---|
| `logger.js` | Logger pino, ghi JSON ra stdout | Khai báo ở `src/lib/logger.js:19-28`. File này không có dòng nào gửi log đi; instrumentation-pino tự lo việc đó (`:6-14`) |
| `telemetry.js` | Tracer, meter, hàm `withSpan()`, metric nghiệp vụ | tracer `src/lib/telemetry.js:21`, meter `:25`, `withSpan` `:37-53`, 3 metric `:60-75`. Chỉ dùng `@opentelemetry/api`, nên nếu SDK không chạy thì mọi thứ thành no-op (`:10-12`) |
| `middlewares.js` | Middleware Express dùng chung cho cả hai service | `requestContext` `src/lib/middlewares.js:16-33`, `notFound` `:36-40`, `errorHandler` `:50-70` |
| `utils.js` | Hàm tiện ích | `sleep` `src/lib/utils.js:4`, `randomInt` `:7`, `HttpError` `:13-19` |
| `fake-db.js` | PostgreSQL và Redis giả lập trong bộ nhớ | Mỗi thao tác là một span CLIENT có `db.system` (`src/lib/fake-db.js:54-66`, `:83-90`). Có job nền `inventory.restock` (`:244-245`) |
| `payment-client.js` | order-service gọi payment-service bằng `fetch` | `src/lib/payment-client.js:30-35`. Không có code tracing, instrumentation-undici tự làm hết (`:6-10`) |

### 1.3 Các file khác

- `src/routes/products.js`: `GET /api/products`, `GET /api/products/:id` (cache Redis giả lập, miss thì
  PostgreSQL giả lập).
- `src/routes/orders.js`: `POST /api/orders` (luồng nghiệp vụ chính, gọi sang payment-service),
  `GET /api/orders/:id`.
- `src/routes/demo.js`: `GET /api/error` (cố tình lỗi 500), `GET /api/slow` (cố tình chậm).
- `scripts/generate-traffic.js`: sinh traffic giả lập. `scripts/check-otlp.js`: chẩn đoán kết nối tới OTLP
  receiver. `scripts/verify.js`: kiểm thử end-to-end bằng cách đọc ClickHouse của SigNoz (`npm run verify`).
- `test/telemetry.test.js`: test tích hợp, thay SigNoz bằng một OTLP receiver giả nên không cần Docker
  (`npm test`).

### 1.4 Kết nối với SigNoz

```text
┌─ network "default" của project ───────────────────────────────────────────┐
│  order-service :3400  ── fetch + header traceparent ──►  payment-service  │
└──────┬─────────────────────────────────────────────────────────┬──────────┘
       │  tracing.js: 3 exporter OTLP/HTTP                        │
       │  POST /v1/traces · /v1/metrics · /v1/logs                │
       ▼                                                          ▼
┌─ network "signoz-network" (external, do SigNoz tạo) ──────────────────────┐
│  signoz-ingester:4318 (OTel Collector) ──► ClickHouse ◄── SigNoz UI :8080  │
└───────────────────────────────────────────────────────────────────────────┘
```

- **Mỗi container nối vào hai network** (`docker-compose.yml:24-26`). Network `default` để order-service
  gọi payment-service bằng tên service (`:50`). Network `signoz` để tới collector; nó được khai báo
  `external: true` (`:67-72`).
- **Địa chỉ collector** đặt ở `OTEL_EXPORTER_OTLP_ENDPOINT=http://signoz-ingester:4318`
  (`docker-compose.yml:32`). Ba exporter được tạo mà không truyền URL (`src/tracing.js:106`, `:112`,
  `:119`), nên chúng tự đọc biến này rồi nối thêm `/v1/...`.
- **Chỉ `tracing.js` biết tới SDK và exporter.** Code nghiệp vụ chỉ gọi `@opentelemetry/api`. Muốn đổi
  backend thì chỉ cần đổi biến môi trường, không sửa code.

---

## 2. Điểm khởi chạy

| Cách chạy | Lệnh | Khai báo ở |
|---|---|---|
| Docker Compose (cách chính) | `docker compose up -d --build` | order-service: `Dockerfile:51`. payment-service: ghi đè `command` ở `docker-compose.yml:58` |
| npm script | `npm start`, `npm run start:payment`, `npm run dev` | `package.json:12-16` |
| Gọi node trực tiếp | `node --require ./src/tracing.js src/payment-service.js` | — |

Cả ba cách đều có `--require ./src/tracing.js`, nên SDK luôn chạy **trước** code nghiệp vụ.
`src/tracing.js` làm lần lượt các việc sau:

1. `:49-52`: nếu `OTEL_SDK_DISABLED=true` thì dừng, không bật OpenTelemetry.
2. `:57-59`: bật log nội bộ của SDK ở mức WARN, để lỗi gửi dữ liệu hiện ra trong log container.
3. `:65-73`: tạo resource mặc định gồm `service.version`, `service.namespace`, `deployment.environment`,
   `host.name`.
4. `:75-89`: tạo auto-instrumentation và gắn móc vào `require()`. Cụ thể:
   - bỏ qua request `/health` (`:78`);
   - tắt instrumentation dns/net (`:81-82`);
   - tắt instrumentation router để mỗi middleware không bị tạo span 2 lần (`:85`).
5. `:95-122`: tạo `NodeSDK` với:
   - resource detector (`:101`);
   - trace exporter (`:106`), được bọc trong BatchSpanProcessor;
   - metric reader đẩy mỗi 15 giây (`:110-115`);
   - log processor (`:119`).
6. `:124`: `sdk.start()`. Từ đây, mọi `require('express')`, `require('pino')`, `http`, `fetch` đều bị vá.
7. `:128-136`: in log khởi động, và cảnh báo nếu thiếu `OTEL_SERVICE_NAME`.
8. `:140-154`: khi nhận SIGTERM/SIGINT, gọi `sdk.shutdown()` để gửi nốt dữ liệu còn trong bộ đệm.

Vì sao phải chạy trước: auto-instrumentation chỉ vá được module **đúng lúc nó được `require` lần đầu**
(`src/tracing.js:10-12`). Module nào nạp trước khi SDK khởi động thì không sinh span hay log nào.

Thứ tự này còn quan trọng vì một lý do khác: API metrics **không có proxy**. Meter lấy ra trước khi SDK
đăng ký sẽ là no-op vĩnh viễn (`src/lib/telemetry.js:23-25`). Nhờ `--require`, điều này không xảy ra.

---

## 3. Luồng xử lý `POST /payments` của payment-service

### 3.1 Lúc khởi động (chạy một lần)

```text
docker-compose.yml:58    node --require ./src/tracing.js src/payment-service.js
│
├─① src/tracing.js                      (nạp trước nhờ --require)
│     :75-89   tạo auto-instrumentation, gắn móc vào require()
│     :95-124  tạo NodeSDK rồi sdk.start()
│
└─② src/payment-service.js
      :19      require('express')             → đã bị instrumentation-express vá
      :22      require('./lib/logger')        → logger.js:17 require('pino') → đã bị vá
      :23      require('./lib/telemetry')     → telemetry.js:21 tracer, :25 meter
      :24      require('./lib/middlewares')
      :25      require('./lib/utils')
      :27-30   đọc OTEL_SERVICE_NAME, PORT, PAYMENT_FAILURE_RATE
      :35-37   GET /health          (khai báo TRƯỚC json/requestContext)
      :39      app.use(express.json())
      :40      app.use(requestContext())
      :42-99   app.post('/payments', …)
      :101     app.use(notFound())
      :102     app.use(errorHandler())
      :104-106 app.listen(3401) + log "payment-service đang chạy…"
```

### 3.2 Một request `POST /payments`

```text
order-service
  src/routes/orders.js:85          chargePayment({ orderId, amount, customerId })
  src/lib/payment-client.js:30     fetch('http://payment-service:3401/payments')
      ↳ instrumentation-undici: tạo span CLIENT "POST" + chèn header traceparent
─────────────────────── HTTP qua network default ───────────────────────────
payment-service
  [instrumentation-http]           đọc traceparent → tạo span SERVER "POST /payments"
  │                                (cùng trace, là con của span "POST" bên order-service;
  │                                 phần "/payments" do instrumentation-express bổ sung)
  │
  ├─① express.json()               payment-service.js:39     span "middleware - jsonParser"
  │
  ├─② requestContext               middlewares.js:19-32      span "middleware - requestContext"
  │     :20-21  đặt header X-Trace-Id
  │     :24-30  hẹn ghi access log khi response 'finish'
  │     :31     next()
  │
  ├─③ handler POST /payments       payment-service.js:42-99  span "request handler - /payments"
  │     :43-46  kiểm tra body → sai thì trả 400 và dừng tại đây
  │     :50-54  gắn app.order.id, app.customer.id, app.payment.amount vào span SERVER
  │     :56-61  withSpan('fraud.check')                 → telemetry.js:37-53
  │               :57  sleep(randomInt(10, 40))          → utils.js:4, utils.js:7
  │               :58  randomInt(0, 100) = điểm rủi ro
  │               :59  span.setAttribute('app.fraud.score', …)
  │     :64-88  withSpan('bank.authorize', kind CLIENT) → telemetry.js:37-53
  │               :79  sleep(randomInt(40, 200))         giả lập độ trễ ngân hàng
  │               :80  Math.random() < FAILURE_RATE ?
  │               ├─ không lỗi: :84-85 tạo authCode, gắn vào span
  │               │             :90-92 logger.info "Thanh toán thành công" → res 201
  │               └─ lỗi:       :81 sleep(randomInt(300, 800)) → :82 throw Error
  │                             telemetry.js:46-47 ghi exception, đặt status ERROR
  │                             telemetry.js:48 ném lại; finally :50 vẫn end() span
  │                             payment-service.js:93-97 catch → logger.error → res 502
  │
  └─④ response gửi xong ('finish')
        middlewares.js:24-30   access log "POST /payments → 502 (513 ms)"
        instrumentation-http   kết thúc span SERVER; mã ≥ 500 → status ERROR
─────────────────────── trả kết quả về order-service ────────────────────────
  src/lib/payment-client.js:43-45   !res.ok → throw HttpError(502)    (utils.js:13-19)
  src/routes/orders.js:86-102       bù trừ đơn và kho, ghi lỗi vào span, trả 502
```

### 3.3 Khi nào `notFound` và `errorHandler` chạy

Với `POST /payments`, cả hai middleware này **không chạy** trong luồng bình thường lẫn khi ngân hàng lỗi.
Handler tự trả lời trong mọi trường hợp (400 ở `src/payment-service.js:45`, 201 ở `:92`, 502 ở `:97`), và
lỗi ngân hàng đã bị `try/catch` ở `:63-98` bắt lại. Chúng chỉ chạy trong các tình huống sau:

| Tình huống | Đi tới | Kết quả |
|---|---|---|
| Sai route, ví dụ `GET /payments` | `notFound` (`src/lib/middlewares.js:36-40`) | 404 |
| Body JSON sai cú pháp | `express.json()` gọi `next(err)`. Express bỏ qua `requestContext` và handler, nhảy thẳng tới `errorHandler` (`:50-70`) | 400 + `logger.warn` (`:64`). Không có access log và header X-Trace-Id, nhưng body JSON vẫn có `traceId` (`:68`) |
| Lỗi không được bắt trong handler, ví dụ `fraud.check` ném lỗi (nó nằm ngoài `try`, `src/payment-service.js:56-61`) | Express 5 tự chuyển promise bị reject tới `errorHandler` (`src/lib/middlewares.js:43`) | 500 + `logger.error` kèm stack trace (`:61`) |

Riêng `/health` (`src/payment-service.js:35-37`) được khai báo trước `requestContext` và bị
instrumentation-http bỏ qua (`src/tracing.js:78`), nên không sinh trace và không có access log.

---

## 4. Cơ chế telemetry

### 4.1 Span được tạo và kết thúc như thế nào

Span đến từ ba nguồn:

| Nguồn | Tạo span khi | Kết thúc span khi | Ví dụ |
|---|---|---|---|
| instrumentation-http (tự động) | request đi vào, hoặc service gọi ra ngoài | response gửi xong. SERVER lỗi nếu mã ≥ 500, CLIENT lỗi nếu mã ≥ 400 | `POST /payments` |
| instrumentation-express (tự động) | mỗi middleware và handler chạy. Tên span lấy theo tên hàm (`src/lib/middlewares.js:17-19`) | middleware: khi gọi `next()`. Handler: khi response xong | `middleware - requestContext`, `request handler - /payments` |
| `withSpan()` (tự viết) | gọi `tracer.startActiveSpan` (`src/lib/telemetry.js:42`) | luôn `end()` trong `finally` (`:49-51`). Nếu lỗi thì ghi exception và đặt ERROR (`:45-48`) | `fraud.check`, `bank.authorize` |

Phần payment-service trong trace thật trông như sau. Span middleware dài khoảng 0 ms, còn span handler
kéo dài suốt thời gian xử lý:

```text
POST /payments                    SERVER    514 ms   ERROR (502)
├─ middleware - jsonParser        INTERNAL    0.2 ms
├─ middleware - requestContext    INTERNAL    0 ms
└─ request handler - /payments    INTERNAL  513 ms
   ├─ fraud.check                 INTERNAL   16 ms
   └─ bank.authorize              CLIENT    496 ms   ERROR (exception)
```

Span không được gửi ngay khi kết thúc. BatchSpanProcessor gom chúng thành lô và gửi khoảng 5 giây một lần
(`src/tracing.js:103-105`).

### 4.2 SpanKind

| Kind | Nghĩa | Trong dự án |
|---|---|---|
| SERVER | service nhận request | span HTTP đi vào (tự động): `POST /payments`, `POST /api/orders` |
| CLIENT | service gọi ra ngoài | `fetch` sang payment-service (tự động, tên span là `POST`); `bank.authorize` (`src/payment-service.js:69`); SQL và Redis giả lập (`src/lib/fake-db.js:59`, `:87`) |
| INTERNAL | bước xử lý bên trong | mặc định của `withSpan` khi không truyền `kind`: `fraud.check`, `order.validate`; các span middleware |

SigNoz đọc kind cùng các thuộc tính đi kèm:

- **`bank.authorize`** là span CLIENT có `peer.service: bank-gateway` (`src/payment-service.js:71`), cho
  biết service đang gọi hệ thống nào. Phía ngân hàng không gửi span SERVER, nên trace dừng ở span này.
  bank-gateway cũng không xuất hiện trên Service Map: map chỉ có các cạnh order-service → payment-service,
  postgresql, redis.
- **Span CLIENT có `db.system`** (`src/lib/fake-db.js:61`, `:89`) tạo ra hai node postgresql và redis trên
  Service Map, và mục "Database Calls" của service.

### 4.3 Lan truyền context

**Trong một process.** NodeSDK dùng AsyncLocalStorage, nên "span đang active" được giữ nguyên qua các lần
`await`. `startActiveSpan` đặt span mới làm active trong lúc `fn` chạy (`src/lib/telemetry.js:30-31`). Nhờ
đó, span con và log bên trong tự gắn vào nó. Code lấy span hiện tại bằng `trace.getActiveSpan()`
(`src/payment-service.js:50`, `src/lib/middlewares.js:20`).

**Giữa hai service.** Dùng header W3C `traceparent`. Không service nào có dòng code tự xử lý header này
(`src/lib/payment-client.js:6-10`, `src/payment-service.js:48-49`).

```text
order-service                                      payment-service
payment-client.js:30  fetch()
  instrumentation-undici tạo span CLIENT "POST"
  (span id 42b102…), chèn header:
  traceparent: 00-ba1f35bc…801b-42b102…-01
                  │   └ trace id    └ span id cha  └ sampled
                  └──────────────────────────────►  instrumentation-http đọc header
                                                    tạo span SERVER "POST /payments"
                                                    trace id = ba1f35bc…801b
                                                    parent   = 42b102…
```

Chi tiết, dữ liệu thật và cách tự kiểm chứng: [TRACE_PROPAGATION.md](TRACE_PROPAGATION.md).

### 4.4 Log được gắn trace_id/span_id như thế nào

`src/lib/logger.js` chỉ tạo một logger pino bình thường. instrumentation-pino (bật sẵn,
`src/tracing.js:87`) làm hai việc:

1. Chèn `trace_id`, `span_id`, `trace_flags` vào từng dòng JSON in ra stdout.
2. Gửi một bản sao thành LogRecord, đi qua BatchLogRecordProcessor và OTLPLogExporter tới `/v1/logs`
   (`src/tracing.js:117-119`).

Mỗi dòng log mang `span_id` của span đang active lúc ghi. Đây là 5 log thật của trace ví dụ:

| Log | Ghi ở | span_id | Thuộc span |
|---|---|---|---|
| order · info "Đã tạo đơn, đang gọi payment-service" | `src/routes/orders.js:80` | 5ec894 | request handler - /api/orders |
| payment · error "Thanh toán thất bại vì cổng ngân hàng" | `src/payment-service.js:96` | 638179 | request handler - /payments |
| payment · info "POST /payments → 502 (513 ms)" | `src/lib/middlewares.js:26-29` | 84404d | POST /payments (SERVER) |
| order · error "Thanh toán thất bại, đã hoàn lại kho" | `src/routes/orders.js:96` | 5ec894 | request handler - /api/orders |
| order · info "POST /api/orders → 502 (593 ms)" | `src/lib/middlewares.js:26-29` | ad8b6b | POST /api/orders (root) |

Access log ghi trong `res.on('finish')` mang span_id của span SERVER (`src/lib/middlewares.js:13-14`).
Điều kiện để tất cả hoạt động: pino phải được require **sau** khi `tracing.js` chạy
(`src/lib/logger.js:14`). Các dòng `console.log` như log `[otel]` không được gửi lên SigNoz.

### 4.5 Từ SDK tới giao diện SigNoz

```text
SDK gom lô (span ~5 s · log ~1 s · metric 15 s)
   └─► OTLP/HTTP POST http://signoz-ingester:4318/v1/{traces,metrics,logs}
        └─► OTel Collector: processor signozspanmetrics tính thêm metric APM từ span,
            rồi ghi tất cả xuống ClickHouse
             └─► ClickHouse: signoz_traces · signoz_logs · signoz_metrics
                  └─► SigNoz UI http://localhost:8080
```

Cấu hình collector do Foundry sinh ra nằm ở `signoz/pours/deployment/ingester/ingester.yaml`.

Những gì thấy được trên giao diện (đã đối chiếu với ClickHouse):

| Màn hình | Thấy gì | Đến từ |
|---|---|---|
| Services | Request/giây, % lỗi, P99 của từng service | các span root/entrypoint của service |
| Traces | Một trace đi qua 2 service; `bank.authorize` tô đỏ, có exception | instrumentation và `withSpan` |
| Logs | Log của cả hai service, bấm từ trace_id sang trace tương ứng | instrumentation-pino |
| Exceptions | `Error: Bank gateway timeout…` (payment-service) và `HttpError: payment-service trả về 502…` (order-service) | `recordException` ở `src/lib/telemetry.js:46` và `src/routes/orders.js:94` |
| Service Map | order-service → payment-service, postgresql, redis | cặp span CLIENT/SERVER và span có `db.system` |
| Dashboards | `shop.orders`, `shop.revenue`, `shop.payment.duration`, metric runtime của Node | `src/lib/telemetry.js:60-75`, instrumentation-runtime-node |

---

## 5. Biến môi trường

| Biến | Đọc ở | Mặc định | Vai trò |
|---|---|---|---|
| `OTEL_SERVICE_NAME` | SDK (envDetector, `src/tracing.js:101`); app (`src/payment-service.js:27`, `src/server.js:21`) | compose đặt `order-service` / `payment-service` (`docker-compose.yml:47`, `:63`) | Tên service trên SigNoz. Thiếu thì hiện `unknown_service:node` (`src/tracing.js:134-136`) |
| `PORT` | `src/payment-service.js:28`, `src/server.js:22`, healthcheck `Dockerfile:47` | 3401 / 3400 | Cổng HTTP trong container |
| `PAYMENT_FAILURE_RATE` | `src/payment-service.js:29-30`, dùng ở `:80` | 0.15 (`docker-compose.yml:65`) | Tỉ lệ giả lập ngân hàng lỗi |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | exporter tự đọc (`src/tracing.js:103-106`) | `http://signoz-ingester:4318` (`docker-compose.yml:32`) | Địa chỉ gốc; SDK tự nối `/v1/traces`, `/v1/metrics`, `/v1/logs` |
| `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT` | exporter tự đọc; `src/tracing.js:128-131` chỉ in ra log | không đặt | URL đầy đủ riêng cho traces, ưu tiên hơn biến gốc |
| `OTEL_EXPORTER_OTLP_HEADERS` | exporter tự đọc | rỗng | Header gửi kèm mọi request, ví dụ `signoz-ingestion-key=<key>` cho SigNoz Cloud (`.env.example:64`) |
| `OTEL_RESOURCE_ATTRIBUTES` | envDetector | `docker-compose.yml:35` | `service.namespace`, `service.version`, `deployment.environment` |
| `OTEL_METRIC_EXPORT_INTERVAL` | `src/tracing.js:93` (đọc tay) | 15000 | Chu kỳ gửi metric (ms) |
| `OTEL_LOG_LEVEL` / `OTEL_SDK_DISABLED` | `src/tracing.js:57-59` / `:49-52` | warn / — | Log nội bộ của SDK / tắt hẳn OpenTelemetry |
| `PAYMENT_SERVICE_URL`, `PAYMENT_TIMEOUT_MS` | `src/lib/payment-client.js:16-17` | `http://payment-service:3401`, 3000 ms | order-service gọi payment-service ở đâu và chờ tối đa bao lâu |
| `LOG_LEVEL` | `src/lib/logger.js:20` | info | Mức log của pino |

### 5.1 Cơ chế mô phỏng lỗi theo `FAILURE_RATE`

**Cách đọc giá trị** (`src/payment-service.js:29-30`):

- Không đặt biến → 0.15.
- Giá trị không phải số → 0.15.
- Giá trị được kẹp vào khoảng [0, 1]: `2` thành 1, `-1` thành 0.
- Trường hợp lạ: chuỗi rỗng cho ra 0, vì `??` không bắt `''`. Docker Compose tránh được trường hợp này nhờ
  `${PAYMENT_FAILURE_RATE:-0.15}`, cú pháp thay cả biến rỗng lẫn biến chưa đặt bằng 0.15.

**Cách dùng** (`:80`): `Math.random()` trả về số trong [0, 1).

- `0` → không bao giờ lỗi.
- `1` → luôn lỗi.
- `0.15` → khoảng 15% số lần gọi.

Khi lỗi, code chờ thêm 300–800 ms (`:81`) để giống timeout thật, rồi ném lỗi (`:82`).

**Mục đích** là tạo ra một lỗi lan qua cả chuỗi, nằm gọn trong **cùng một trace**:

```text
bank.authorize        exception + ERROR                     src/lib/telemetry.js:46-47
→ payment-service     catch, logger.error, trả 502          src/payment-service.js:93-97
→ POST /payments      span SERVER bị ERROR (mã ≥ 500)       instrumentation-http
→ POST (fetch)        span CLIENT bị ERROR                  instrumentation-undici
→ payment-client      throw HttpError(502)                  src/lib/payment-client.js:43-45
→ orders.js           đặt PAYMENT_FAILED + trả hàng về kho,
                      recordException, trả 502              src/routes/orders.js:86-102
→ POST /api/orders    span SERVER bị ERROR                  instrumentation-http
```

Lỗi cũng hiện ở metric:

- `shop.orders{order.status=payment_failed}` (`src/routes/orders.js:90`);
- `shop.payment.duration{payment.outcome=failed}` (`src/lib/payment-client.js:51`).

Vì lần gọi lỗi chậm hơn, P99 trên trang Services cũng tăng theo. Với tỉ lệ này có thể tập các việc: tìm
trace lỗi, lần ra span gây lỗi gốc (span đỏ sâu nhất), so sánh độ trễ giữa thành công và thất bại, và đặt
cảnh báo theo % lỗi.

> **Lưu ý:** `.env.example:25` hiện đặt `PAYMENT_FAILURE_RATE=1`, khác mặc định 0.15 trong README,
> `docker-compose.yml` và code. Copy file này thành `.env` thì mọi lần thanh toán đều lỗi (lần chạy thử
> ngày 05/11/2026: 735/735 lần). Giá trị 0 và 1 vốn dùng cho test, để kết quả luôn như nhau
> (`test/telemetry.test.js:12-14`). Để demo có cả thành công lẫn thất bại, đặt `0.15` rồi chạy
> `docker compose up -d` để payment-service nhận giá trị mới.

---

## 6. Phụ lục: tự kiểm chứng bằng ClickHouse

Các ví dụ "trace thật" ở trên có thể xem lại trực tiếp trong ClickHouse của SigNoz. Lệnh dưới dùng cho
SigNoz tự host cài bằng Foundry (container `signoz-telemetrystore-clickhouse-0-0`); bản compose cũ dùng
container `signoz-clickhouse`. Chạy được trong cả Bash lẫn PowerShell.

Lấy một trace mới nhất có đi qua payment-service:

```bash
docker exec signoz-telemetrystore-clickhouse-0-0 clickhouse-client -q "SELECT trace_id FROM signoz_traces.distributed_signoz_index_v3 WHERE serviceName = 'payment-service' ORDER BY timestamp DESC LIMIT 1"
```

Toàn bộ span của trace đó, kèm span cha (thay `<TRACE_ID>`):

```bash
docker exec signoz-telemetrystore-clickhouse-0-0 clickhouse-client -q "SELECT substring(span_id, 1, 6) AS span, substring(parent_span_id, 1, 6) AS parent, serviceName AS service, name, kind_string AS kind, round(duration_nano / 1e6, 1) AS ms, has_error AS err FROM signoz_traces.distributed_signoz_index_v3 WHERE trace_id = '<TRACE_ID>' ORDER BY timestamp FORMAT PrettyCompactMonoBlock"
```

Log của trace đó, kèm span_id:

```bash
docker exec signoz-telemetrystore-clickhouse-0-0 clickhouse-client -q "SELECT resources_string['service.name'] AS service, severity_text AS sev, body, substring(span_id, 1, 6) AS span FROM signoz_logs.distributed_logs_v2 WHERE trace_id = '<TRACE_ID>' ORDER BY timestamp FORMAT PrettyCompactMonoBlock"
```

Muốn kiểm tra tự động cả ba loại tín hiệu (traces, logs, metrics) thì chạy `npm run verify`
(`scripts/verify.js`).
