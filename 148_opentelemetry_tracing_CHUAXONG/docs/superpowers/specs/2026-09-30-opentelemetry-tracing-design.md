# Thiết kế: Ví dụ OpenTelemetry tracing cho Node.js

- **Thư mục:** `148_opentelemetry_tracing/`
- **Ngày:** 2026-09-30
- **Trạng thái:** thiết kế đã duyệt trong chat (3 phần), spec chờ duyệt

---

## 1. Mục tiêu

### 1.1 Yêu cầu của người dùng

1. Cài package: `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, exporter OTLP.
2. File khởi tạo tracing và cách load nó trước khi app khởi động.
3. Cấu hình service name và resource attributes.
4. Tích hợp Express, tự động trace HTTP request.
5. Tạo custom span thủ công kèm attributes, ghi nhận exception và span status.
6. Truyền context giữa các service (trace context propagation).
7. Export trace tới Jaeger hoặc OTLP Collector, kèm docker-compose để chạy thử.
8. Code mẫu đầy đủ cho từng bước, giải thích ngắn gọn bằng tiếng Việt.

### 1.2 Giả định đã chốt

- Deliverable giống `146_saga_pattern_nodejs`: project chạy được + `README.md` tiếng Việt
  (mục lục, sơ đồ, output mẫu, lưu ý production).
- Mục đích: ví dụ tham khảo để học, không gắn vào service thật nào.
- JavaScript CommonJS, `'use strict'`, comment tiếng Việt. Chạy trên Node 22.
- Dùng bản mới nhất trên npm tại ngày 2026-09-30 (bảng ở mục 4.1).
- Giao thức OTLP/HTTP protobuf (cổng 4318). README ghi chú cách đổi sang gRPC.
- Docker chỉ chạy hạ tầng (Collector, Jaeger, Redis). Ba service Node chạy trên máy bằng npm script.
- Mô hình propagation: **2 service HTTP + 1 worker qua hàng đợi Redis**.
- Ba phần nhỏ đã được đồng ý thêm: baggage `customer.tier`, logger in kèm `trace_id`, bỏ qua trace cho `/health`.

### 1.3 Ngoài phạm vi

- Metrics và logs qua OTLP (log chỉ in ra console, kèm `trace_id`).
- Chạy service Node trong Docker, Kubernetes.
- TypeScript. ESM chỉ được ghi chú trong README, code dùng CommonJS.
- Database thật: danh mục sản phẩm và tồn kho nằm trong bộ nhớ.

### 1.4 Tiêu chí hoàn thành

- `npm install` → `npm run infra:up` → `npm start` → `npm run demo`, rồi mở Jaeger UI
  (`http://localhost:16686`) thấy:
  - một trace đi xuyên cả 3 service,
  - custom span có attributes,
  - trace lỗi có event `exception` và status ERROR.
- `npm run verify` pass ở cả hai chế độ export: qua Collector, và gửi thẳng Jaeger.

---

## 2. Kiến trúc

```
client ─► api-gateway :3000 ──HTTP──► order-service :3001 ──Redis list──► notification-worker
                    traceparent tự đi theo    tự inject context          tự extract context
                    header, không cần code    vào message                từ message

          cả 3 service ── OTLP/HTTP :4318 ──► OTel Collector ──► Jaeger (UI :16686)
          (chế độ gửi thẳng: OTLP/HTTP :14318 ──► Jaeger)
```

### 2.1 Thành phần và cổng

| Thành phần | Chạy ở | Cổng trên máy | Vai trò |
|---|---|---|---|
| `api-gateway` | Node, trên máy | 3000 | Nhận `POST /orders`, gọi order-service bằng `fetch` |
| `order-service` | Node, trên máy | 3001 | Validate → giữ hàng → thanh toán → đẩy event vào Redis |
| `notification-worker` | Node, trên máy | (không có) | `BRPOP` từ Redis, mô phỏng gửi email |
| `otel-collector` | Docker `otel/opentelemetry-collector-contrib:0.161.0` | 4317, 4318 | Nhận OTLP, chuyển tiếp tới Jaeger |
| `jaeger` | Docker `jaegertracing/jaeger:2.21.0` | 16686 (UI), 14318 (OTLP HTTP) | Lưu trace trong bộ nhớ và hiển thị |
| `redis` | Docker `redis:8-alpine` | 16379 | Hàng đợi `order-events` |

- Cổng 6379 trên máy đã có một Redis khác chạy, nên Redis của demo map ra 16379.
- Compose đặt `name: otel-tracing-demo` để tách khỏi các project khác và không đặt `container_name` cố định.

### 2.2 Trace mong đợi cho đơn thành công

```
api-gateway          POST /orders                       SERVER
api-gateway          └─ POST                            CLIENT    fetch, tự động (undici)
order-service           └─ POST /orders                 SERVER    tự động (http + express)
order-service              ├─ order.validate            INTERNAL  custom
order-service              ├─ inventory.reserve         INTERNAL  custom
order-service              ├─ payment.charge            INTERNAL  custom, viết tay không qua helper
order-service              └─ send order-events         PRODUCER  custom
order-service                 ├─ lpush                  CLIENT    ioredis, tự động
notification-worker           └─ process order-events   CONSUMER  cha = context lấy từ message
notification-worker              └─ email.send          INTERNAL  custom
```

Express còn sinh span `middleware - ...` và `request handler - /orders`. Custom span có thể nằm dưới
span `request handler` thay vì nằm thẳng dưới span SERVER. Sơ đồ trên lược bỏ các span này.

### 2.3 Kịch bản demo

| Kịch bản | Request gửi tới gateway | HTTP | Span ERROR | Ghi chú |
|---|---|---|---|---|
| `success` | `POST /orders` | 201 | Không có | Trace có đủ 3 service |
| `payment-failed` | `POST /orders` | 502 | `payment.charge` (kèm exception) và mọi HTTP span của 2 service | Không có span `send order-events` |
| `invalid` | `POST /orders` | 400 | `order.validate` và span CLIENT ở gateway | Span SERVER của cả 2 service **không** ERROR, vì 4xx là lỗi phía client |
| `health` | `GET /health` | 200 | (không có trace) | Bị `ignoreIncomingRequestHook` bỏ qua |

Body của 3 request `POST /orders`:

```js
// success: tổng tiền 2 x 350.000 + 1 x 120.000 = 820.000
{ customerId: 'VIP-001', items: [{ sku: 'SERUM-01', qty: 2 }, { sku: 'MASK-03', qty: 1 }], paymentMethod: 'card' }
// payment-failed
{ customerId: 'C-002', items: [{ sku: 'TONER-02', qty: 1 }], paymentMethod: 'expired_card' }
// invalid
{ customerId: 'C-003', items: [], paymentMethod: 'card' }
```

---

## 3. Cấu trúc thư mục

```
148_opentelemetry_tracing/
├── README.md                          hướng dẫn tiếng Việt (dàn ý ở mục 7)
├── package.json
├── package-lock.json                  được commit
├── .gitignore                         node_modules/, *.log
├── docker-compose.yml                 Collector + Jaeger + Redis
├── otel-collector-config.yaml
├── docs/superpowers/specs/            spec này
├── src/
│   ├── tracing.js                     khởi tạo NodeSDK, nạp bằng --require
│   ├── shared/
│   │   ├── tracer.js                  tracer dùng chung + helper withSpan()
│   │   ├── propagation.js             inject/extract context, helper baggage
│   │   └── logger.js                  log kèm trace_id / span_id
│   ├── api-gateway/server.js
│   ├── order-service/
│   │   ├── server.js                  route + error middleware
│   │   ├── catalog.js                 danh mục sản phẩm trong bộ nhớ
│   │   └── errors.js                  ValidationError, PaymentError (có status + code)
│   └── notification-worker/worker.js
└── scripts/
    ├── demo.js                        gửi 3 kịch bản, in link Jaeger cho từng trace
    └── verify-traces.js               kiểm thử end-to-end qua Jaeger API
```

`148_opentelemetry_tracing/.idea/` là cấu hình IDE của người dùng. Không commit, không sửa.

---

## 4. Thiết kế chi tiết

### 4.1 Package

| Package | Phiên bản | Loại |
|---|---|---|
| `@opentelemetry/sdk-node` | `^0.222.0` | dependency |
| `@opentelemetry/auto-instrumentations-node` | `^0.80.0` | dependency |
| `@opentelemetry/exporter-trace-otlp-proto` | `^0.222.0` | dependency |
| `@opentelemetry/api` | `^1.9.1` | dependency |
| `@opentelemetry/resources` | `^2.11.0` | dependency |
| `@opentelemetry/semantic-conventions` | `^1.43.0` | dependency |
| `express` | `^5.2.1` | dependency |
| `ioredis` | `^6.0.0` | dependency |
| `cross-env` | `^10.1.0` | devDependency |
| `concurrently` | `^10.0.5` | devDependency (yêu cầu Node >= 22) |

Đã kiểm tra: instrumentation-express hỗ trợ express `>=4 <6`, instrumentation-ioredis hỗ trợ ioredis `>=2 <7`.

### 4.2 `src/tracing.js`

- Nạp bằng `node --require ./src/tracing.js <entry>` trong npm script. File này phải chạy trước mọi
  `require` khác của app, nếu không thư viện sẽ không được patch.
- **Resource:**
  ```js
  defaultResource().merge(resourceFromAttributes({
    [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME || 'unknown-service',
    [ATTR_SERVICE_VERSION]: pkg.version,
    [ATTR_SERVICE_NAMESPACE]: 'shop',
    [ATTR_SERVICE_INSTANCE_ID]: randomUUID(),
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || 'development',
  }))
  ```
  Cả 5 hằng số đều import từ entry stable của `@opentelemetry/semantic-conventions` 1.43.
  Phải merge với `defaultResource()`, nếu không trace sẽ mất các attribute `telemetry.sdk.*`.
- **Thứ tự ưu tiên** (đã kiểm tra trong source sdk-node 0.222): `resource` trong code < resource do detector
  phát hiện (env, process, host; detector env đọc `OTEL_SERVICE_NAME` và `OTEL_RESOURCE_ATTRIBUTES`) <
  option `serviceName`. Vì vậy không dùng option `serviceName`, để biến môi trường vẫn ghi đè được.
- **Exporter:** `new OTLPTraceExporter()` từ `@opentelemetry/exporter-trace-otlp-proto`, không truyền URL.
  Exporter đọc `OTEL_EXPORTER_OTLP_ENDPOINT` (mặc định `http://localhost:4318`) và tự nối thêm `/v1/traces`.
  NodeSDK bọc exporter trong `BatchSpanProcessor`, mặc định gửi khoảng 5 giây một lần.
- **Instrumentations:** `getNodeAutoInstrumentations({...})` với:
  - `@opentelemetry/instrumentation-http`: `ignoreIncomingRequestHook` bỏ qua request có path `/health`.
  - `@opentelemetry/instrumentation-dns` và `@opentelemetry/instrumentation-net`: `enabled: false`.
  - `fs` mặc định đã tắt. `ioredis` mặc định có `requireParentSpan: true`, nên vòng `BRPOP` của worker
    (không có span cha) không sinh span.
- **Shutdown:** bắt `SIGINT` và `SIGTERM`, gọi `sdk.shutdown()` để flush rồi `process.exit(0)`.
- Khi khởi động, in một dòng gồm service name và endpoint export để dễ debug.
- Debug SDK: đặt `OTEL_LOG_LEVEL=debug`, NodeSDK tự đọc biến này.

### 4.3 `src/shared/tracer.js`

- `tracer = trace.getTracer('otel-tracing-demo', pkg.version)`.
- `withSpan(name, options, fn, parentContext = context.active())`:
  - Gọi `tracer.startActiveSpan(name, options, parentContext, async (span) => ...)`, nhờ vậy span con
    (ví dụ `lpush`) tự lồng vào đúng chỗ.
  - Thành công: trả kết quả của `fn(span)`, status để UNSET, không đặt OK.
  - Lỗi: `span.recordException(err)`, `span.setAttribute(ATTR_ERROR_TYPE, err.code || err.name)`,
    `span.setStatus({ code: SpanStatusCode.ERROR, message: err.message })`, rồi ném lỗi tiếp.
  - `span.end()` luôn nằm trong `finally`.

### 4.4 `src/shared/propagation.js`

- `injectContext(carrier = {})`: gọi `propagation.inject(context.active(), carrier)` rồi trả về carrier.
- `extractContext(carrier)`: `propagation.extract(ROOT_CONTEXT, carrier || {})`.
- `withBaggage(entries, fn)`: chạy `fn` trong context có baggage mới, tạo bằng `propagation.createBaggage` +
  `propagation.setBaggage`.
- `getBaggageValue(key, ctx = context.active())`: đọc một giá trị baggage, không có thì trả `undefined`.
- Định dạng message trong Redis list `order-events`:
  ```json
  {
    "id": "msg-<uuid>",
    "type": "order.created",
    "payload": { "orderId": "ORD-...", "customerId": "VIP-001", "total": 820000, "itemCount": 2 },
    "headers": { "traceparent": "00-<trace-id>-<span-id>-01", "baggage": "customer.tier=gold" },
    "publishedAt": "<ISO-8601>"
  }
  ```

### 4.5 `src/shared/logger.js`

- `createLogger(serviceName)` trả về `info`, `warn`, `error(message, fields?)`.
- Định dạng: `HH:MM:SS.mmm [service] message key=value ... trace_id=<32 hex> span_id=<16 hex>`.
  `trace_id` và `span_id` lấy từ `trace.getActiveSpan()`. Không có span active thì bỏ hai trường này.

### 4.6 `api-gateway`

- `POST /orders`:
  - Suy ra `customer.tier` từ `customerId`: bắt đầu bằng `VIP` thì là `gold`, còn lại là `standard`.
  - Chạy `withBaggage({ 'customer.tier': tier }, () => fetch(ORDER_SERVICE_URL + '/orders', ...))`.
    Instrumentation undici tự inject `traceparent` và `baggage` vào request.
  - Trả lại đúng status và body của order-service, thêm trường `traceId` của trace hiện tại.
  - Không gọi được order-service (lỗi mạng) thì trả 503 `{ error: 'ORDER_SERVICE_UNAVAILABLE' }`.
- `GET /health`: trả 200 `{ status: 'ok' }`, không sinh trace.
- Biến môi trường: `PORT` (mặc định 3000), `ORDER_SERVICE_URL` (mặc định `http://localhost:3001`).

### 4.7 `order-service`

- `catalog.js`: danh mục sản phẩm trong bộ nhớ.

  | `sku` | `name` | `price` (đ) | `stock` |
  |---|---|---|---|
  | `SERUM-01` | Serum vitamin C | 350000 | 50 |
  | `TONER-02` | Toner hoa hồng | 180000 | 30 |
  | `MASK-03` | Mặt nạ đất sét | 120000 | 100 |

- `POST /orders` chạy 4 bước theo thứ tự:
  1. `order.validate` (qua `withSpan`): attributes `customer.id`, `customer.tier` (đọc từ baggage),
     `order.item_count`. Ném `ValidationError` (status 400, code `VALIDATION_ERROR`) khi `items` rỗng,
     SKU không tồn tại, hoặc `qty` không nằm trong khoảng 1 tới `stock`.
  2. `inventory.reserve` (qua `withSpan`): mô phỏng độ trễ, `addEvent('stock.reserved', { sku, qty })` cho
     từng dòng hàng. Không trừ tồn kho thật, nên không cần bước hoàn lại khi thanh toán lỗi.
  3. `payment.charge` (**viết tay, không qua helper**): attributes `payment.method`, `payment.amount`
     (tổng tiền đơn).
     Nếu `paymentMethod === 'expired_card'` thì ném `PaymentError` (status 502, code `CARD_EXPIRED`),
     kèm `recordException` + `error.type` + `setStatus(ERROR)`. Thành công thì ghi `payment.transaction_id`.
     `span.end()` nằm trong `finally`.
  4. `send order-events` (qua `withSpan`, kind PRODUCER, attributes `messaging.*`): `injectContext(headers)`
     rồi `LPUSH order-events <json>`.
- Thành công: 201 `{ orderId, status: 'CONFIRMED', total, traceId }`.
- Error middleware: lỗi có `status` và `code` thì trả `{ error: code, message }` với status đó. Lỗi khác trả 500.
- `GET /health`: trả 200.
- Biến môi trường: `PORT` (mặc định 3001), `REDIS_URL` (mặc định `redis://localhost:16379`).
- Các bước mô phỏng độ trễ ngẫu nhiên khoảng 20–80 ms để span có độ dài dễ nhìn trong Jaeger.

### 4.8 `notification-worker`

- Vòng lặp `BRPOP order-events 5`. Timeout 5 giây để vòng lặp kiểm tra được cờ dừng khi shutdown.
- Mỗi message:
  - `parentCtx = extractContext(message.headers)`.
  - `withSpan('process order-events', { kind: CONSUMER, attributes: messaging.* }, fn, parentCtx)`:
    - đọc `customer.tier` từ baggage trong `parentCtx` rồi ghi thành attribute; `gold` thì thêm
      `notification.priority = high`, còn lại là `normal`;
    - bên trong có span con `email.send` (qua `withSpan`): mô phỏng độ trễ, attributes
      `notification.channel = email`, `notification.template = order-confirmation`.
- Message không parse được JSON: log lỗi rồi bỏ qua, không làm crash worker.
- Biến môi trường: `REDIS_URL` (mặc định `redis://localhost:16379`).

### 4.9 Semantic conventions sử dụng

| Attribute | Dùng ở đâu | Mức |
|---|---|---|
| `service.name`, `service.version`, `service.namespace`, `service.instance.id`, `deployment.environment.name` | Resource | Stable, import từ package |
| `error.type` | Span lỗi | Stable, import từ package |
| `exception.type`, `exception.message`, `exception.stacktrace` | Event `exception`, do `recordException` tạo | Stable |
| `messaging.system` (`redis`), `messaging.destination.name` (`order-events`), `messaging.operation.type` (`send` / `process`), `messaging.operation.name`, `messaging.message.id` | Span PRODUCER / CONSUMER | Incubating, khai báo thành hằng số trong code |
| `order.*`, `customer.*`, `payment.*`, `notification.*` | Custom span | Attribute riêng của ứng dụng |

Tên span messaging theo mẫu `{operation} {destination}`: `send order-events`, `process order-events`.
Span CONSUMER dùng context lấy từ message làm cha, để cả luồng hiện thành một trace. README nói thêm về span
link, dùng khi xử lý message theo lô.

---

## 5. Hạ tầng

### 5.1 `docker-compose.yml`

```yaml
name: otel-tracing-demo

services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.161.0
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP
    depends_on:
      - jaeger

  jaeger:
    image: jaegertracing/jaeger:2.21.0
    ports:
      - "16686:16686" # UI + API
      - "14318:4318"  # OTLP HTTP, dùng cho chế độ gửi thẳng

  redis:
    image: redis:8-alpine
    ports:
      - "16379:6379"
```

### 5.2 `otel-collector-config.yaml`

```yaml
receivers:
  otlp:
    protocols:
      grpc:
        endpoint: 0.0.0.0:4317   # mặc định chỉ nghe localhost, trong container phải mở 0.0.0.0
      http:
        endpoint: 0.0.0.0:4318

processors:
  memory_limiter:
    check_interval: 1s
    limit_percentage: 80
    spike_limit_percentage: 25
  batch: {}

exporters:
  otlp_grpc/jaeger:              # từ Collector 0.161 tên là otlp_grpc, tên cũ "otlp" đã deprecated
    endpoint: jaeger:4317
    tls:
      insecure: true
  debug:
    verbosity: basic

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_grpc/jaeger, debug]
```

Ví dụ tail sampling chỉ nằm trong README, phần lưu ý production. Config của demo không bật tail sampling.

### 5.3 Hai chế độ export

| Chế độ | Lệnh | Endpoint app dùng | Cách kiểm chứng |
|---|---|---|---|
| Qua Collector (nên dùng) | `npm start` | `http://localhost:4318` (mặc định) | `docker compose logs otel-collector` có span |
| Gửi thẳng Jaeger | `npm run start:direct` | `http://localhost:14318` | Log Collector không có span mới, Jaeger vẫn có trace |

Code không đổi giữa hai chế độ, chỉ khác biến `OTEL_EXPORTER_OTLP_ENDPOINT`.

### 5.4 npm scripts

| Script | Lệnh |
|---|---|
| `infra:up` | `docker compose up -d` |
| `infra:down` | `docker compose down` |
| `infra:logs` | `docker compose logs -f otel-collector` |
| `start:gateway` | `cross-env OTEL_SERVICE_NAME=api-gateway PORT=3000 node --require ./src/tracing.js src/api-gateway/server.js` |
| `start:order` | `cross-env OTEL_SERVICE_NAME=order-service PORT=3001 node --require ./src/tracing.js src/order-service/server.js` |
| `start:worker` | `cross-env OTEL_SERVICE_NAME=notification-worker node --require ./src/tracing.js src/notification-worker/worker.js` |
| `start` | `concurrently -n gateway,order,worker -c cyan,magenta,yellow npm:start:gateway npm:start:order npm:start:worker` |
| `start:direct` | `cross-env OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:14318 npm start` |
| `demo` | `node scripts/demo.js` |
| `verify` | `node scripts/verify-traces.js` |

`demo` và `verify` đọc `GATEWAY_URL` (mặc định `http://localhost:3000`) và `JAEGER_URL`
(mặc định `http://localhost:16686`).

---

## 6. Kiểm thử và xác minh

### 6.1 `scripts/verify-traces.js`

1. Chờ `GET /health` của gateway và order-service trả 200, tối đa 30 giây.
2. Gửi 3 kịch bản `POST /orders` ở mục 2.3 và một request `GET /health`. Lấy `traceId` từ response của
   3 kịch bản `POST` (`/health` không có trace nên không có `traceId`).
3. Với mỗi `traceId`, hỏi Jaeger (`GET {JAEGER_URL}/api/traces/{traceId}`) lặp lại cho tới khi trace có đủ
   span kỳ vọng, tối đa 30 giây.
4. Kiểm tra:
   - **success**
     - HTTP 201.
     - Có span của đủ 3 service.
     - Có đủ các span: `POST /orders` (SERVER) ở gateway và order-service, `POST` (CLIENT) ở gateway,
       `order.validate`, `inventory.reserve`, `payment.charge`, `send order-events` (PRODUCER), `lpush`,
       `process order-events` (CONSUMER), `email.send`.
     - Span cha của `process order-events` là `send order-events`.
     - `customer.tier = gold` có trên `order.validate` và `process order-events`.
     - Resource của từng service có `service.namespace = shop` và `deployment.environment.name`.
     - Không span nào ở trạng thái ERROR.
   - **payment-failed**
     - HTTP 502.
     - `payment.charge` có status ERROR, `error.type = CARD_EXPIRED` và event `exception`.
     - Span SERVER `POST /orders` của order-service ở trạng thái ERROR.
     - Span CLIENT `POST` và span SERVER `POST /orders` ở gateway ở trạng thái ERROR.
     - Không có span `send order-events`.
   - **invalid**
     - HTTP 400.
     - `order.validate` có status ERROR và event `exception`.
     - Span SERVER `POST /orders` của cả order-service và gateway **không** ERROR.
     - Span CLIENT `POST` ở gateway ở trạng thái ERROR.
   - **health**
     - HTTP 200.
     - Danh sách operation của `api-gateway` trong Jaeger không có operation nào bắt đầu bằng `GET`
       (gateway không có route `GET` nào khác ngoài `/health`).
5. In PASS/FAIL cho từng check. Có check FAIL thì exit code là 1.

### 6.2 Quy trình xác minh trước khi báo xong

1. Viết `verify-traces.js` trước và chạy để thấy nó FAIL (chưa có service). Đây là TDD ở mức end-to-end.
2. Code các service cho tới khi `npm run verify` pass với `npm start` (qua Collector). Xem
   `docker compose logs otel-collector` có span.
3. Chạy lại với `npm run start:direct`: `verify` pass, log Collector không có span mới.
4. Chạy `npm run demo`, lấy output thật đưa vào phần output mẫu của README.
5. Dừng các service và chạy `docker compose down`.

---

## 7. README (dàn ý)

0. Giới thiệu, sơ đồ kiến trúc, mục lục.
1. Chạy nhanh: 4 lệnh và link Jaeger.
2. Bước 1: cài package, vai trò của từng package.
3. Bước 2: file `tracing.js` và cách nạp trước khi app khởi động (`--require`, `NODE_OPTIONS`, `--import`
   cho ESM, cách zero-code `--require @opentelemetry/auto-instrumentations-node/register`, vì sao
   `require('./tracing')` ở dòng đầu app dễ hỏng).
4. Bước 3: service name và resource attributes (bảng attribute, thứ tự ưu tiên, `defaultResource()`,
   `OTEL_RESOURCE_ATTRIBUTES`).
5. Bước 4: Express tự động trace (span nào được sinh ra, bỏ qua `/health`, tắt `dns`/`net`).
6. Bước 5: custom span, attributes, event, exception, status (API gốc qua `payment.charge`, helper
   `withSpan`, bảng kịch bản, khác biệt 4xx và 5xx).
7. Bước 6: truyền context (cấu trúc `traceparent`, HTTP tự động, Redis inject/extract, baggage, span cha
   hay span link, áp dụng cho các hàng đợi khác).
8. Bước 7: export tới Collector hoặc Jaeger (giải thích docker-compose, config Collector, hai chế độ,
   đổi sang gRPC, tên `otlp_grpc` / `otlp_http` mới).
9. Output mẫu: log terminal, cây span trong Jaeger, output của `verify`.
10. Lưu ý production: sampling (head và tail), batch, shutdown, PII và baggage, số lượng tên span khác nhau,
    `OTEL_SDK_DISABLED`, pin phiên bản, Collector dạng agent / gateway.
11. Xử lý sự cố: không thấy trace, `OTEL_LOG_LEVEL=debug`, sai thứ tự nạp, cổng bị chiếm, ESM.
12. Tham khảo.

---

## 8. Rủi ro và điểm cần kiểm chứng khi code

| Điểm | Cách xử lý |
|---|---|
| Jaeger 2.21 còn giữ API JSON `/api/traces/{id}` hay không | Kiểm tra khi code. Nếu đã đổi thì dùng `/api/v3/traces/{id}` |
| Express 5: tên span và span nào đang active trong route handler | Kiểm tra trong Jaeger rồi chỉnh sơ đồ ở README theo thực tế |
| Collector 0.161 dùng `otlp_grpc` | Đã dùng tên mới. README nhắc vì đa số tutorial cũ vẫn dùng `otlp` / `otlphttp` |
| Ctrl+C trên Windows qua `concurrently` có thể không kịp flush span cuối | README ghi chú: chờ vài giây trước khi dừng, hoặc chạy từng service riêng |
| `.idea/` của người dùng trong thư mục | Không commit, không sửa |
