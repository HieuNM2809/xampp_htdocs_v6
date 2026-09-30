# OpenTelemetry Tracing với Node.js

Ví dụ chạy được về **distributed tracing** với OpenTelemetry cho Node.js. Ba service nhỏ gọi nhau qua
HTTP và qua hàng đợi Redis; mọi span được gom về **OTel Collector** rồi hiển thị trên **Jaeger**.
README đi lần lượt từng bước: cài package, file khởi tạo tracing, resource attributes, Express, custom
span và ghi lỗi, truyền context giữa các service, export trace.

```
client ─► api-gateway :3000 ──HTTP──► order-service :3001 ──Redis list──► notification-worker
                    traceparent tự đi theo    tự inject context          tự extract context
                    header, không cần code    vào message                từ message

          cả 3 service ── OTLP/HTTP :4318 ──► OTel Collector ──► Jaeger (UI :16686)
          (chế độ gửi thẳng: OTLP/HTTP :14318 ──► Jaeger)
```

Cần có: **Node.js >= 22** và **Docker** (Docker Desktop trên Windows / macOS).

---

## Mục lục

1. [Chạy nhanh](#1-chạy-nhanh)
2. [Kiến trúc ví dụ](#2-kiến-trúc-ví-dụ)
3. [Bước 1: Cài package](#3-bước-1-cài-package)
4. [Bước 2: File khởi tạo tracing và cách nạp trước khi app chạy](#4-bước-2-file-khởi-tạo-tracing-và-cách-nạp-trước-khi-app-chạy)
5. [Bước 3: Service name và resource attributes](#5-bước-3-service-name-và-resource-attributes)
6. [Bước 4: Express, tự động trace HTTP request](#6-bước-4-express-tự-động-trace-http-request)
7. [Bước 5: Custom span, attributes, event, exception, status](#7-bước-5-custom-span-attributes-event-exception-status)
8. [Bước 6: Truyền context giữa các service](#8-bước-6-truyền-context-giữa-các-service)
9. [Bước 7: Export tới OTel Collector hoặc Jaeger](#9-bước-7-export-tới-otel-collector-hoặc-jaeger)
10. [Cấu trúc thư mục](#10-cấu-trúc-thư-mục)
11. [Output mẫu](#11-output-mẫu)
12. [Kiểm thử](#12-kiểm-thử)
13. [Lưu ý khi đưa lên production](#13-lưu-ý-khi-đưa-lên-production)
14. [Xử lý sự cố](#14-xử-lý-sự-cố)
15. [Tham khảo](#tham-khảo)

---

## 1. Chạy nhanh

```bash
npm install
npm run infra:up      # docker compose up -d: Collector + Jaeger + Redis
npm start             # terminal 1: chạy cả 3 service, log gộp có màu
npm run demo          # terminal 2: gửi 3 kịch bản, in link Jaeger cho từng trace
```

Mở **http://localhost:16686**, chọn service `api-gateway`, bấm **Find Traces**. Hoặc bấm thẳng vào link
mà `npm run demo` in ra.

Kiểm tra toàn bộ luồng một cách tự động (34 check, đọc trace thật từ API của Jaeger):

```bash
npm run verify
```

Dừng: `Ctrl+C` ở terminal 1, rồi `npm run infra:down`.

| Cổng | Thành phần |
|---|---|
| 3000 | `api-gateway` |
| 3001 | `order-service` |
| 4317 / 4318 | OTel Collector, nhận OTLP gRPC / OTLP HTTP |
| 14318 | OTLP HTTP của Jaeger, chỉ dùng cho chế độ gửi thẳng |
| 16686 | Jaeger UI và API |
| 16379 | Redis |

> Redis map ra **16379** thay vì 6379, vì máy dev thường đã có một Redis khác chạy ở 6379.

---

## 2. Kiến trúc ví dụ

| Thành phần | Chạy ở | Vai trò | Minh hoạ phần nào của OTel |
|---|---|---|---|
| `api-gateway` (Express) | Node, trên máy | Nhận `POST /orders`, gọi order-service bằng `fetch` | Auto-instrument HTTP server và client, `traceparent` tự truyền, bỏ qua `/health`, gắn baggage `customer.tier` |
| `order-service` (Express) | Node, trên máy | Validate → giữ hàng → thanh toán → đẩy event vào Redis | Custom span + attributes, ghi exception + status ERROR, đọc baggage, **inject** context vào message |
| `notification-worker` | Node, trên máy | `BRPOP` từ Redis, mô phỏng gửi email | **Extract** context, span CONSUMER nối tiếp đúng trace |
| `otel-collector` | Docker | Nhận OTLP, chuyển tiếp tới Jaeger | Pipeline receiver → processor → exporter |
| `jaeger` | Docker | Lưu trace trong bộ nhớ, hiển thị UI | Backend để xem trace |
| `redis` | Docker | Hàng đợi `order-events` | Kênh mà instrumentation không truyền context hộ |

Ba kịch bản mà `npm run demo` và `npm run verify` gửi tới gateway:

| Kịch bản | Request | HTTP | Span ERROR | Ghi chú |
|---|---|---|---|---|
| `success` | `customerId: "VIP-001"`, 2 x `SERUM-01` + 1 x `MASK-03`, `paymentMethod: "card"` | 201 | Không có | Tổng 820.000đ, trace đi qua cả 3 service |
| `payment-failed` | `customerId: "C-002"`, `paymentMethod: "expired_card"` | 502 | `payment.charge` (kèm exception) và mọi HTTP span của 2 service | Không có span `send order-events` |
| `invalid` | `customerId: "C-003"`, `items: []` | 400 | `order.validate` và span CLIENT ở gateway | Span SERVER của cả 2 service **không** ERROR, vì 4xx là lỗi phía client |

Cây span **thật** của đơn thành công, lấy từ Jaeger (in ra ở cuối `npm run verify`):

```
api-gateway          POST /orders                            SERVER
api-gateway          ├─ middleware - jsonParser              INTERNAL
api-gateway          └─ request handler - /orders            INTERNAL
api-gateway             └─ POST                              CLIENT
order-service              └─ POST /orders                   SERVER
order-service                 ├─ middleware - jsonParser     INTERNAL
order-service                 └─ request handler - /orders   INTERNAL
order-service                    ├─ order.validate           INTERNAL
order-service                    ├─ inventory.reserve        INTERNAL
order-service                    ├─ payment.charge           INTERNAL
order-service                    └─ send order-events        PRODUCER
order-service                       ├─ lpush                 CLIENT
notification-worker                 └─ process order-events  CONSUMER
notification-worker                    └─ email.send         INTERNAL
```

Một request, một trace, 14 span, 3 service. Đó là toàn bộ ý nghĩa của distributed tracing: nhìn một
cây là biết request đã đi qua đâu, chờ ở đâu, và hỏng ở đâu.

---

## 3. Bước 1: Cài package

```bash
npm install @opentelemetry/sdk-node@^0.222.0 @opentelemetry/auto-instrumentations-node@^0.80.0 @opentelemetry/exporter-trace-otlp-proto@^0.222.0 @opentelemetry/api@^1.9.1 @opentelemetry/resources@^2.11.0 @opentelemetry/semantic-conventions@^1.43.0 express@^5.2.1 ioredis@^6.0.0
npm install -D cross-env@^10.1.0 concurrently@^10.0.5 @opentelemetry/sdk-trace@^2.11.0 @opentelemetry/context-async-hooks@^2.11.0 @opentelemetry/core@^2.11.0
```

Trong repo này chỉ cần `npm install`, vì `package.json` và `package-lock.json` đã có sẵn.

| Package | Để làm gì |
|---|---|
| `@opentelemetry/sdk-node` | Gom toàn bộ SDK vào class `NodeSDK`: tracer provider, context manager (AsyncLocalStorage), propagator W3C, đọc các biến `OTEL_*` |
| `@opentelemetry/auto-instrumentations-node` | Gói sẵn các instrumentation: `http`, `express`, `undici` (hàm `fetch`), `ioredis`, `pg`, `mysql2`... |
| `@opentelemetry/exporter-trace-otlp-proto` | Gửi span theo OTLP/HTTP + protobuf, cổng 4318 |
| `@opentelemetry/api` | API mà code của bạn gọi: `trace`, `context`, `propagation`, `SpanStatusCode`... |
| `@opentelemetry/resources` | `resourceFromAttributes`, `defaultResource` để khai báo resource |
| `@opentelemetry/semantic-conventions` | Hằng số tên attribute chuẩn, ví dụ `ATTR_SERVICE_NAME` |
| `express`, `ioredis` | Ứng dụng |
| `cross-env`, `concurrently` (dev) | npm script đặt được biến môi trường và chạy 3 service cùng lúc, trên cả Windows lẫn Linux |
| `@opentelemetry/sdk-trace`, `@opentelemetry/context-async-hooks`, `@opentelemetry/core` (dev) | Chỉ dùng trong unit test (mục 12) |

Hai lưu ý:

- **Chỉ được có một bản `@opentelemetry/api`.** Mỗi bản giữ một "global" riêng; có hai bản thì span của
  thư viện và span của bạn không nối được với nhau. Kiểm tra bằng `npm ls @opentelemetry/api`: chỉ một
  dòng có version, các dòng còn lại là `deduped`.
- Các package `0.x` (sdk-node, exporter, auto-instrumentations) vẫn là experimental, có thể đổi API giữa
  các bản minor. `^0.222.0` chỉ nhận 0.222.x, nên giữ nguyên kiểu pin này.

---

## 4. Bước 2: File khởi tạo tracing và cách nạp trước khi app chạy

Toàn bộ cấu hình OpenTelemetry nằm trong một file dùng chung cho cả 3 service:
[`src/tracing.js`](src/tracing.js).

```js
'use strict';

/**
 * BƯỚC 2 + 3: khởi tạo OpenTelemetry SDK, dùng chung cho MỌI service trong ví dụ.
 *
 * File này phải chạy TRƯỚC mọi module khác của app, nên được nạp bằng cờ --require:
 *
 *   node --require ./src/tracing.js src/order-service/server.js
 *
 * Lý do: auto-instrumentation "vá" (monkey-patch) các module như http, express, ioredis
 * ngay lúc chúng được require lần đầu. Module nào đã được require trước khi sdk.start()
 * chạy thì sẽ không được vá, và sẽ không sinh span.
 */

const { randomUUID } = require('node:crypto');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { defaultResource, resourceFromAttributes } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} = require('@opentelemetry/semantic-conventions');

const pkg = require('../package.json');

// Mặc định SDK im lặng khi gửi trace thất bại (ví dụ quên `npm run infra:up`).
// Bật mức WARN để thấy lỗi. Muốn xem chi tiết hơn thì đặt OTEL_LOG_LEVEL=debug, khi đó
// NodeSDK tự cấu hình logger theo biến này.
if (!process.env.OTEL_LOG_LEVEL) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
}

const serviceName = process.env.OTEL_SERVICE_NAME || 'unknown-service';

// BƯỚC 3: resource là "danh tính" của service, được gắn vào MỌI span service này gửi đi.
// Phải merge với defaultResource(), nếu không sẽ mất các attribute telemetry.sdk.*.
// Đây chỉ là giá trị mặc định. NodeSDK merge resource do detector phát hiện (đọc
// OTEL_SERVICE_NAME, OTEL_RESOURCE_ATTRIBUTES...) SAU resource này, nên biến môi trường thắng.
const resource = defaultResource().merge(
  resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: pkg.version,
    [ATTR_SERVICE_NAMESPACE]: 'shop',
    [ATTR_SERVICE_INSTANCE_ID]: randomUUID(),
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || 'development',
  })
);

const sdk = new NodeSDK({
  resource,
  // Không truyền url: exporter tự đọc OTEL_EXPORTER_OTLP_ENDPOINT (mặc định http://localhost:4318)
  // rồi nối thêm /v1/traces. NodeSDK bọc exporter trong BatchSpanProcessor: span được gom lại và
  // gửi theo lô, mặc định khoảng 5 giây một lần (chỉnh bằng OTEL_BSP_SCHEDULE_DELAY).
  traceExporter: new OTLPTraceExporter(),
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        // /health bị gọi liên tục (load balancer, k8s probe) nên chỉ tạo nhiễu.
        ignoreIncomingRequestHook: (req) => (req.url || '').split('?')[0] === '/health',
      },
      // dns.lookup / tcp.connect sinh rất nhiều span nhỏ mà không giúp đọc trace.
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      // Express 5 chạy trên package `router`. Bật cả instrumentation-express lẫn
      // instrumentation-router thì mỗi middleware/route bị tạo span 2 lần (thấy span
      // "middleware - patched"). Chỉ giữ instrumentation-express.
      '@opentelemetry/instrumentation-router': { enabled: false },
    }),
  ],
});

sdk.start();

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
console.log(`[otel] tracing đã bật: service=${serviceName} export=${endpoint}`);

// Tắt êm: flush các span còn nằm trong buffer của BatchSpanProcessor trước khi thoát.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await sdk.shutdown();
    console.log(`[otel] ${signal}: đã flush span và tắt SDK`);
  } catch (err) {
    console.error(`[otel] ${signal}: lỗi khi tắt SDK: ${err.message}`);
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { sdk };
```

### Vì sao phải nạp TRƯỚC app

Auto-instrumentation hoạt động bằng cách **vá (monkey-patch)** module ngay lúc module đó được `require`
lần đầu: thay `http.request`, `Layer.handle` của Express, các lệnh của ioredis... bằng phiên bản có tạo
span. Module nào đã được require trước khi `sdk.start()` chạy thì đã nằm trong cache, không bị vá nữa,
và âm thầm không sinh span. Một số instrumentation có in cảnh báo, ví dụ khi `require('express')` chạy
trước `tracing.js`:

```
@opentelemetry/instrumentation-express Module express has been loaded before @opentelemetry/instrumentation-express so it might not work, please initialize it before requiring express
```

### Các cách nạp

**1. Cờ `--require`.** Đây là cách ví dụ này dùng (xem `scripts` trong `package.json`):

```bash
node --require ./src/tracing.js src/order-service/server.js
```

**2. Biến `NODE_OPTIONS`**, khi không sửa được lệnh start (dùng `pm2`, `nodemon`, image Docker có sẵn
`CMD`...):

```bash
# Bash
NODE_OPTIONS="--require ./src/tracing.js" node app.js
```

```powershell
# PowerShell
$env:NODE_OPTIONS="--require ./src/tracing.js"; node app.js
```

**3. App ESM** (`"type": "module"` hoặc file `.mjs`). Theo tài liệu esm-support của OpenTelemetry JS,
phải thêm loader hook thì mới vá được các lệnh `import`:

```bash
node --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./telemetry.mjs app.mjs
```

**4. Zero-code**: không viết file nào, cấu hình hoàn toàn bằng biến môi trường.

```bash
OTEL_SERVICE_NAME=order-service \
OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4318 \
node --require @opentelemetry/auto-instrumentations-node/register app.js

# bản ESM
node --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import @opentelemetry/auto-instrumentations-node/register app.mjs
```

Cách này nhanh nhất để thử, nhưng không cấu hình được từng instrumentation (`ignoreIncomingRequestHook`,
tắt `router`...). Khi cần những thứ đó thì viết file như `src/tracing.js`.

### Vì sao không đặt `require('./tracing')` ở dòng đầu app

Cách đó chạy được, nhưng rất dễ hỏng mà không ai hay:

- Ai đó thêm một dòng `require` lên trên (hoặc IDE tự sắp xếp import), module đó không còn được vá.
  Không có lỗi nào.
- Với ESM, hoặc TypeScript biên dịch ra ESM, mọi `import` được hoist và chạy trước code trong file.
  Thứ tự dòng trong file không còn là thứ tự chạy.

`--require` / `--import` bảo đảm tracing chạy trước tất cả, bất kể code app viết thế nào.

### Tắt êm (graceful shutdown)

`BatchSpanProcessor` giữ span trong bộ nhớ và gửi theo lô khoảng 5 giây một lần. Tiến trình thoát ngang
thì lô cuối mất. `tracing.js` bắt `SIGINT` / `SIGTERM`, gọi `sdk.shutdown()` để flush rồi mới
`process.exit(0)`. Kubernetes gửi `SIGTERM` trước khi kill pod, nên đoạn này quan trọng trên production.

---

## 5. Bước 3: Service name và resource attributes

**Resource** là "danh tính" của tiến trình gửi span: service nào, phiên bản nào, môi trường nào, chạy
trên máy nào. Nó được gắn vào **mọi** span tiến trình gửi đi; nhờ vậy Jaeger biết span thuộc service nào.

```js
// BƯỚC 3: resource là "danh tính" của service, được gắn vào MỌI span service này gửi đi.
// Phải merge với defaultResource(), nếu không sẽ mất các attribute telemetry.sdk.*.
// Đây chỉ là giá trị mặc định. NodeSDK merge resource do detector phát hiện (đọc
// OTEL_SERVICE_NAME, OTEL_RESOURCE_ATTRIBUTES...) SAU resource này, nên biến môi trường thắng.
const resource = defaultResource().merge(
  resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: pkg.version,
    [ATTR_SERVICE_NAMESPACE]: 'shop',
    [ATTR_SERVICE_INSTANCE_ID]: randomUUID(),
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || 'development',
  })
);
```

| Attribute | Giá trị trong ví dụ | Ý nghĩa |
|---|---|---|
| `service.name` | `api-gateway`, `order-service`, `notification-worker` (từ `OTEL_SERVICE_NAME` trong npm script) | **Bắt buộc**. Chính là "Service" trong ô chọn của Jaeger |
| `service.version` | `1.0.0`, lấy từ `package.json` | So sánh trước / sau khi deploy |
| `service.namespace` | `shop` | Gom các service cùng một hệ thống |
| `service.instance.id` | UUID ngẫu nhiên mỗi lần chạy | Phân biệt các instance / pod của cùng một service |
| `deployment.environment.name` | `development`, lấy từ `NODE_ENV` | Tách dev / staging / production |

Cả 5 hằng số đều đã **stable** trong `@opentelemetry/semantic-conventions` 1.43 nên import thẳng từ
package. Attribute còn ở mức incubating thì nên chép thành hằng số trong code, như
[`src/shared/messaging.js`](src/shared/messaging.js), vì entry `/incubating` có thể đổi giữa các bản minor.

Ngoài ra, detector của SDK tự thêm `host.*`, `process.*` và `telemetry.sdk.*`. Đây là resource thật của
`order-service` mà Jaeger lưu (một số giá trị đã được che):

```
deployment.environment.name      "development"
host.arch                        "amd64"
host.id                          "<uuid của máy>"
host.name                        "<tên máy>"
process.command                  "<thư mục dự án>\\src\\order-service\\server.js"
process.command_args             ["C:\\Program Files\\nodejs\\node.exe","--require","./src/tracing.js", ...]
process.executable.path          "C:\\Program Files\\nodejs\\node.exe"
process.owner                    "<user>"
process.pid                      9688
process.runtime.description      "Node.js"
process.runtime.name             "nodejs"
process.runtime.version          "22.11.0"
service.instance.id              "22c77b42-42ea-49de-abe6-fec3fc3aa02d"
service.name                     "order-service"
service.namespace                "shop"
service.version                  "1.0.0"
telemetry.sdk.language           "nodejs"
telemetry.sdk.name               "opentelemetry"
telemetry.sdk.version            "2.11.0"
```

### Thứ tự ưu tiên: code < biến môi trường

NodeSDK merge resource theo thứ tự sau (đã kiểm tra trong source `sdk-node` 0.222):

```
resource trong code  <  resource do detector phát hiện  <  option serviceName của NodeSDK
                        (detector env đọc OTEL_SERVICE_NAME, OTEL_RESOURCE_ATTRIBUTES)
```

Nghĩa là giá trị trong code chỉ là **mặc định**; biến môi trường ghi đè được mà không phải sửa code. Vì
vậy ví dụ **không** dùng option `serviceName` (option này thắng cả biến môi trường).

```bash
# Bash
OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=staging,team.name=platform" npm run start:order
```

```powershell
# PowerShell
$env:OTEL_RESOURCE_ATTRIBUTES="deployment.environment.name=staging,team.name=platform"; npm run start:order
```

`npm run test:integration` chứng minh đúng điều này, xem
[`test/integration/tracing.test.js`](test/integration/tracing.test.js).

### Vì sao phải `defaultResource().merge(...)`

Khi tự truyền `resource` cho NodeSDK, cái bạn truyền **thay thế** resource mặc định. Không merge
`defaultResource()` thì mất `telemetry.sdk.language`, `telemetry.sdk.name`, `telemetry.sdk.version`,
những attribute mà nhiều backend dựa vào để hiển thị.

---

## 6. Bước 4: Express, tự động trace HTTP request

Toàn bộ code của gateway, [`src/api-gateway/server.js`](src/api-gateway/server.js). Để ý: **không có dòng
tracing nào cho HTTP**.

```js
'use strict';

const express = require('express');
const { createLogger } = require('../shared/logger');
const { withBaggage } = require('../shared/propagation');
const { currentTraceId, errorHandler } = require('../shared/http');

const log = createLogger('api-gateway');

/** Khách có mã bắt đầu bằng "VIP" thuộc hạng gold, còn lại là standard. */
function customerTierOf(customerId) {
  return typeof customerId === 'string' && customerId.startsWith('VIP') ? 'gold' : 'standard';
}

/** @param {{ orderServiceUrl?: string }} [options] */
function createApp({ orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:3001' } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/orders', async (req, res) => {
    const traceId = currentTraceId();
    const tier = customerTierOf(req.body?.customerId);
    let upstream;
    try {
      // KHÔNG cần tự gắn header traceparent: instrumentation undici (fetch) tự inject từ context
      // đang active. withBaggage chỉ thêm baggage customer.tier vào context đó.
      upstream = await withBaggage({ 'customer.tier': tier }, () =>
        fetch(`${orderServiceUrl}/orders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req.body ?? {}),
          signal: AbortSignal.timeout(5000),
        })
      );
    } catch (err) {
      const reason = err.cause?.code ? `${err.message} (${err.cause.code})` : err.message;
      log.error('không gọi được order-service', { reason });
      return res.status(503).json({ error: 'ORDER_SERVICE_UNAVAILABLE', message: reason, traceId });
    }
    const body = await upstream.json().catch(() => ({}));
    log.info('đã chuyển tiếp đơn', { status: upstream.status, tier });
    res.status(upstream.status).json({ ...body, traceId });
  });

  app.use(errorHandler(log));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => log.info(`đang nghe http://localhost:${port}`));
}

module.exports = { createApp, customerTierOf };
```

Chỉ nhờ `--require ./src/tracing.js`, mỗi request đã sinh ra các span sau:

| Span | Do đâu sinh ra | Kind |
|---|---|---|
| `POST /orders` | instrumentation `http` phía server. Tên có route nhờ instrumentation `express` báo lại route khớp | SERVER |
| `middleware - jsonParser` | instrumentation `express`, mỗi middleware một span | INTERNAL |
| `request handler - /orders` | instrumentation `express`, cho route handler | INTERNAL |
| `POST` | instrumentation `undici`, tức hàm `fetch` có sẵn của Node | CLIENT |
| `lpush` | instrumentation `ioredis` (ở order-service) | CLIENT |

Bên trong route handler, span đang active là `request handler - /orders`. Vì vậy mọi custom span tạo
trong handler tự nằm dưới span này (xem cây span ở mục 2).

### Cấu hình instrumentation trong `tracing.js`

- **`ignoreIncomingRequestHook`**: không trace `/health`. Load balancer và Kubernetes probe gọi nó liên
  tục, trace nó chỉ làm ngập Jaeger. `npm run verify` kiểm tra Jaeger không có operation `GET` nào của
  gateway.
- **Tắt `dns` và `net`**: mỗi request sinh thêm span `dns.lookup`, `tcp.connect` mà không giúp đọc trace.
  `fs` thì auto-instrumentations đã tắt sẵn.
- **Tắt `router`**: **Express 5 chạy trên package `router`**, còn auto-instrumentations bật cả
  `instrumentation-express` lẫn `instrumentation-router`. Kết quả là mỗi middleware / route bị tạo span
  **2 lần**, kèm một span tên `middleware - patched` (tên hàm bọc của instrumentation kia). Ví dụ này đã
  gặp đúng lỗi đó; `npm run verify` có check "span Express không bị lặp" để lỗi không quay lại.

Không muốn sửa code thì bật / tắt bằng biến môi trường. Tên instrumentation là tên package bỏ tiền tố
`@opentelemetry/instrumentation-`:

```bash
OTEL_NODE_DISABLED_INSTRUMENTATIONS="dns,net,router"
OTEL_NODE_ENABLED_INSTRUMENTATIONS="http,express,undici,ioredis"   # chỉ bật đúng những cái này
```

Phiên bản được hỗ trợ (xem README của từng instrumentation): `instrumentation-express` hỗ trợ express
`>=4 <6` (có Express 5), `instrumentation-ioredis` hỗ trợ ioredis `>=2 <7`.

---

## 7. Bước 5: Custom span, attributes, event, exception, status

Auto-instrumentation chỉ thấy I/O: HTTP, database, Redis. Logic nghiệp vụ như "kiểm tra đơn" hay
"thanh toán" thì phải tự tạo span.

### API gốc, viết tay

`payment.charge` trong [`src/order-service/steps.js`](src/order-service/steps.js) được cố ý viết tay,
không qua helper, để thấy đủ các bước:

```js
/**
 * Bước 3: thanh toán. CỐ Ý viết tay bằng API gốc, không qua withSpan(), để thấy đủ các bước:
 * startActiveSpan → setAttribute → (khi lỗi) recordException + error.type + setStatus → end().
 */
function chargePayment({ method, amount }) {
  return tracer.startActiveSpan(
    'payment.charge',
    { attributes: { 'payment.method': method, 'payment.amount': amount } },
    async (span) => {
      try {
        await simulateLatency();
        if (method === 'expired_card') {
          throw new PaymentError('Thẻ đã hết hạn', 'CARD_EXPIRED');
        }
        const transactionId = `TXN-${randomUUID().slice(0, 8).toUpperCase()}`;
        span.setAttribute('payment.transaction_id', transactionId);
        return { transactionId };
      } catch (err) {
        span.recordException(err); // event "exception": exception.type / message / stacktrace
        span.setAttribute(ATTR_ERROR_TYPE, err.code || err.name); // error.type = CARD_EXPIRED
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message }); // span hiện đỏ trong Jaeger
        throw err;
      } finally {
        span.end(); // quên end() thì span không bao giờ được export
      }
    }
  );
}
```

### Helper `withSpan`

Viết tay như trên cho mọi span thì dài và dễ quên `end()`. Các span còn lại dùng helper
[`src/shared/tracer.js`](src/shared/tracer.js):

```js
'use strict';

const { trace, context, SpanStatusCode } = require('@opentelemetry/api');
const { ATTR_ERROR_TYPE } = require('@opentelemetry/semantic-conventions');
const pkg = require('../../package.json');

/**
 * Tracer dùng chung cho code của ứng dụng. Tên và version ở đây hiện trong Jaeger dưới dạng
 * otel.scope.name / otel.scope.version, giúp phân biệt span "tự viết" với span do thư viện
 * instrumentation sinh ra.
 */
const tracer = trace.getTracer('otel-tracing-demo', pkg.version);

/**
 * Đánh dấu span là lỗi theo 3 bước OpenTelemetry khuyến nghị:
 *  1. recordException: thêm event "exception" (exception.type, exception.message, exception.stacktrace)
 *  2. error.type: phân loại lỗi, ít giá trị khác nhau, dùng để lọc và thống kê
 *  3. setStatus(ERROR): span hiện màu đỏ trong Jaeger
 */
function markSpanError(span, err) {
  const error = err instanceof Error ? err : new Error(String(err));
  span.recordException(error);
  span.setAttribute(ATTR_ERROR_TYPE, String(error.code || error.name));
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}

/**
 * Chạy `fn` bên trong một span mới và lo phần lặp lại:
 *  - span được đặt làm span active, nên span con (kể cả span tự động của ioredis, http...)
 *    tự lồng vào đúng chỗ
 *  - có lỗi: markSpanError rồi ném tiếp, để code gọi tự quyết định xử lý
 *  - span LUÔN được end() trong finally, kể cả khi lỗi
 *  - thành công: để status UNSET, không đặt OK (theo khuyến nghị của spec OpenTelemetry)
 *
 * @param {string} name tên span. Nên ít giá trị khác nhau, không nhét id vào tên.
 * @param {import('@opentelemetry/api').SpanOptions} options kind, attributes, links...
 * @param {(span: import('@opentelemetry/api').Span) => any} fn
 * @param {import('@opentelemetry/api').Context} [parentContext] mặc định là context đang active
 */
function withSpan(name, options, fn, parentContext = context.active()) {
  return tracer.startActiveSpan(name, options, parentContext, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      markSpanError(span, err);
      throw err;
    } finally {
      span.end();
    }
  });
}

module.exports = { tracer, withSpan, markSpanError };
```

Dùng helper, kèm một span event cho mỗi dòng hàng:

```js
/** Bước 2: giữ hàng. Chỉ mô phỏng, không trừ tồn kho thật. Mỗi dòng hàng ghi một span event. */
function reserveInventory(lines) {
  return withSpan('inventory.reserve', { attributes: { 'order.line_count': lines.length } }, async (span) => {
    await simulateLatency();
    for (const line of lines) {
      // Event là một mốc thời gian bên trong span, nhẹ hơn nhiều so với tạo span con.
      span.addEvent('stock.reserved', { sku: line.sku, qty: line.qty });
    }
  });
}
```

### Những điều cần nhớ

- **Dùng `startActiveSpan`, không dùng `startSpan`.** `startActiveSpan` đặt span làm span *active* trong
  lúc chạy callback, nên span con (kể cả `lpush` của ioredis) tự lồng vào. `startSpan` chỉ tạo span,
  không đổi context, nên span con sẽ không nhận nó làm cha.
- **Attribute khác event.** Attribute là dữ liệu của cả span (`payment.method`, `order.item_count`), dùng
  để lọc và tìm kiếm. Event là **mốc thời gian** bên trong span (`stock.reserved` cho từng dòng hàng),
  rẻ hơn nhiều so với tạo span con.
- **Ghi lỗi gồm 3 bước**:
  1. `span.recordException(err)`: thêm event `exception` với `exception.type`, `exception.message`,
     `exception.stacktrace`.
  2. `span.setAttribute('error.type', ...)`: mã lỗi ít giá trị khác nhau, dùng để thống kê.
  3. `span.setStatus({ code: SpanStatusCode.ERROR, message })`: span hiện màu đỏ trong Jaeger.

  Chỉ gọi `recordException` thì span **không** đỏ. Chỉ gọi `setStatus` thì mất stacktrace.
- **SDK lấy `exception.type` từ `err.code` nếu có**, không có mới lấy `err.name` (đã xem trong source
  `sdk-trace` 2.11). Vì vậy các lớp lỗi ở [`src/order-service/errors.js`](src/order-service/errors.js)
  mang `code` ổn định như `CARD_EXPIRED`, `VALIDATION_ERROR`.
- **Luôn `end()` trong `finally`.** Span chưa `end()` không bao giờ được export.
- **Thành công thì để status UNSET**, không cần `setStatus(OK)`. OK dành cho lúc muốn ghi đè quyết định
  của instrumentation.
- **Tên span nên ít giá trị khác nhau**: `payment.charge`, không phải `charge ORD-123`. Id để trong
  attribute. Tên span dùng để gom nhóm và thống kê độ trễ; mỗi đơn một tên thì không gom được gì.

### Lỗi 4xx và 5xx khác nhau thế nào

Theo semantic conventions cho HTTP:

- Span **SERVER**: chỉ ERROR khi status là **5xx**. 4xx là lỗi của client; server vẫn làm đúng việc của
  mình.
- Span **CLIENT**: ERROR khi status **>= 400**. Với bên gọi, request đã không thành công.

Kết quả ở 3 kịch bản (`npm run verify` kiểm tra đúng từng dòng này):

| Kịch bản | HTTP | Span ERROR |
|---|---|---|
| `success` | 201 | Không có |
| `payment-failed` | 502 | `payment.charge` (kèm exception), `POST /orders` SERVER ở cả 2 service, `POST` CLIENT ở gateway |
| `invalid` | 400 | `order.validate` (kèm exception) và `POST` CLIENT ở gateway. `POST /orders` SERVER ở cả 2 service **không** đỏ |

### Vì sao lỗi nghiệp vụ được trả response ngay trong handler

Trong [`src/order-service/server.js`](src/order-service/server.js), `ValidationError` và `PaymentError`
được bắt và trả response ngay trong route. Chỉ lỗi bất ngờ mới đi qua `next(err)` tới error middleware
(trả 500). Lý do: instrumentation express đánh ERROR cho span `request handler` **mỗi khi lỗi đi qua
`next(err)`**, kể cả lỗi 400. Cho lỗi nghiệp vụ đi đường đó thì trace của một đơn sai dữ liệu cũng đỏ,
khó phân biệt với sự cố thật.

---

## 8. Bước 6: Truyền context giữa các service

### `traceparent` là gì

Muốn span ở service B nhận span ở service A làm cha, B phải biết trace id và span id của A. OpenTelemetry
mặc định dùng chuẩn **W3C Trace Context**: một header tên `traceparent`. Ví dụ thật, lấy từ một message
trong Redis:

```
traceparent: 00-0b140d298988f5cb51858da61109b792-5565ddb53a770118-01
             │  │                                │                └─ flags: 01 = sampled (được ghi lại)
             │  │                                └─ parent-id: span id của span cha (16 hex)
             │  └─ trace-id: id của cả trace (32 hex)
             └─ version
```

Đi kèm là header `baggage` (chuẩn W3C Baggage), chở dữ liệu nghiệp vụ dạng `key=value`. NodeSDK mặc định
bật cả hai propagator; đổi được bằng biến `OTEL_PROPAGATORS` (ví dụ `tracecontext,baggage,b3`).

### Qua HTTP: tự động

- Phía gọi: instrumentation `undici` **inject** `traceparent` (và `baggage`) vào mọi request của `fetch`.
- Phía nhận: instrumentation `http` **extract** header đó; span SERVER nhận span CLIENT làm cha.

Không phải viết dòng nào. Gateway chỉ gọi `fetch` như bình thường (mục 6).

### Qua Redis: phải tự làm

Instrumentation `ioredis` chỉ tạo span cho lệnh `LPUSH`. Nó **không** biết nội dung message là gì, nên
không thể nhét context vào đó. Ta tự làm, bằng các hàm trong
[`src/shared/propagation.js`](src/shared/propagation.js):

```js
'use strict';

const { context, propagation, ROOT_CONTEXT } = require('@opentelemetry/api');

/**
 * Ghi trace context (và baggage) của context đang active vào `carrier`.
 * Với propagator mặc định của NodeSDK (W3C Trace Context + W3C Baggage), carrier sẽ có:
 *   traceparent: 00-<trace-id 32 hex>-<span-id 16 hex>-<flags>
 *   baggage:     customer.tier=gold            (nếu context có baggage)
 * HTTP client đã được instrument thì làm việc này TỰ ĐỘNG. Chỉ cần tự gọi khi dữ liệu đi qua
 * kênh mà instrumentation không biết, ví dụ nội dung message trong Redis list.
 */
function injectContext(carrier = {}) {
  propagation.inject(context.active(), carrier);
  return carrier;
}

/**
 * Chiều ngược lại: dựng Context từ carrier. Dùng ROOT_CONTEXT làm gốc để không vô tình thừa
 * hưởng span đang active ở phía consumer.
 * Carrier rỗng hoặc sai định dạng thì không có span cha: span tạo từ đó mở một trace mới.
 */
function extractContext(carrier) {
  return propagation.extract(ROOT_CONTEXT, carrier || {});
}

/**
 * Chạy `fn` trong context có thêm baggage (giữ lại baggage đã có từ upstream).
 * Mọi request hoặc message được inject bên trong `fn` sẽ mang header `baggage`.
 * @param {Record<string, string>} entries
 */
function withBaggage(entries, fn) {
  let baggage = propagation.getBaggage(context.active()) || propagation.createBaggage();
  for (const [key, value] of Object.entries(entries)) {
    baggage = baggage.setEntry(key, { value: String(value) });
  }
  return context.with(propagation.setBaggage(context.active(), baggage), fn);
}

/** Đọc một giá trị baggage. Không có thì trả undefined. */
function getBaggageValue(key, ctx = context.active()) {
  return propagation.getBaggage(ctx)?.getEntry(key)?.value;
}

module.exports = { injectContext, extractContext, withBaggage, getBaggageValue };
```

Phía producer, trong [`src/order-service/steps.js`](src/order-service/steps.js):

```js
/**
 * Bước 4: đẩy event "order.created" vào Redis list. Instrumentation ioredis chỉ tạo span cho
 * lệnh LPUSH, KHÔNG truyền context qua nội dung message, nên phải tự inject vào `headers`.
 * @param {{ lpush(key: string, value: string): Promise<number> }} redis
 * @param {{ orderId: string, customerId: string, total: number, itemCount: number }} payload
 */
function publishOrderCreated(redis, payload) {
  const messageId = `msg-${randomUUID()}`;
  return withSpan(
    `send ${QUEUE_NAME}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: {
        [ATTR_MESSAGING_SYSTEM]: 'redis',
        [ATTR_MESSAGING_DESTINATION_NAME]: QUEUE_NAME,
        [ATTR_MESSAGING_OPERATION_TYPE]: 'send',
        [ATTR_MESSAGING_OPERATION_NAME]: 'send',
        [ATTR_MESSAGING_MESSAGE_ID]: messageId,
      },
    },
    async () => {
      const message = {
        id: messageId,
        type: 'order.created',
        payload,
        // Inject BÊN TRONG span PRODUCER: traceparent trỏ tới span này, nên span CONSUMER
        // ở worker sẽ là con của nó.
        headers: injectContext({}),
        publishedAt: new Date().toISOString(),
      };
      await redis.lpush(QUEUE_NAME, JSON.stringify(message));
      return message;
    }
  );
}
```

Message thật nằm trong Redis list `order-events`:

```json
{
  "id": "msg-b7f10c6e-da06-481e-b2e6-26e1e552360c",
  "type": "order.created",
  "payload": {
    "orderId": "ORD-1790760227173",
    "customerId": "VIP-001",
    "total": 820000,
    "itemCount": 2
  },
  "headers": {
    "traceparent": "00-0b140d298988f5cb51858da61109b792-5565ddb53a770118-01",
    "baggage": "customer.tier=gold"
  },
  "publishedAt": "2026-09-30T09:23:47.173Z"
}
```

Phía consumer, trong [`src/notification-worker/worker.js`](src/notification-worker/worker.js):

```js
/**
 * Xử lý một message lấy từ Redis. Tách khỏi vòng lặp để unit test gọi trực tiếp.
 * @param {string} raw nội dung message (JSON)
 * @returns {Promise<boolean>} false nếu message hỏng (đã log và bỏ qua)
 */
async function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch (err) {
    log.error('bỏ qua message không phải JSON', { reason: err.message });
    return false;
  }

  // Dựng lại context của producer từ headers. Span CONSUMER tạo từ context này là con của span
  // PRODUCER bên order-service, nên cả luồng hiện thành MỘT trace trong Jaeger.
  const parentContext = extractContext(message?.headers);
  const tier = getBaggageValue('customer.tier', parentContext) || 'unknown';

  await withSpan(
    `process ${QUEUE_NAME}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        [ATTR_MESSAGING_SYSTEM]: 'redis',
        [ATTR_MESSAGING_DESTINATION_NAME]: QUEUE_NAME,
        [ATTR_MESSAGING_OPERATION_TYPE]: 'process',
        [ATTR_MESSAGING_OPERATION_NAME]: 'process',
        [ATTR_MESSAGING_MESSAGE_ID]: String(message?.id ?? ''),
        'customer.tier': tier,
        'notification.priority': tier === 'gold' ? 'high' : 'normal',
      },
    },
    async () => {
      await withSpan(
        'email.send',
        { attributes: { 'notification.channel': 'email', 'notification.template': 'order-confirmation' } },
        () => sleep(30 + Math.floor(Math.random() * 50)) // giả lập gọi dịch vụ gửi email
      );
      log.info('đã gửi email xác nhận', { orderId: message?.payload?.orderId, tier });
    },
    parentContext
  );
  return true;
}
```

Hai điểm dễ sai:

- `injectContext` phải được gọi **bên trong** span PRODUCER, để `traceparent` trỏ tới span đó. Gọi bên
  ngoài thì span CONSUMER nhận nhầm cha.
- `extractContext` dựng context từ `ROOT_CONTEXT`, không từ context đang active, để consumer không vô
  tình dính vào một trace khác đang chạy trong tiến trình.

Vòng lặp `BRPOP` của worker chạy khi chưa có span nào active. Instrumentation `ioredis` mặc định chỉ tạo
span khi có span cha (`requireParentSpan: true`), nên lệnh chờ message không sinh ra span rác mỗi 5 giây.

### Baggage

Gateway gắn `customer.tier` bằng `withBaggage` (khách có mã bắt đầu bằng `VIP` là `gold`). Giá trị này
đi qua HTTP sang order-service, rồi theo `headers` của message sang worker. Worker dùng nó để quyết định
`notification.priority`.

Cần nhớ:

- Baggage **không tự thành attribute** của span. Muốn thấy trong Jaeger thì phải tự `setAttribute`, như
  `customer.tier` trên `order.validate` và `process order-events`.
- Baggage đi dạng **plain text** trong header, tới mọi service phía sau, kể cả dịch vụ bên thứ ba nếu bạn
  gọi ra ngoài. Không đưa email, số điện thoại, token vào baggage.
- Giữ baggage nhỏ: nó được gửi kèm **mọi** request phía sau.

### Span cha hay span link

Ví dụ này xử lý từng message một, nên span CONSUMER lấy context của producer làm **cha**, và cả luồng
hiện thành một trace liền mạch. Nếu consumer xử lý **theo lô** (một lần lấy 100 message từ 100 đơn khác
nhau), một span không thể có 100 cha. Khi đó mở một span cho cả lô và gắn context lấy từ từng message
vào `links` (minh hoạ):

```js
const links = messages
  .map((m) => trace.getSpanContext(extractContext(m.headers)))
  .filter(Boolean)
  .map((spanContext) => ({ context: spanContext }));
await withSpan('process order-events', { kind: SpanKind.CONSUMER, links }, handleBatch);
```

### Áp dụng cho hàng đợi khác

Cách inject / extract trên dùng y hệt cho mọi kênh mà instrumentation không truyền hộ: beanstalkd, SQS,
Redis Streams, bảng outbox trong database, job cron đọc việc từ DB... Một số thư viện đã có
instrumentation tự truyền context qua header của message, ví dụ `kafkajs` (Kafka) và `amqplib`
(RabbitMQ); khi đó không cần tự làm.

---

## 9. Bước 7: Export tới OTel Collector hoặc Jaeger

### `docker-compose.yml`

```yaml
# Hạ tầng cho ví dụ: OTel Collector + Jaeger + Redis.
# 3 service Node chạy trên máy (npm start) và gửi trace tới Collector ở localhost:4318.
name: otel-tracing-demo

services:
  otel-collector:
    image: otel/opentelemetry-collector-contrib:0.161.0
    volumes:
      - ./otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro
    ports:
      - "4317:4317"   # OTLP gRPC
      - "4318:4318"   # OTLP HTTP (app gửi vào cổng này)
    depends_on:
      - jaeger

  jaeger:
    image: jaegertracing/jaeger:2.21.0
    ports:
      - "16686:16686" # Jaeger UI + API
      - "14318:4318"  # OTLP HTTP của Jaeger, chỉ dùng cho chế độ gửi thẳng (npm run start:direct)

  redis:
    image: redis:8-alpine
    ports:
      - "16379:6379"  # tránh 6379 vì máy dev thường đã có Redis khác chạy ở đó
```

### `otel-collector-config.yaml`

```yaml
# Pipeline: app --OTLP--> receiver otlp --> memory_limiter --> batch --> Jaeger (+ in ra log)

receivers:
  otlp:
    protocols:
      grpc:
        # Mặc định receiver chỉ nghe localhost:4317 / localhost:4318.
        # Trong container, localhost là của riêng container, nên phải mở 0.0.0.0
        # thì cổng map ra máy (4317/4318) mới nhận được dữ liệu.
        endpoint: 0.0.0.0:4317
      http:
        endpoint: 0.0.0.0:4318

processors:
  # Chặn Collector ăn hết RAM khi dữ liệu dồn về: vượt ngưỡng thì từ chối nhận thêm.
  memory_limiter:
    check_interval: 1s
    limit_percentage: 80
    spike_limit_percentage: 25
  # Gom span thành lô trước khi gửi, giảm số request tới backend.
  batch: {}

exporters:
  # Từ Collector 0.161 exporter gRPC tên là otlp_grpc (tên cũ "otlp" đã deprecated).
  otlp_grpc/jaeger:
    endpoint: jaeger:4317
    tls:
      insecure: true
  # In tóm tắt mỗi lô span ra log: docker compose logs -f otel-collector
  debug:
    verbosity: basic

service:
  pipelines:
    traces:
      receivers: [otlp]
      processors: [memory_limiter, batch]
      exporters: [otlp_grpc/jaeger, debug]
```

Giải thích từng khối:

- **`receivers.otlp`**: nhận OTLP qua gRPC (4317) và HTTP (4318). Mặc định receiver chỉ nghe
  `localhost:4317` / `localhost:4318` (theo README của `otlpreceiver`). Trong container, `localhost` là
  của riêng container, nên phải khai báo `0.0.0.0` thì cổng map ra máy mới nhận được span. Quên dòng này
  là lỗi phổ biến nhất khi chạy Collector bằng Docker.
- **`processors.memory_limiter`**: khi dữ liệu dồn về quá nhiều, Collector từ chối nhận thêm thay vì bị
  kill vì hết RAM.
- **`processors.batch`**: gom span thành lô trước khi gửi, giảm số request tới backend.
- **`exporters.otlp_grpc/jaeger`**: gửi tiếp sang Jaeger bằng OTLP gRPC. Từ Collector **0.161**, exporter
  tên là `otlp_grpc` và `otlp_http`; tên cũ `otlp` / `otlphttp` vẫn chạy nhưng đã deprecated. Phần lớn
  tutorial trên mạng vẫn dùng tên cũ.
- **`exporters.debug`**: in tóm tắt mỗi lô span ra log của Collector, tiện kiểm tra span có tới không.
- **`service.pipelines.traces`**: nối receiver → processor → exporter. Khai báo mà không đưa vào pipeline
  thì component không chạy.

### Hai chế độ export

Code không đổi, chỉ khác biến `OTEL_EXPORTER_OTLP_ENDPOINT`:

| Chế độ | Lệnh | App gửi tới | Cách kiểm chứng |
|---|---|---|---|
| Qua Collector (nên dùng) | `npm start` | `http://localhost:4318` (mặc định) | `docker compose logs --since 1m otel-collector` có dòng tóm tắt span |
| Gửi thẳng Jaeger | `npm run start:direct` | `http://localhost:14318` | Log Collector không có dòng mới, Jaeger vẫn có trace |

Jaeger 2.x tự nhận OTLP, nên với dự án nhỏ, gửi thẳng là đủ. Collector đáng giá khi cần: đổi backend mà
không deploy lại app, lọc / che dữ liệu nhạy cảm, tail sampling (mục 13), gửi cùng lúc tới nhiều backend.

### Đổi sang gRPC

Cách 1, đổi exporter trong code:

```bash
npm install @opentelemetry/exporter-trace-otlp-grpc@^0.222.0
```

```js
// src/tracing.js: đổi dòng import, rồi đặt OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:4317
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-grpc');
```

Cách 2, để NodeSDK tự chọn theo biến môi trường: bỏ option `traceExporter` trong `tracing.js`, rồi đặt
`OTEL_EXPORTER_OTLP_PROTOCOL=grpc`. NodeSDK nhận các giá trị `grpc`, `http/protobuf` (mặc định) và
`http/json`.

### Dạo nhanh Jaeger UI

- Ô **Service** chọn `api-gateway`, bấm **Find Traces**. Mỗi dòng là một trace, kèm số span và tổng thời
  gian.
- Mở một trace để xem cây span dạng timeline. Span lỗi có dấu đỏ; mở span ra thấy attribute và event
  `exception` (kèm stacktrace).
- Ô tìm kiếm trên thanh trên cùng nhận **trace id**: copy `trace_id=...` từ log của service rồi dán vào.
- Trong chi tiết một span, phần **Process** chính là resource của service (mục 5).

---

## 10. Cấu trúc thư mục

```
148_opentelemetry_tracing/
├── README.md
├── package.json, package-lock.json
├── docker-compose.yml                    Collector + Jaeger + Redis
├── otel-collector-config.yaml            pipeline của Collector
├── src/
│   ├── tracing.js                        khởi tạo NodeSDK, nạp bằng --require
│   ├── shared/
│   │   ├── tracer.js                     tracer dùng chung + helper withSpan()
│   │   ├── propagation.js                inject/extract context, helper baggage
│   │   ├── logger.js                     log kèm trace_id / span_id
│   │   ├── messaging.js                  tên hàng đợi + hằng số messaging.*
│   │   └── http.js                       currentTraceId(), error middleware dùng chung
│   ├── api-gateway/server.js             Express :3000, gọi order-service bằng fetch
│   ├── order-service/
│   │   ├── server.js                     Express :3001, route POST /orders
│   │   ├── steps.js                      4 bước: validate, giữ hàng, thanh toán, đẩy event
│   │   ├── catalog.js                    danh mục sản phẩm trong bộ nhớ
│   │   └── errors.js                     ValidationError, PaymentError (có status + code)
│   └── notification-worker/worker.js     BRPOP từ Redis, extract context, "gửi email"
├── scripts/
│   ├── demo.js                           gửi 3 kịch bản, in link Jaeger
│   ├── verify-traces.js                  kiểm thử end-to-end qua Jaeger API
│   └── lib/
│       ├── jaeger.js                     client Jaeger API v3 + vẽ cây span
│       └── scenarios.js                  3 kịch bản dùng chung
├── test/
│   ├── helpers/otel.js                   OpenTelemetry trong bộ nhớ cho unit test
│   ├── unit/                             unit test (node --test)
│   ├── integration/                      test tích hợp cho tracing.js
│   └── fixtures/jaeger-v3-trace.json     response thật của Jaeger API v3
└── docs/superpowers/                     spec và plan của bài này
```

---

## 11. Output mẫu

### `npm start`, lúc khởi động và khi `npm run demo` gửi 3 kịch bản

```
[order] [otel] tracing đã bật: service=order-service export=http://localhost:4318
[gateway] [otel] tracing đã bật: service=api-gateway export=http://localhost:4318
[worker] [otel] tracing đã bật: service=notification-worker export=http://localhost:4318
[worker] 16:22:50.968 INFO  [notification-worker] đang chờ message trên list "order-events"
[gateway] 16:22:50.988 INFO  [api-gateway] đang nghe http://localhost:3000
[order] 16:22:51.040 INFO  [order-service] đang nghe http://localhost:3001 redis=redis://localhost:16379
[order] 16:22:54.715 INFO  [order-service] đã xác nhận đơn orderId=ORD-1790760174710 total=820000 transactionId=TXN-D1F1440B trace_id=f1c1d14b20306593e471a46bb6e5e2e5 span_id=542d11f5ff90cc73
[gateway] 16:22:54.723 INFO  [api-gateway] đã chuyển tiếp đơn status=201 tier=gold trace_id=f1c1d14b20306593e471a46bb6e5e2e5 span_id=41ee020ecfab8db7
[worker] 16:22:54.772 INFO  [notification-worker] đã gửi email xác nhận orderId=ORD-1790760174710 tier=gold trace_id=f1c1d14b20306593e471a46bb6e5e2e5 span_id=b1562b55d7803f9a
[order] 16:22:54.942 WARN  [order-service] từ chối đơn code=CARD_EXPIRED reason=Thẻ đã hết hạn trace_id=b3fb0023e98c408aa0d6bdf580edc593 span_id=a39e1fbdfe8e02a3
[gateway] 16:22:54.944 INFO  [api-gateway] đã chuyển tiếp đơn status=502 tier=standard trace_id=b3fb0023e98c408aa0d6bdf580edc593 span_id=a2abd2bde963cd1a
[order] 16:22:55.006 WARN  [order-service] từ chối đơn code=VALIDATION_ERROR reason=Đơn hàng phải có ít nhất 1 sản phẩm trace_id=0cfae34abcdd28841eedd75d9cdeee7d span_id=236dc5e628f4ae20
[gateway] 16:22:55.008 INFO  [api-gateway] đã chuyển tiếp đơn status=400 tier=standard trace_id=0cfae34abcdd28841eedd75d9cdeee7d span_id=8063eb6c8c207905
```

Để ý ba dòng của đơn thành công, ở ba service khác nhau, có **cùng** `trace_id=f1c1d14b...`. Đó là log
correlation: từ một dòng log bất kỳ, copy trace id là mở được toàn bộ luồng trong Jaeger.

### `npm run demo`

```
Gửi 3 kịch bản tới http://localhost:3000

success         HTTP 201  CONFIRMED ORD-1790760174710, tổng 820.000đ
                http://localhost:16686/trace/f1c1d14b20306593e471a46bb6e5e2e5
payment-failed  HTTP 502  CARD_EXPIRED: Thẻ đã hết hạn
                http://localhost:16686/trace/b3fb0023e98c408aa0d6bdf580edc593
invalid         HTTP 400  VALIDATION_ERROR: Đơn hàng phải có ít nhất 1 sản phẩm
                http://localhost:16686/trace/0cfae34abcdd28841eedd75d9cdeee7d

Span được gom và gửi khoảng 5 giây một lần, đợi vài giây rồi mở link.
```

### `npm run verify`

```
Gateway: http://localhost:3000   Jaeger: http://localhost:16686

... chờ trace success: http://localhost:16686/trace/05fa24d85f6289c7a03a15f557498350
... chờ trace payment-failed: http://localhost:16686/trace/78aa737b3dc69bf1a933d3d8b4f92440
... chờ trace invalid: http://localhost:16686/trace/9d8aee7a7679d0f0c664a2cfece47cb9

PASS  health          HTTP 200
PASS  success         HTTP 201
PASS  success         có span api-gateway / POST /orders (SERVER)
PASS  success         có span api-gateway / POST (CLIENT)
PASS  success         có span order-service / POST /orders (SERVER)
PASS  success         có span order-service / order.validate (INTERNAL)
PASS  success         có span order-service / inventory.reserve (INTERNAL)
PASS  success         có span order-service / payment.charge (INTERNAL)
PASS  success         có span order-service / send order-events (PRODUCER)
PASS  success         có span order-service / lpush (CLIENT)
PASS  success         có span notification-worker / process order-events (CONSUMER)
PASS  success         có span notification-worker / email.send (INTERNAL)
PASS  success         trace đi qua đủ 3 service
PASS  success         span cha của process order-events là send order-events
PASS  success         customer.tier = gold trên order.validate (baggage đi qua HTTP)
PASS  success         customer.tier = gold trên process order-events (baggage đi qua Redis)
PASS  success         resource của api-gateway có service.namespace=shop và deployment.environment.name
PASS  success         resource của order-service có service.namespace=shop và deployment.environment.name
PASS  success         resource của notification-worker có service.namespace=shop và deployment.environment.name
PASS  success         api-gateway: span Express không bị lặp
PASS  success         order-service: span Express không bị lặp
PASS  success         không span nào ERROR
PASS  payment-failed  HTTP 502
PASS  payment-failed  payment.charge có status ERROR
PASS  payment-failed  payment.charge có error.type = CARD_EXPIRED
PASS  payment-failed  payment.charge có event exception
PASS  payment-failed  span SERVER của order-service ERROR (5xx)
PASS  payment-failed  span CLIENT và span SERVER ở gateway ERROR
PASS  payment-failed  không có span send order-events
PASS  invalid         HTTP 400
PASS  invalid         order.validate có status ERROR và event exception
PASS  invalid         span SERVER của order-service và gateway KHÔNG ERROR (4xx là lỗi phía client)
PASS  invalid         span CLIENT ở gateway ERROR (client span: >= 400 là lỗi)
PASS  health          Jaeger không có operation GET nào của api-gateway

Kết quả: 34/34 check PASS

Cây span của đơn thành công (lấy từ Jaeger):

api-gateway          POST /orders                            SERVER
api-gateway          ├─ middleware - jsonParser              INTERNAL
api-gateway          └─ request handler - /orders            INTERNAL
api-gateway             └─ POST                              CLIENT
order-service              └─ POST /orders                   SERVER
order-service                 ├─ middleware - jsonParser     INTERNAL
order-service                 └─ request handler - /orders   INTERNAL
order-service                    ├─ order.validate           INTERNAL
order-service                    ├─ inventory.reserve        INTERNAL
order-service                    ├─ payment.charge           INTERNAL
order-service                    └─ send order-events        PRODUCER
order-service                       ├─ lpush                 CLIENT
notification-worker                 └─ process order-events  CONSUMER
notification-worker                    └─ email.send         INTERNAL
```

---

## 12. Kiểm thử

| Lệnh | Cần gì | Kiểm tra gì |
|---|---|---|
| `npm test` | Không cần Docker | 43 unit test: helper tracing, propagation, logger, order-service, api-gateway, worker, client Jaeger |
| `npm run test:integration` | `npm run infra:up` | `tracing.js` gửi được span qua Collector tới Jaeger, resource đúng, biến môi trường ghi đè được, Collector chết thì app không crash |
| `npm run verify` | `npm run infra:up` và `npm start` | 34 check end-to-end trên trace thật trong Jaeger |

Unit test không gửi span đi đâu cả. [`test/helpers/otel.js`](test/helpers/otel.js) dựng OpenTelemetry
trong bộ nhớ bằng `InMemorySpanExporter` của `@opentelemetry/sdk-trace` (package thay thế
`sdk-trace-base` / `sdk-trace-node`):

```js
const { context, propagation, trace } = require('@opentelemetry/api');
const { TracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} = require('@opentelemetry/core');

const exporter = new InMemorySpanExporter();
let installed = false;

/** Cài một lần cho mỗi tiến trình test, rồi xoá span của test trước. */
function setupTestTracing() {
  if (!installed) {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(
      new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] })
    );
    // sdk-trace nhận options dạng object ({ exporter }), khác sdk-trace-base (truyền thẳng exporter).
    // Truyền sai kiểu thì span vẫn được tạo nhưng không bao giờ tới exporter, và SDK không báo lỗi.
    trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] }));
    installed = true;
  }
  exporter.reset();
  return exporter;
}
```

Rồi test đọc span ra để kiểm tra, ví dụ trong
[`test/unit/order-service.test.js`](test/unit/order-service.test.js):

```js
test('thẻ hết hạn -> 502 CARD_EXPIRED, payment.charge ERROR + exception, không publish', async () => {
  const redis = fakeRedis();
  const res = await request(createApp({ redis }), { body: { ...VALID_ORDER, paymentMethod: 'expired_card' } });
  assert.equal(res.status, 502);
  assert.equal(res.body.error, 'CARD_EXPIRED');
  assert.equal(res.body.message, 'Thẻ đã hết hạn');
  const charge = findSpan('payment.charge');
  assert.equal(charge.status.code, SpanStatusCode.ERROR);
  assert.equal(charge.status.message, 'Thẻ đã hết hạn');
  assert.equal(charge.attributes['error.type'], 'CARD_EXPIRED');
  const exception = charge.events.find((e) => e.name === 'exception');
  assert.ok(exception, 'phải có event exception');
  // SDK lấy exception.type từ err.code nếu có, không có thì lấy err.name
  assert.equal(exception.attributes['exception.type'], 'CARD_EXPIRED');
  assert.equal(redis.pushed.length, 0);
  assert.ok(!spanNames().includes('send order-events'));
});
```

Một bẫy đã gặp khi viết helper này: `SimpleSpanProcessor` của `@opentelemetry/sdk-trace` nhận **object**
`{ exporter }`, khác `sdk-trace-base` nhận thẳng `exporter`. Truyền sai kiểu thì span vẫn được tạo, có
trace id hẳn hoi, nhưng không bao giờ tới exporter; lỗi bị nuốt ở `globalErrorHandler` nên không có thông
báo nào.

---

## 13. Lưu ý khi đưa lên production

### Sampling

Mặc định mọi trace đều được ghi. Hệ thống lớn thì như vậy quá tốn.

**Head sampling** quyết định ngay ở span đầu tiên. NodeSDK đọc biến môi trường khi code không truyền
`sampler`:

```bash
OTEL_TRACES_SAMPLER=parentbased_traceidratio
OTEL_TRACES_SAMPLER_ARG=0.1    # giữ 10% trace
```

Tiền tố `parentbased_` nghĩa là service phía sau làm theo quyết định của service phía trước (qua flags
trong `traceparent`), nên một trace không bị cắt ngang giữa chừng.

**Tail sampling** quyết định sau khi cả trace đã xong, ở Collector:

```yaml
processors:
  tail_sampling:
    decision_wait: 10s
    policies:
      - name: giu-moi-trace-loi
        type: status_code
        status_code: {status_codes: [ERROR]}
      - name: lay-mau-10-phan-tram
        type: probabilistic
        probabilistic: {sampling_percentage: 10}
```

Cấu hình trên giữ 100% trace có lỗi và 10% trace còn lại. Thêm `tail_sampling` vào `processors` của
pipeline và đặt **trước** `batch`. Điều kiện: mọi span của cùng một trace phải về **cùng một** Collector;
chạy nhiều Collector thì cần load balancing theo trace id.

### Batch

`OTEL_BSP_SCHEDULE_DELAY` (mặc định 5000 ms), `OTEL_BSP_MAX_QUEUE_SIZE`, `OTEL_BSP_MAX_EXPORT_BATCH_SIZE`,
`OTEL_BSP_EXPORT_TIMEOUT`. NodeSDK vẫn đọc các biến này khi truyền `traceExporter` trong code như
`tracing.js` (đã xem trong source 0.222). Hàng đợi đầy thì span mới bị bỏ, app không bị chặn.

### Những điều khác

- **Shutdown**: giữ đoạn bắt `SIGTERM` như `tracing.js`, nếu không mỗi lần deploy lại mất vài giây trace
  cuối.
- **Dữ liệu nhạy cảm**: không ghi email, số điện thoại, token, số thẻ vào attribute, event hay baggage.
  Collector có processor `attributes` và `redaction` để xoá / che thêm một lớp.
- **Thông tin máy trong resource**: detector `host` và `process` gửi kèm tên máy, user, đường dẫn và tham
  số dòng lệnh (xem mục 5). Chỉ bật detector cần thiết bằng `OTEL_NODE_RESOURCE_DETECTORS`, ví dụ
  `env,host`.
- **Tên span ít giá trị khác nhau**, id để trong attribute (mục 7).
- **Tắt nhanh khi có sự cố**: `OTEL_SDK_DISABLED=true`, không cần sửa code.
- **Pin phiên bản**: package `0.x` có thể phá API giữa các bản minor.
- **Hai kiểu triển khai Collector**: *agent* (sidecar hoặc DaemonSet, chạy cạnh app) và *gateway* (một
  cụm tập trung). Thường kết hợp cả hai: app → agent → gateway → backend. App chỉ biết địa chỉ Collector,
  nên đổi backend không cần deploy lại app.
- **Bảo mật đường gửi**: dùng `https://` cho endpoint, header xác thực qua `OTEL_EXPORTER_OTLP_HEADERS`
  (ví dụ `authorization=Bearer ...`).

---

## 14. Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| Không thấy trace trong Jaeger | Quên `npm run infra:up` (terminal của service in lỗi `connect ECONNREFUSED ...:4318`), sai `OTEL_EXPORTER_OTLP_ENDPOINT`, hoặc mới gửi chưa tới 5 giây | Bật hạ tầng, kiểm tra endpoint, chờ vài giây vì span được gửi theo lô |
| Log có `Module express has been loaded before @opentelemetry/instrumentation-express so it might not work` | `tracing.js` được nạp sau khi app đã `require('express')` | Nạp bằng `--require`, `--import` hoặc `NODE_OPTIONS` (mục 4) |
| Một luồng bị tách thành 2 trace | Context không được truyền: gọi HTTP bằng client chưa được instrument, hoặc quên inject / extract qua hàng đợi | Kiểm tra request có header `traceparent`, message có `headers.traceparent` |
| Span Express bị lặp, có span `middleware - patched` | Express 5 cùng lúc bị cả `instrumentation-express` lẫn `instrumentation-router` vá | Tắt `@opentelemetry/instrumentation-router` (mục 6) |
| `/health` vẫn có trace | Hook so sai path | Kiểm tra `ignoreIncomingRequestHook`, nhớ bỏ query string |
| `docker compose up` báo cổng bị chiếm | Đã có tiến trình khác dùng cổng đó | Đổi cổng bên trái trong `ports` (như Redis đang dùng `16379:6379`), rồi đổi biến môi trường tương ứng |
| `EADDRINUSE :::3000` | Còn tiến trình service cũ | Tắt tiến trình cũ rồi chạy lại |
| App ESM không có span nào | Thiếu loader hook | Thêm `--experimental-loader=@opentelemetry/instrumentation/hook.mjs` (mục 4) |
| `npm install` cảnh báo `EBADENGINE` cho `yargs-parser` trên Node 22.11 | Một phụ thuộc của `concurrently` 10 khai báo cần Node 22.12+ | Chỉ là cảnh báo, ví dụ vẫn chạy trên 22.11. Nâng Node lên 22.12+ là hết |
| Windows: Ctrl+C xong thì thiếu vài span cuối | `concurrently` kill tiến trình con trước khi kịp flush | Chờ vài giây rồi mới dừng, hoặc chạy từng service riêng (`npm run start:order`...) |

Muốn xem SDK đang làm gì thì bật log chi tiết: `OTEL_LOG_LEVEL=debug npm run start:order`.

---

## Tham khảo

- [OpenTelemetry JavaScript](https://opentelemetry.io/docs/languages/js/)
- [README của `@opentelemetry/sdk-node`](https://github.com/open-telemetry/opentelemetry-js/tree/main/experimental/packages/opentelemetry-sdk-node)
- [README của `@opentelemetry/auto-instrumentations-node`](https://github.com/open-telemetry/opentelemetry-js-contrib/tree/main/packages/auto-instrumentations-node)
- [ESM support trong OpenTelemetry JS](https://github.com/open-telemetry/opentelemetry-js/blob/main/doc/esm-support.md)
- [Semantic conventions: HTTP spans](https://opentelemetry.io/docs/specs/semconv/http/http-spans/)
- [Semantic conventions: messaging spans](https://opentelemetry.io/docs/specs/semconv/messaging/messaging-spans/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [W3C Baggage](https://www.w3.org/TR/baggage/)
- [OpenTelemetry Collector](https://opentelemetry.io/docs/collector/)
- [Tài liệu Jaeger](https://www.jaegertracing.io/docs/)
- Spec và plan của bài này:
  [docs/superpowers/specs/2026-09-30-opentelemetry-tracing-design.md](docs/superpowers/specs/2026-09-30-opentelemetry-tracing-design.md),
  [docs/superpowers/plans/2026-09-30-opentelemetry-tracing.md](docs/superpowers/plans/2026-09-30-opentelemetry-tracing.md)
