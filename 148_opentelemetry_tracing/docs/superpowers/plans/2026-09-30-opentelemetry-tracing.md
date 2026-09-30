# OpenTelemetry Tracing cho Node.js — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Xây ví dụ chạy được về OpenTelemetry tracing cho Node.js (3 service + Collector + Jaeger + Redis) kèm README tiếng Việt, đúng spec đã duyệt.

**Architecture:** Một file `src/tracing.js` dùng chung, nạp bằng `node --require`, khởi tạo NodeSDK với auto-instrumentation và OTLP/HTTP exporter. `api-gateway` gọi `order-service` qua HTTP (context tự truyền). `order-service` đẩy message vào Redis list và tự inject context. `notification-worker` tự extract context. Hạ tầng chạy bằng docker compose. Kiểm thử gồm unit test (`node --test` + `InMemorySpanExporter`), test tích hợp cho `tracing.js`, và kiểm thử end-to-end qua API v3 của Jaeger.

**Tech Stack:** Node.js 22 (CommonJS), `@opentelemetry/sdk-node` 0.222, `@opentelemetry/auto-instrumentations-node` 0.80, `@opentelemetry/exporter-trace-otlp-proto` 0.222, Express 5.2, ioredis 6, OTel Collector contrib 0.161, Jaeger 2.21, Redis 8.

**Spec:** `148_opentelemetry_tracing/docs/superpowers/specs/2026-09-30-opentelemetry-tracing-design.md`

## Global Constraints

- Thư mục làm việc cho mọi lệnh: `D:/HieuNM/xampp_htdocs_v6/148_opentelemetry_tracing` (Git Bash). Lệnh PowerShell được ghi rõ là PowerShell.
- Node `>=22` (máy có 22.11.0). CommonJS, mọi file JS bắt đầu bằng `'use strict';`, comment bằng tiếng Việt.
- Dependency: `@opentelemetry/sdk-node ^0.222.0`, `@opentelemetry/auto-instrumentations-node ^0.80.0`, `@opentelemetry/exporter-trace-otlp-proto ^0.222.0`, `@opentelemetry/api ^1.9.1`, `@opentelemetry/resources ^2.11.0`, `@opentelemetry/semantic-conventions ^1.43.0`, `express ^5.2.1`, `ioredis ^6.0.0`.
- devDependency: `cross-env ^10.1.0`, `concurrently ^10.0.5`, và chỉ dùng trong test: `@opentelemetry/sdk-trace ^2.11.0`, `@opentelemetry/context-async-hooks ^2.11.0`, `@opentelemetry/core ^2.11.0`.
- Image: `otel/opentelemetry-collector-contrib:0.161.0`, `jaegertracing/jaeger:2.21.0`, `redis:8-alpine`.
- Cổng trên máy: 3000 (api-gateway), 3001 (order-service), 4317/4318 (Collector), 16686 (Jaeger UI + API), 14318 (Jaeger OTLP HTTP), 16379 (Redis). **Không bao giờ dùng cổng 6379 trên máy**, vì đã có Redis khác chạy ở đó.
- Compose project `name: otel-tracing-demo`, không đặt `container_name`. Không đụng tới container nào ngoài project này.
- Service name: `api-gateway`, `order-service`, `notification-worker`. Resource `service.namespace = shop`.
- Hàng đợi: Redis list `order-events`. Tên span cố định: `order.validate`, `inventory.reserve`, `payment.charge`, `send order-events`, `process order-events`, `email.send`.
- Collector 0.161: exporter gRPC tên là `otlp_grpc` (tên cũ `otlp` đã deprecated), receiver vẫn tên `otlp` và phải bind `0.0.0.0`.
- Không commit, không sửa `148_opentelemetry_tracing/.idea/`. Luôn `git add` từng file cụ thể, không dùng `git add .` hay `git add -A`.
- Commit thẳng lên `main`. Subject bắt đầu bằng `148_opentelemetry_tracing:`. Mọi commit kết thúc bằng dòng `Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>`.

## Review Focus

Những tình huống spec không nói tới nhưng dễ gặp nhất khi người dùng chạy thử, xếp theo khả năng xảy ra:

1. **Quên `npm run infra:up`, Collector không chạy.** Service vẫn phải chạy bình thường, không crash, và có log cảnh báo export lỗi. Test: Task 4, test "Collector không chạy".
2. **Body JSON sai cú pháp** gửi tới gateway hoặc order-service. Phải trả 400 JSON `BAD_REQUEST`, không phải 500. Test: Task 6 và Task 7.
3. **order-service tắt** trong khi gateway vẫn chạy. Gateway phải trả 503 `ORDER_SERVICE_UNAVAILABLE` trong tối đa 5 giây, không treo. Test: Task 7.
4. **Redis mất kết nối.** order-service phải trả 500 `INTERNAL_ERROR` và span `send order-events` ERROR, không crash. Test: Task 6 (Redis giả ném lỗi). Code dùng `maxRetriesPerRequest: 1` để lỗi nhanh.
5. **Message trong Redis hỏng** (không phải JSON hoặc thiếu `headers`). Worker phải bỏ qua hoặc mở trace mới, vòng lặp chạy tiếp. Test: Task 8.

## Khác biệt nhỏ so với spec (đã cân nhắc)

1. Thêm unit test (`node --test`, không cần thư viện test) và test tích hợp cho `tracing.js`. Thêm script `test`, `test:integration` và 3 devDependency chỉ dùng trong test.
2. Tách thêm file để test được và tránh lặp code: `src/shared/messaging.js`, `src/shared/http.js`, `src/order-service/steps.js`, `scripts/lib/jaeger.js`, `scripts/lib/scenarios.js`, `test/**`.
3. `verify` dùng API v3 chính thức của Jaeger (`/api/v3/traces/{id}`, `/api/v3/operations`), không dùng `/api/traces/{id}` (API nội bộ). Định dạng response đã được kiểm chứng bằng một container `jaegertracing/jaeger:2.21.0` chạy thử. Fixture ở Task 2 là response thật.
4. Lỗi nghiệp vụ đã biết (400/502) được trả response ngay trong route handler. Error middleware chỉ xử lý lỗi parse body (400) và lỗi bất ngờ (500). Lý do: instrumentation express đánh ERROR cho span `request handler` khi lỗi đi qua `next(err)`, như vậy sẽ lệch bảng kịch bản 2.3 của spec.
5. Validation thêm 2 luật hiển nhiên: thiếu `customerId` hoặc thiếu `paymentMethod` thì trả 400.
6. Logger in thêm level (`INFO`/`WARN`/`ERROR`). `tracing.js` bật diag logger mức WARN khi không có `OTEL_LOG_LEVEL`, để thấy được lỗi export.
7. `server.js` và `worker.js` export hàm (`createApp`, `handleMessage`). Chỉ `listen` hoặc chạy vòng lặp khi file là entry (`require.main === module`).
8. `verify` in thêm cây span của đơn thành công (dùng cho phần output mẫu của README).
9. Comment trong compose và README không nhắc tên container của dự án khác trên máy.
10. Worker không có cờ dừng như spec mục 4.8 mô tả. Khi nhận SIGINT/SIGTERM, `tracing.js` flush span rồi thoát tiến trình, nên vòng lặp `BRPOP` (timeout 5 giây) dừng theo.

## Lệnh vận hành dùng trong các task E2E

Các lệnh này được lặp lại đầy đủ trong từng task cần dùng. Ghi ở đây để dễ tra.

- **Chạy service nền:** trong harness có Bash `run_in_background`, dùng `run_in_background: true`. Nếu không, mở một terminal riêng.
- **Chờ service sẵn sàng:**
  ```bash
  for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3000/health && curl -sf -o /dev/null http://localhost:3001/health && break; sleep 1; done; curl -s http://localhost:3000/health; curl -s http://localhost:3001/health
  ```
- **Dừng service (PowerShell).** Chỉ khớp đúng 3 tiến trình của ví dụ, không đụng tới tiến trình node khác:
  ```powershell
  Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'tracing\.js.*src[\\/](api-gateway|order-service|notification-worker)[\\/]' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "stopped $($_.ProcessId)" }
  ```

---

### Task 1: Khung project và hạ tầng Docker

**Files:**
- Create: `package.json`
- Create: `.gitignore`
- Create: `docker-compose.yml`
- Create: `otel-collector-config.yaml`
- Create (do npm sinh ra): `package-lock.json`

**Interfaces:**
- Consumes: không có.
- Produces: npm scripts `infra:up`, `infra:down`, `infra:logs`, `start:gateway`, `start:order`, `start:worker`, `start`, `start:direct`, `demo`, `verify`, `test`, `test:integration`. Hạ tầng: Collector nhận OTLP ở `localhost:4317`/`4318`, Jaeger UI/API ở `localhost:16686`, Jaeger OTLP HTTP ở `localhost:14318`, Redis ở `localhost:16379`.

- [ ] **Step 1: Chạy kiểm tra hạ tầng khi chưa có file, phải FAIL**

```bash
cd "D:/HieuNM/xampp_htdocs_v6/148_opentelemetry_tracing" && docker compose config --quiet
```

Expected: FAIL với thông báo dạng `no configuration file provided: not found`.

- [ ] **Step 2: Tạo `package.json`**

```json
{
  "name": "opentelemetry-tracing-nodejs-example",
  "version": "1.0.0",
  "description": "Ví dụ OpenTelemetry tracing cho Node.js: Express, custom span, truyền context qua HTTP và Redis, export tới OTel Collector / Jaeger",
  "type": "commonjs",
  "private": true,
  "engines": {
    "node": ">=22"
  },
  "scripts": {
    "infra:up": "docker compose up -d",
    "infra:down": "docker compose down",
    "infra:logs": "docker compose logs -f otel-collector",
    "start:gateway": "cross-env OTEL_SERVICE_NAME=api-gateway PORT=3000 node --require ./src/tracing.js src/api-gateway/server.js",
    "start:order": "cross-env OTEL_SERVICE_NAME=order-service PORT=3001 node --require ./src/tracing.js src/order-service/server.js",
    "start:worker": "cross-env OTEL_SERVICE_NAME=notification-worker node --require ./src/tracing.js src/notification-worker/worker.js",
    "start": "concurrently -n gateway,order,worker -c cyan,magenta,yellow npm:start:gateway npm:start:order npm:start:worker",
    "start:direct": "cross-env OTEL_EXPORTER_OTLP_ENDPOINT=http://localhost:14318 npm start",
    "demo": "node scripts/demo.js",
    "verify": "node scripts/verify-traces.js",
    "test": "node --test \"test/unit/**/*.test.js\"",
    "test:integration": "node --test \"test/integration/**/*.test.js\""
  },
  "keywords": [
    "opentelemetry",
    "tracing",
    "distributed-tracing",
    "jaeger",
    "otel-collector",
    "express",
    "redis",
    "nodejs"
  ],
  "author": "",
  "license": "MIT"
}
```

- [ ] **Step 3: Cài dependency**

```bash
npm install @opentelemetry/sdk-node@^0.222.0 @opentelemetry/auto-instrumentations-node@^0.80.0 @opentelemetry/exporter-trace-otlp-proto@^0.222.0 @opentelemetry/api@^1.9.1 @opentelemetry/resources@^2.11.0 @opentelemetry/semantic-conventions@^1.43.0 express@^5.2.1 ioredis@^6.0.0
npm install -D cross-env@^10.1.0 concurrently@^10.0.5 @opentelemetry/sdk-trace@^2.11.0 @opentelemetry/context-async-hooks@^2.11.0 @opentelemetry/core@^2.11.0
npm ls @opentelemetry/api
```

Expected: cài xong không có lỗi. `npm ls @opentelemetry/api` chỉ có **một** phiên bản `1.9.x`, các chỗ khác hiện `deduped`. Có hai bản `@opentelemetry/api` thì span sẽ không nối với nhau, phải dừng lại và xử lý.

- [ ] **Step 4: Tạo `.gitignore`**

```
node_modules/
*.log
.tmp/
```

`.tmp/` chứa file tạm khi chạy thử (output mẫu cho README). Không dùng `/tmp`: trong Git Bash `/tmp` trỏ tới thư mục Temp của Windows, nhưng Node.js lại hiểu `/tmp/...` là `D:\tmp\...`.

- [ ] **Step 5: Tạo `docker-compose.yml`**

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

- [ ] **Step 6: Tạo `otel-collector-config.yaml`**

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

- [ ] **Step 7: Bật hạ tầng và kiểm tra, phải PASS**

```bash
docker compose config --quiet && echo "compose OK"
npm run infra:up
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:16686/ && break; sleep 1; done
docker compose ps --format '{{.Service}} {{.State}}'
docker compose exec -T redis redis-cli ping
docker compose logs otel-collector 2>&1 | grep -iE "everything is ready|error" | head -5
```

Expected:
- `compose OK`.
- 3 dòng `jaeger running`, `otel-collector running`, `redis running`.
- `PONG`.
- Có dòng chứa `Everything is ready`, không có dòng `error`. Nếu Collector báo lỗi config thì đọc log, sửa `otel-collector-config.yaml`, rồi `docker compose up -d --force-recreate otel-collector`.

- [ ] **Step 8: Gửi span thử qua Collector và gửi thẳng Jaeger, đọc lại bằng API v3, phải PASS**

```bash
mkdir -p .tmp
send_and_check() {  # $1 = endpoint OTLP HTTP, $2 = nhãn
  local T NOW START
  T=$(node -e "process.stdout.write(require('crypto').randomBytes(16).toString('hex'))")
  NOW=$(node -e "process.stdout.write(String(BigInt(Date.now()) * 1000000n))")
  START=$((NOW - 1000000000))
  cat > .tmp/span.json <<EOF
{"resourceSpans":[{"resource":{"attributes":[{"key":"service.name","value":{"stringValue":"infra-check"}}]},"scopeSpans":[{"scope":{"name":"infra-check"},"spans":[{"traceId":"$T","spanId":"aaaaaaaaaaaaaaaa","name":"infra-check $2","kind":1,"startTimeUnixNano":"$START","endTimeUnixNano":"$NOW"}]}]}]}
EOF
  curl -s -o /dev/null -w "$2 POST -> %{http_code}\n" -H 'Content-Type: application/json' --data @.tmp/span.json "$1/v1/traces"
  for i in $(seq 1 20); do
    if curl -s "http://localhost:16686/api/v3/traces/$T" | grep -q "infra-check $2"; then echo "$2: OK"; return 0; fi
    sleep 1
  done
  echo "$2: FAIL (Jaeger không có trace $T)"; return 1
}
send_and_check http://localhost:4318 collector
send_and_check http://localhost:14318 direct
```

Expected:
```
collector POST -> 200
collector: OK
direct POST -> 200
direct: OK
```

- [ ] **Step 9: Commit**

```bash
git add package.json package-lock.json .gitignore docker-compose.yml otel-collector-config.yaml
git commit -F - <<'EOF'
148_opentelemetry_tracing: add project scaffold and Docker infra

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 2: Client Jaeger API v3 (dùng cho verify và test tích hợp)

**Files:**
- Create: `test/fixtures/jaeger-v3-trace.json`
- Create: `test/unit/jaeger.test.js`
- Create: `scripts/lib/jaeger.js`

**Interfaces:**
- Consumes: không có.
- Produces (`scripts/lib/jaeger.js`):
  - `JAEGER_URL: string` (env `JAEGER_URL`, mặc định `http://localhost:16686`)
  - `normalizeKind(kind: number|string): 'UNSPECIFIED'|'INTERNAL'|'SERVER'|'CLIENT'|'PRODUCER'|'CONSUMER'`
  - `normalizeStatus(status?: { code?: number|string }): 'UNSET'|'OK'|'ERROR'`
  - `flattenTrace(body: object|null): FlatSpan[]`, trong đó `FlatSpan = { service, resource, name, traceId, spanId, parentSpanId, kind, status, startTime: bigint, attributes, events: { name, attributes }[] }`
  - `formatTree(spans: FlatSpan[]): string`
  - `getTrace(traceId: string, baseUrl?: string): Promise<FlatSpan[]>` (404 thì trả `[]`)
  - `waitForTrace(traceId, isComplete: (spans) => boolean, opts?: { timeoutMs?: number, intervalMs?: number, baseUrl?: string }): Promise<FlatSpan[]>`
  - `getOperations(service: string, baseUrl?: string): Promise<string[]>`

- [ ] **Step 1: Tạo fixture, là response thật của `GET /api/v3/traces/{id}` từ Jaeger 2.21**

`test/fixtures/jaeger-v3-trace.json`:

```json
{
  "result": {
    "resourceSpans": [
      {
        "resource": {
          "attributes": [
            { "key": "service.name", "value": { "stringValue": "probe-svc" } },
            { "key": "service.namespace", "value": { "stringValue": "shop" } }
          ]
        },
        "scopeSpans": [
          {
            "scope": { "name": "probe" },
            "spans": [
              {
                "traceId": "5b8efff798038103d269b633813fc60c",
                "spanId": "eee19b7ec3c1b174",
                "name": "POST /orders",
                "kind": 2,
                "startTimeUnixNano": "1790754833802257200",
                "endTimeUnixNano": "1790754834702257200",
                "attributes": [
                  { "key": "http.response.status_code", "value": { "intValue": "502" } }
                ],
                "status": { "message": "boom", "code": 2 }
              },
              {
                "traceId": "5b8efff798038103d269b633813fc60c",
                "spanId": "eee19b7ec3c1b175",
                "parentSpanId": "eee19b7ec3c1b174",
                "name": "send order-events",
                "kind": 4,
                "startTimeUnixNano": "1790754833802257200",
                "endTimeUnixNano": "1790754834702257200",
                "attributes": [
                  { "key": "customer.tier", "value": { "stringValue": "gold" } }
                ],
                "events": [
                  {
                    "timeUnixNano": "1790754834702257200",
                    "name": "exception",
                    "attributes": [
                      { "key": "exception.type", "value": { "stringValue": "CARD_EXPIRED" } }
                    ]
                  }
                ],
                "status": {}
              }
            ]
          }
        ]
      }
    ]
  }
}
```

- [ ] **Step 2: Viết test sẽ FAIL**

`test/unit/jaeger.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixture = require('../fixtures/jaeger-v3-trace.json');
const { flattenTrace, formatTree, normalizeKind, normalizeStatus } = require('../../scripts/lib/jaeger');

// Fixture là response THẬT của GET /api/v3/traces/{id} từ jaegertracing/jaeger:2.21.0.

test('flattenTrace: OTLP JSON của Jaeger v3 -> danh sách span phẳng', () => {
  const spans = flattenTrace(fixture);
  assert.equal(spans.length, 2);

  const server = spans.find((s) => s.name === 'POST /orders');
  assert.equal(server.service, 'probe-svc');
  assert.equal(server.resource['service.namespace'], 'shop');
  assert.equal(server.kind, 'SERVER');
  assert.equal(server.status, 'ERROR');
  assert.equal(server.parentSpanId, '');
  assert.equal(server.attributes['http.response.status_code'], 502);

  const producer = spans.find((s) => s.name === 'send order-events');
  assert.equal(producer.kind, 'PRODUCER');
  assert.equal(producer.status, 'UNSET');
  assert.equal(producer.parentSpanId, server.spanId);
  assert.equal(producer.attributes['customer.tier'], 'gold');
  assert.deepEqual(producer.events, [
    { name: 'exception', attributes: { 'exception.type': 'CARD_EXPIRED' } },
  ]);
});

test('flattenTrace: body null hoặc thiếu result -> mảng rỗng', () => {
  assert.deepEqual(flattenTrace(null), []);
  assert.deepEqual(flattenTrace({}), []);
  assert.deepEqual(flattenTrace({ result: {} }), []);
});

test('normalizeKind / normalizeStatus chấp nhận cả số lẫn chuỗi enum', () => {
  assert.equal(normalizeKind(1), 'INTERNAL');
  assert.equal(normalizeKind(3), 'CLIENT');
  assert.equal(normalizeKind(5), 'CONSUMER');
  assert.equal(normalizeKind('SPAN_KIND_PRODUCER'), 'PRODUCER');
  assert.equal(normalizeKind(undefined), 'UNSPECIFIED');
  assert.equal(normalizeStatus({ code: 2 }), 'ERROR');
  assert.equal(normalizeStatus({ code: 'STATUS_CODE_OK' }), 'OK');
  assert.equal(normalizeStatus({}), 'UNSET');
  assert.equal(normalizeStatus(undefined), 'UNSET');
});

test('formatTree vẽ cây span theo quan hệ cha/con', () => {
  const lines = formatTree(flattenTrace(fixture)).split('\n');
  assert.deepEqual(lines, [
    'probe-svc  ' + 'POST /orders'.padEnd(20) + '  SERVER  ERROR',
    'probe-svc  ' + '└─ send order-events'.padEnd(20) + '  PRODUCER',
  ]);
});

test('formatTree với mảng rỗng -> chuỗi rỗng', () => {
  assert.equal(formatTree([]), '');
});
```

- [ ] **Step 3: Chạy test để thấy FAIL**

Run: `npm test`
Expected: FAIL với `Cannot find module '../../scripts/lib/jaeger'`.

- [ ] **Step 4: Viết `scripts/lib/jaeger.js`**

```js
'use strict';

/**
 * Client tối giản cho API v3 của Jaeger 2.x: OTLP JSON, có OpenAPI, là API chính thức.
 * Các endpoint /api/* không có "v3" là API nội bộ của Jaeger UI. Tài liệu Jaeger ghi rõ
 * chúng có thể thay đổi bất cứ lúc nào, nên ở đây không dùng.
 *
 * Dùng chung cho scripts/verify-traces.js và test tích hợp.
 */

const JAEGER_URL = process.env.JAEGER_URL || 'http://localhost:16686';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Enum SpanKind trong OTLP: 0 UNSPECIFIED, 1 INTERNAL, 2 SERVER, 3 CLIENT, 4 PRODUCER, 5 CONSUMER.
// Lưu ý: khác với SpanKind của @opentelemetry/api (ở đó INTERNAL = 0).
const KIND_NAMES = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];

/** 2 -> 'SERVER'. Cũng chấp nhận dạng chuỗi 'SPAN_KIND_SERVER'. */
function normalizeKind(kind) {
  if (typeof kind === 'number') return KIND_NAMES[kind] || 'UNSPECIFIED';
  return String(kind || 'SPAN_KIND_UNSPECIFIED').replace(/^SPAN_KIND_/, '');
}

/** { code: 2 } -> 'ERROR'. Status rỗng {} nghĩa là UNSET. */
function normalizeStatus(status) {
  const code = status?.code;
  if (code === 2 || code === 'STATUS_CODE_ERROR') return 'ERROR';
  if (code === 1 || code === 'STATUS_CODE_OK') return 'OK';
  return 'UNSET';
}

function attributeValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return Number(value.intValue); // int64 được mã hoá thành chuỗi trong OTLP JSON
  if ('doubleValue' in value) return value.doubleValue;
  if ('boolValue' in value) return value.boolValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(attributeValue);
  return undefined;
}

function toAttributes(list = []) {
  return Object.fromEntries(list.map(({ key, value }) => [key, attributeValue(value)]));
}

/** OTLP JSON (resourceSpans -> scopeSpans -> spans) -> mảng span phẳng, dễ kiểm tra. */
function flattenTrace(body) {
  const resourceSpans = body?.result?.resourceSpans ?? body?.resourceSpans ?? [];
  const spans = [];
  for (const rs of resourceSpans) {
    const resource = toAttributes(rs.resource?.attributes);
    for (const ss of rs.scopeSpans || []) {
      for (const s of ss.spans || []) {
        spans.push({
          service: resource['service.name'],
          resource,
          name: s.name,
          traceId: s.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId || '',
          kind: normalizeKind(s.kind),
          status: normalizeStatus(s.status),
          startTime: BigInt(s.startTimeUnixNano || 0),
          attributes: toAttributes(s.attributes),
          events: (s.events || []).map((e) => ({ name: e.name, attributes: toAttributes(e.attributes) })),
        });
      }
    }
  }
  return spans;
}

/**
 * Vẽ cây span dạng text, giống màn hình Jaeger, để in ra terminal hoặc chép vào README:
 *   api-gateway    POST /orders        SERVER
 *   api-gateway    └─ POST             CLIENT
 */
function formatTree(spans) {
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map();
  for (const span of spans) {
    // Span không có cha, hoặc cha không nằm trong trace, được coi là gốc.
    const parentId = ids.has(span.parentSpanId) ? span.parentSpanId : '';
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(span);
  }
  for (const list of children.values()) {
    list.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
  }

  const rows = [];
  const walk = (span, prefix, connector) => {
    rows.push({
      service: span.service || '?',
      label: `${prefix}${connector}${span.name}`,
      kind: span.kind,
      error: span.status === 'ERROR',
    });
    const kids = children.get(span.spanId) || [];
    const nextPrefix = prefix + (connector === '├─ ' ? '│  ' : connector === '└─ ' ? '   ' : '');
    kids.forEach((kid, i) => walk(kid, nextPrefix, i === kids.length - 1 ? '└─ ' : '├─ '));
  };
  for (const root of children.get('') || []) walk(root, '', '');

  const serviceWidth = Math.max(0, ...rows.map((r) => r.service.length));
  const labelWidth = Math.max(0, ...rows.map((r) => r.label.length));
  return rows
    .map((r) => `${r.service.padEnd(serviceWidth)}  ${r.label.padEnd(labelWidth)}  ${r.kind}${r.error ? '  ERROR' : ''}`)
    .join('\n');
}

async function getJson(path, baseUrl = JAEGER_URL) {
  const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Jaeger ${path} -> HTTP ${res.status}`);
  return res.json();
}

/** Lấy trace theo id. Chưa có (404) thì trả mảng rỗng. */
async function getTrace(traceId, baseUrl) {
  return flattenTrace(await getJson(`/api/v3/traces/${traceId}`, baseUrl));
}

/**
 * Hỏi lặp lại tới khi isComplete(spans) đúng hoặc hết giờ. Cần thiết vì SDK gom span và gửi
 * theo lô (mặc định khoảng 5 giây một lần), rồi Collector lại gom thêm một nhịp nữa.
 * Hết giờ thì trả về phần đã có, để báo cáo span nào còn thiếu.
 */
async function waitForTrace(traceId, isComplete, { timeoutMs = 30000, intervalMs = 1000, baseUrl } = {}) {
  const deadline = Date.now() + timeoutMs;
  let spans = [];
  while (Date.now() < deadline) {
    spans = await getTrace(traceId, baseUrl);
    if (spans.length > 0 && isComplete(spans)) return spans;
    await sleep(intervalMs);
  }
  return spans;
}

/** Danh sách tên operation (tên span) Jaeger đã thấy của một service. */
async function getOperations(service, baseUrl) {
  const body = await getJson(`/api/v3/operations?service=${encodeURIComponent(service)}`, baseUrl);
  return (body?.operations || []).map((op) => op.name);
}

module.exports = {
  JAEGER_URL,
  normalizeKind,
  normalizeStatus,
  flattenTrace,
  formatTree,
  getTrace,
  waitForTrace,
  getOperations,
};
```

- [ ] **Step 5: Chạy test để thấy PASS**

Run: `npm test`
Expected: `# pass 5`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add test/fixtures/jaeger-v3-trace.json test/unit/jaeger.test.js scripts/lib/jaeger.js
git commit -F - <<'EOF'
148_opentelemetry_tracing: add Jaeger v3 API client with tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 3: Helper tracing dùng chung (tracer, propagation, logger, messaging)

**Files:**
- Create: `test/helpers/otel.js`
- Create: `test/unit/tracer.test.js`
- Create: `test/unit/propagation.test.js`
- Create: `test/unit/logger.test.js`
- Create: `src/shared/tracer.js`
- Create: `src/shared/propagation.js`
- Create: `src/shared/logger.js`
- Create: `src/shared/messaging.js`

**Interfaces:**
- Consumes: không có.
- Produces:
  - `test/helpers/otel.js`: `setupTestTracing(): InMemorySpanExporter` (cài provider + context manager + propagator W3C một lần cho mỗi tiến trình test, rồi `reset()` exporter), `findSpan(name: string): ReadableSpan` (không thấy thì ném lỗi, liệt kê các span đang có).
  - `src/shared/tracer.js`: `tracer: Tracer` (tên `otel-tracing-demo`), `withSpan(name, options, fn, parentContext = context.active()): Promise<ReturnType<fn>>`, `markSpanError(span, err): void`.
  - `src/shared/propagation.js`: `injectContext(carrier = {}): object`, `extractContext(carrier?: object): Context`, `withBaggage(entries: Record<string,string>, fn): ReturnType<fn>`, `getBaggageValue(key: string, ctx = context.active()): string|undefined`.
  - `src/shared/logger.js`: `createLogger(serviceName: string, write?: (line: string) => void): { info, warn, error }`, mỗi hàm có dạng `(message: string, fields?: object) => void`.
  - `src/shared/messaging.js`: `QUEUE_NAME = 'order-events'`, `ATTR_MESSAGING_SYSTEM`, `ATTR_MESSAGING_DESTINATION_NAME`, `ATTR_MESSAGING_OPERATION_TYPE`, `ATTR_MESSAGING_OPERATION_NAME`, `ATTR_MESSAGING_MESSAGE_ID`.

- [ ] **Step 1: Tạo helper cho unit test**

`test/helpers/otel.js`:

```js
'use strict';

/**
 * Dựng OpenTelemetry "trong bộ nhớ" cho unit test. Span không gửi đi đâu cả mà nằm trong
 * InMemorySpanExporter để test đọc lại.
 * Dùng @opentelemetry/sdk-trace (package thay thế sdk-trace-base / sdk-trace-node), kèm
 * context manager và propagator W3C, giống cách NodeSDK cấu hình khi chạy thật.
 */
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
    trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }));
    installed = true;
  }
  exporter.reset();
  return exporter;
}

/** Lấy span đã kết thúc theo tên. Không thấy thì ném lỗi, kèm danh sách span đang có. */
function findSpan(name) {
  const spans = exporter.getFinishedSpans();
  const span = spans.find((s) => s.name === name);
  if (!span) {
    throw new Error(`Không thấy span "${name}". Đang có: ${spans.map((s) => s.name).join(', ') || '(trống)'}`);
  }
  return span;
}

module.exports = { setupTestTracing, findSpan };
```

- [ ] **Step 2: Viết test cho `withSpan`, sẽ FAIL**

`test/unit/tracer.test.js`:

```js
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SpanStatusCode, SpanKind, trace, context } = require('@opentelemetry/api');
const { setupTestTracing, findSpan } = require('../helpers/otel');
const { withSpan } = require('../../src/shared/tracer');

beforeEach(() => {
  setupTestTracing();
});

test('thành công: trả kết quả, span đã end, status UNSET, có attributes', async () => {
  const result = await withSpan('unit.ok', { attributes: { 'order.id': 'ORD-1' } }, async () => 42);
  assert.equal(result, 42);
  const span = findSpan('unit.ok');
  assert.equal(span.ended, true);
  assert.equal(span.status.code, SpanStatusCode.UNSET);
  assert.equal(span.attributes['order.id'], 'ORD-1');
  assert.equal(span.instrumentationScope.name, 'otel-tracing-demo');
});

test('lỗi: event exception + error.type + status ERROR, lỗi được ném tiếp', async () => {
  const err = Object.assign(new Error('Thẻ đã hết hạn'), { code: 'CARD_EXPIRED' });
  await assert.rejects(
    withSpan('unit.fail', {}, async () => {
      throw err;
    }),
    (thrown) => thrown === err
  );
  const span = findSpan('unit.fail');
  assert.equal(span.ended, true);
  assert.equal(span.status.code, SpanStatusCode.ERROR);
  assert.equal(span.status.message, 'Thẻ đã hết hạn');
  assert.equal(span.attributes['error.type'], 'CARD_EXPIRED');
  const exception = span.events.find((e) => e.name === 'exception');
  assert.ok(exception, 'phải có event exception');
  assert.equal(exception.attributes['exception.message'], 'Thẻ đã hết hạn');
});

test('lỗi không có code: error.type lấy theo tên lớp lỗi', async () => {
  await assert.rejects(withSpan('unit.type-error', {}, async () => {
    throw new TypeError('sai kiểu');
  }));
  assert.equal(findSpan('unit.type-error').attributes['error.type'], 'TypeError');
});

test('ném giá trị không phải Error vẫn đánh dấu ERROR và ném tiếp nguyên giá trị', async () => {
  await assert.rejects(
    withSpan('unit.string-throw', {}, async () => {
      throw 'boom';
    }),
    (thrown) => thrown === 'boom'
  );
  const span = findSpan('unit.string-throw');
  assert.equal(span.status.code, SpanStatusCode.ERROR);
  assert.equal(span.status.message, 'boom');
});

test('span con tự lồng vào span cha đang active', async () => {
  await withSpan('unit.parent', {}, async () => {
    await withSpan('unit.child', {}, async () => {});
  });
  const parent = findSpan('unit.parent');
  const child = findSpan('unit.child');
  assert.equal(child.parentSpanContext.spanId, parent.spanContext().spanId);
  assert.equal(child.spanContext().traceId, parent.spanContext().traceId);
});

test('nhận parentContext tường minh (dùng cho consumer)', async () => {
  const outer = trace.getTracer('test').startSpan('unit.remote-parent');
  const parentContext = trace.setSpan(context.active(), outer);
  await withSpan('unit.consumer', { kind: SpanKind.CONSUMER }, async () => {}, parentContext);
  outer.end();
  const consumer = findSpan('unit.consumer');
  assert.equal(consumer.kind, SpanKind.CONSUMER);
  assert.equal(consumer.parentSpanContext.spanId, outer.spanContext().spanId);
});
```

- [ ] **Step 3: Viết test cho propagation, sẽ FAIL**

`test/unit/propagation.test.js`:

```js
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { trace } = require('@opentelemetry/api');
const { setupTestTracing } = require('../helpers/otel');
const { withSpan } = require('../../src/shared/tracer');
const { injectContext, extractContext, withBaggage, getBaggageValue } = require('../../src/shared/propagation');

beforeEach(() => {
  setupTestTracing();
});

test('injectContext ghi traceparent đúng định dạng W3C của span đang active', async () => {
  await withSpan('unit.producer', {}, async (span) => {
    const headers = injectContext({});
    const { traceId, spanId } = span.spanContext();
    assert.equal(headers.traceparent, `00-${traceId}-${spanId}-01`);
  });
});

test('extractContext dựng lại trace id / span id từ carrier', () => {
  const ctx = extractContext({ traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01' });
  const spanContext = trace.getSpanContext(ctx);
  assert.equal(spanContext.traceId, '0af7651916cd43dd8448eb211c80319c');
  assert.equal(spanContext.spanId, 'b7ad6b7169203331');
  assert.equal(spanContext.isRemote, true);
});

test('extractContext với carrier rỗng, undefined hoặc traceparent sai -> không có span cha', () => {
  assert.equal(trace.getSpanContext(extractContext(undefined)), undefined);
  assert.equal(trace.getSpanContext(extractContext({})), undefined);
  assert.equal(trace.getSpanContext(extractContext({ traceparent: 'khong-hop-le' })), undefined);
});

test('withBaggage: baggage đi theo inject và đọc lại được sau extract', async () => {
  const headers = await withBaggage({ 'customer.tier': 'gold' }, async () => {
    assert.equal(getBaggageValue('customer.tier'), 'gold');
    return injectContext({});
  });
  assert.equal(headers.baggage, 'customer.tier=gold');
  assert.equal(getBaggageValue('customer.tier', extractContext(headers)), 'gold');
});

test('withBaggage giữ lại baggage có sẵn từ upstream', () => {
  const value = withBaggage({ a: '1' }, () => withBaggage({ b: '2' }, () => [getBaggageValue('a'), getBaggageValue('b')]));
  assert.deepEqual(value, ['1', '2']);
});

test('getBaggageValue trả undefined khi không có baggage', () => {
  assert.equal(getBaggageValue('customer.tier'), undefined);
});
```

- [ ] **Step 4: Viết test cho logger, sẽ FAIL**

`test/unit/logger.test.js`:

```js
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestTracing } = require('../helpers/otel');
const { withSpan } = require('../../src/shared/tracer');
const { createLogger } = require('../../src/shared/logger');

beforeEach(() => {
  setupTestTracing();
});

test('log bên trong span có trace_id và span_id của span đó', async () => {
  const lines = [];
  const log = createLogger('unit-svc', (line) => lines.push(line));
  let ids;
  await withSpan('unit.log', {}, async (span) => {
    ids = span.spanContext();
    log.info('hello', { orderId: 'ORD-1' });
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\d{2}:\d{2}:\d{2}\.\d{3} INFO  \[unit-svc\] hello orderId=ORD-1 /);
  assert.ok(lines[0].endsWith(`trace_id=${ids.traceId} span_id=${ids.spanId}`), lines[0]);
});

test('log ngoài span không có trace_id; field undefined bị bỏ; object in dạng JSON', () => {
  const lines = [];
  const log = createLogger('unit-svc', (line) => lines.push(line));
  log.error('boom', { status: 500, skip: undefined, detail: { a: 1 } });
  assert.match(lines[0], /^\d{2}:\d{2}:\d{2}\.\d{3} ERROR \[unit-svc\] boom status=500 detail=\{"a":1\}$/);
});
```

- [ ] **Step 5: Chạy test để thấy FAIL**

Run: `npm test`
Expected: FAIL với `Cannot find module '../../src/shared/tracer'`. Test của Task 2 vẫn PASS.

- [ ] **Step 6: Viết `src/shared/tracer.js`**

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

- [ ] **Step 7: Viết `src/shared/propagation.js`**

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

- [ ] **Step 8: Viết `src/shared/logger.js`**

```js
'use strict';

const { trace } = require('@opentelemetry/api');

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** HH:MM:SS.mmm theo giờ máy. */
function timestamp(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function formatFields(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
}

/**
 * Logger tối giản, in kèm trace_id / span_id của span đang active.
 * Copy trace_id từ terminal rồi dán vào ô tìm kiếm của Jaeger để mở đúng trace.
 * Đây là "log correlation" ở mức thủ công. Production thường dùng pino/winston cùng
 * instrumentation tương ứng để tự gắn các trường này.
 *
 * @param {string} serviceName
 * @param {(line: string) => void} [write] mặc định in ra stdout; test truyền hàm riêng để bắt output
 */
function createLogger(serviceName, write = (line) => process.stdout.write(`${line}\n`)) {
  function log(level, message, fields = {}) {
    const spanContext = trace.getActiveSpan()?.spanContext();
    const ids = spanContext ? { trace_id: spanContext.traceId, span_id: spanContext.spanId } : {};
    const tail = formatFields({ ...fields, ...ids });
    write(`${timestamp()} ${level.padEnd(5)} [${serviceName}] ${message}${tail ? ` ${tail}` : ''}`);
  }
  return {
    info: (message, fields) => log('INFO', message, fields),
    warn: (message, fields) => log('WARN', message, fields),
    error: (message, fields) => log('ERROR', message, fields),
  };
}

module.exports = { createLogger };
```

- [ ] **Step 9: Viết `src/shared/messaging.js`**

```js
'use strict';

/**
 * Hằng số dùng chung cho producer (order-service) và consumer (notification-worker).
 *
 * Attribute messaging.* vẫn ở mức incubating trong @opentelemetry/semantic-conventions 1.43.
 * OpenTelemetry khuyên CHÉP hằng số incubating vào code thay vì import từ entry
 * '@opentelemetry/semantic-conventions/incubating', vì entry đó có thể đổi hoặc xoá giữa các bản minor.
 */
module.exports = {
  QUEUE_NAME: 'order-events',
  ATTR_MESSAGING_SYSTEM: 'messaging.system',
  ATTR_MESSAGING_DESTINATION_NAME: 'messaging.destination.name',
  ATTR_MESSAGING_OPERATION_TYPE: 'messaging.operation.type',
  ATTR_MESSAGING_OPERATION_NAME: 'messaging.operation.name',
  ATTR_MESSAGING_MESSAGE_ID: 'messaging.message.id',
};
```

- [ ] **Step 10: Chạy test để thấy PASS**

Run: `npm test`
Expected: `# fail 0`. Tổng số test pass là 19: 5 của `jaeger`, 6 của `tracer`, 6 của `propagation`, 2 của `logger`.

- [ ] **Step 11: Commit**

```bash
git add test/helpers/otel.js test/unit/tracer.test.js test/unit/propagation.test.js test/unit/logger.test.js src/shared/tracer.js src/shared/propagation.js src/shared/logger.js src/shared/messaging.js
git commit -F - <<'EOF'
148_opentelemetry_tracing: add shared tracing helpers with unit tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 4: `src/tracing.js` (khởi tạo SDK) và test tích hợp

**Files:**
- Create: `test/integration/fixtures/emit-span.js`
- Create: `test/integration/tracing.test.js`
- Create: `src/tracing.js`

**Interfaces:**
- Consumes: `waitForTrace` từ `scripts/lib/jaeger.js` (Task 2). Hạ tầng của Task 1 phải đang chạy.
- Produces: `src/tracing.js`, nạp bằng `node --require ./src/tracing.js <entry>`. Export `{ sdk: NodeSDK }`. Khi khởi động in `[otel] tracing đã bật: service=<name> export=<endpoint>`. Tự flush và thoát khi nhận SIGINT hoặc SIGTERM.

- [ ] **Step 1: Viết fixture chạy dưới `--require`**

`test/integration/fixtures/emit-span.js`:

```js
'use strict';

/**
 * Chạy dưới `node --require ./src/tracing.js` (xem test/integration/tracing.test.js):
 * tạo một span, in trace id, rồi tắt SDK để flush ngay thay vì đợi lô 5 giây.
 */
const { trace } = require('@opentelemetry/api');
const { sdk } = require('../../../src/tracing'); // cùng module đã nạp qua --require (lấy từ cache)

const span = trace.getTracer('integration-test').startSpan('smoke-span');
span.end();
console.log(`TRACE_ID=${span.spanContext().traceId}`);

sdk
  .shutdown()
  .catch((err) => console.error(`[emit-span] export thất bại: ${err.message}`))
  .finally(() => process.exit(0));
```

- [ ] **Step 2: Viết test tích hợp, sẽ FAIL**

`test/integration/tracing.test.js`:

```js
'use strict';

/**
 * Test tích hợp cho src/tracing.js. Hai test đầu cần hạ tầng đang chạy: `npm run infra:up`.
 * Chạy: npm run test:integration
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { waitForTrace } = require('../../scripts/lib/jaeger');

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, '..', '..');

/** Chạy emit-span.js dưới --require ./src/tracing.js, trả về trace id nó in ra. */
async function emitSpan(extraEnv = {}) {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--require', './src/tracing.js', 'test/integration/fixtures/emit-span.js'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: '',
        OTEL_SERVICE_NAME: 'tracing-smoke-test',
        OTEL_RESOURCE_ATTRIBUTES: '',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
        ...extraEnv,
      },
      timeout: 30000,
    }
  );
  const match = stdout.match(/TRACE_ID=([0-9a-f]{32})/);
  assert.ok(match, `Không thấy TRACE_ID trong output:\n${stdout}`);
  return match[1];
}

const hasSmokeSpan = (spans) => spans.some((s) => s.name === 'smoke-span');

test('span đi qua Collector tới Jaeger, kèm resource attributes khai báo trong code', async () => {
  const traceId = await emitSpan();
  const spans = await waitForTrace(traceId, hasSmokeSpan);
  const span = spans.find((s) => s.name === 'smoke-span');
  assert.ok(span, `Jaeger không có trace ${traceId}. Hạ tầng đã chạy chưa (npm run infra:up)?`);
  assert.equal(span.service, 'tracing-smoke-test');
  assert.equal(span.resource['service.version'], '1.0.0');
  assert.equal(span.resource['service.namespace'], 'shop');
  assert.equal(span.resource['deployment.environment.name'], 'development');
  assert.match(String(span.resource['service.instance.id']), /^[0-9a-f-]{36}$/);
  // Có mặt nhờ merge với defaultResource()
  assert.equal(span.resource['telemetry.sdk.language'], 'nodejs');
});

test('OTEL_RESOURCE_ATTRIBUTES ghi đè giá trị khai báo trong code', async () => {
  const traceId = await emitSpan({
    OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=staging,team.name=platform',
  });
  const spans = await waitForTrace(traceId, hasSmokeSpan);
  const span = spans.find((s) => s.name === 'smoke-span');
  assert.ok(span, `Jaeger không có trace ${traceId}`);
  assert.equal(span.resource['deployment.environment.name'], 'staging');
  assert.equal(span.resource['team.name'], 'platform');
});

test('Collector không chạy: tiến trình vẫn chạy xong, không crash', async () => {
  const traceId = await emitSpan({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1', // cổng không có ai nghe
    OTEL_EXPORTER_OTLP_TIMEOUT: '2000',
  });
  assert.match(traceId, /^[0-9a-f]{32}$/);
});
```

- [ ] **Step 3: Chạy test để thấy FAIL**

Run: `npm run test:integration`
Expected: FAIL. Tiến trình con báo `Cannot find module './src/tracing.js'`.

- [ ] **Step 4: Viết `src/tracing.js`**

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

- [ ] **Step 5: Chạy test tích hợp để thấy PASS**

Run: `npm run infra:up && npm run test:integration`
Expected: `# pass 3`, `# fail 0`. Test thứ ba có thể in cảnh báo export lỗi ra stderr; đó là hành vi đúng.

- [ ] **Step 6: Chạy lại unit test để chắc không ảnh hưởng**

Run: `npm test`
Expected: `# fail 0` (19 test pass).

- [ ] **Step 7: Commit**

```bash
git add test/integration/fixtures/emit-span.js test/integration/tracing.test.js src/tracing.js
git commit -F - <<'EOF'
148_opentelemetry_tracing: add SDK bootstrap (tracing.js) with integration tests

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 5: Kịch bản demo và kiểm thử end-to-end (viết trước, phải FAIL)

**Files:**
- Create: `scripts/lib/scenarios.js`
- Create: `scripts/verify-traces.js`

**Interfaces:**
- Consumes: `JAEGER_URL`, `waitForTrace`, `getOperations`, `formatTree` từ `scripts/lib/jaeger.js` (Task 2).
- Produces:
  - `scripts/lib/scenarios.js`: `GATEWAY_URL: string` (env `GATEWAY_URL`, mặc định `http://localhost:3000`), `SCENARIOS: Array<{ id: 'success'|'payment-failed'|'invalid', title: string, body: object, expectedStatus: number }>`, `sendScenario(scenario, gatewayUrl?): Promise<{ status: number, body: object }>`.
  - `scripts/verify-traces.js`: in PASS/FAIL từng check. Tất cả PASS thì exit 0, còn lại exit 1. Đọc env `GATEWAY_URL`, `ORDER_SERVICE_URL` (mặc định `http://localhost:3001`), `JAEGER_URL`, `VERIFY_READY_TIMEOUT_MS` (mặc định 30000).

- [ ] **Step 1: Viết `scripts/lib/scenarios.js`**

```js
'use strict';

/** 3 kịch bản demo (spec mục 2.3), dùng chung cho demo.js và verify-traces.js. */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

const SCENARIOS = [
  {
    id: 'success',
    title: 'Đơn hợp lệ, khách VIP',
    // tổng tiền: 2 x 350.000 + 1 x 120.000 = 820.000
    body: {
      customerId: 'VIP-001',
      items: [
        { sku: 'SERUM-01', qty: 2 },
        { sku: 'MASK-03', qty: 1 },
      ],
      paymentMethod: 'card',
    },
    expectedStatus: 201,
  },
  {
    id: 'payment-failed',
    title: 'Thẻ hết hạn',
    body: { customerId: 'C-002', items: [{ sku: 'TONER-02', qty: 1 }], paymentMethod: 'expired_card' },
    expectedStatus: 502,
  },
  {
    id: 'invalid',
    title: 'Đơn không có sản phẩm',
    body: { customerId: 'C-003', items: [], paymentMethod: 'card' },
    expectedStatus: 400,
  },
];

/** Gửi một kịch bản tới gateway, trả về { status, body }. */
async function sendScenario(scenario, gatewayUrl = GATEWAY_URL) {
  const res = await fetch(`${gatewayUrl}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(scenario.body),
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

module.exports = { GATEWAY_URL, SCENARIOS, sendScenario };
```

- [ ] **Step 2: Viết `scripts/verify-traces.js`**

```js
'use strict';

/**
 * Kiểm thử end-to-end (spec mục 6.1): gửi request thật qua gateway rồi hỏi Jaeger xem trace
 * có đúng như thiết kế không.
 *
 * Yêu cầu: `npm run infra:up` và `npm start` (hoặc `npm run start:direct`) đang chạy.
 * Chạy:    npm run verify
 */

const { JAEGER_URL, waitForTrace, getOperations, formatTree } = require('./lib/jaeger');
const { GATEWAY_URL, SCENARIOS, sendScenario } = require('./lib/scenarios');

const ORDER_SERVICE_URL = process.env.ORDER_SERVICE_URL || 'http://localhost:3001';
const READY_TIMEOUT_MS = Number(process.env.VERIFY_READY_TIMEOUT_MS) || 30000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// [service, tên span, kind] mà trace của đơn thành công phải có (spec mục 2.2).
const SUCCESS_SPANS = [
  ['api-gateway', 'POST /orders', 'SERVER'],
  ['api-gateway', 'POST', 'CLIENT'],
  ['order-service', 'POST /orders', 'SERVER'],
  ['order-service', 'order.validate', 'INTERNAL'],
  ['order-service', 'inventory.reserve', 'INTERNAL'],
  ['order-service', 'payment.charge', 'INTERNAL'],
  ['order-service', 'send order-events', 'PRODUCER'],
  ['order-service', 'lpush', 'CLIENT'],
  ['notification-worker', 'process order-events', 'CONSUMER'],
  ['notification-worker', 'email.send', 'INTERNAL'],
];
const GATEWAY_SERVER = ['api-gateway', 'POST /orders', 'SERVER'];
const GATEWAY_CLIENT = ['api-gateway', 'POST', 'CLIENT'];
const ORDER_SERVER = ['order-service', 'POST /orders', 'SERVER'];

const results = [];
function check(scenario, description, ok, detail = '') {
  results.push({ scenario, description, ok: Boolean(ok), detail });
}

const find = (spans, [service, name, kind]) =>
  spans.find((s) => s.service === service && s.name === name && (!kind || s.kind === kind));
const hasAll = (spans, list) => list.every((entry) => find(spans, entry));
const hasException = (span) => Boolean(span?.events.some((e) => e.name === 'exception'));

async function waitForHealthy(baseUrl) {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/health`, { signal: AbortSignal.timeout(2000) });
      if (res.ok) return true;
    } catch {
      // service chưa lên, thử lại
    }
    await sleep(500);
  }
  return false;
}

function checkSuccess(res, spans) {
  const s = 'success';
  check(s, 'HTTP 201', res.status === 201, `nhận ${res.status}`);
  for (const entry of SUCCESS_SPANS) {
    const [service, name, kind] = entry;
    check(s, `có span ${service} / ${name} (${kind})`, find(spans, entry), 'thiếu');
  }
  const services = new Set(spans.map((x) => x.service));
  check(
    s,
    'trace đi qua đủ 3 service',
    ['api-gateway', 'order-service', 'notification-worker'].every((x) => services.has(x)),
    [...services].join(', ')
  );
  const producer = find(spans, ['order-service', 'send order-events', 'PRODUCER']);
  const consumer = find(spans, ['notification-worker', 'process order-events', 'CONSUMER']);
  check(s, 'span cha của process order-events là send order-events', producer && consumer?.parentSpanId === producer.spanId);
  const validate = find(spans, ['order-service', 'order.validate']);
  check(
    s,
    'customer.tier = gold trên order.validate (baggage đi qua HTTP)',
    validate?.attributes['customer.tier'] === 'gold',
    String(validate?.attributes['customer.tier'])
  );
  check(
    s,
    'customer.tier = gold trên process order-events (baggage đi qua Redis)',
    consumer?.attributes['customer.tier'] === 'gold',
    String(consumer?.attributes['customer.tier'])
  );
  for (const service of ['api-gateway', 'order-service', 'notification-worker']) {
    const span = spans.find((x) => x.service === service);
    check(
      s,
      `resource của ${service} có service.namespace=shop và deployment.environment.name`,
      span?.resource['service.namespace'] === 'shop' && Boolean(span?.resource['deployment.environment.name'])
    );
  }
  const errors = spans.filter((x) => x.status === 'ERROR');
  check(s, 'không span nào ERROR', errors.length === 0, errors.map((x) => x.name).join(', '));
}

function checkPaymentFailed(res, spans) {
  const s = 'payment-failed';
  check(s, 'HTTP 502', res.status === 502, `nhận ${res.status}`);
  const charge = find(spans, ['order-service', 'payment.charge']);
  check(s, 'payment.charge có status ERROR', charge?.status === 'ERROR');
  check(s, 'payment.charge có error.type = CARD_EXPIRED', charge?.attributes['error.type'] === 'CARD_EXPIRED');
  check(s, 'payment.charge có event exception', hasException(charge));
  check(s, 'span SERVER của order-service ERROR (5xx)', find(spans, ORDER_SERVER)?.status === 'ERROR');
  check(
    s,
    'span CLIENT và span SERVER ở gateway ERROR',
    find(spans, GATEWAY_CLIENT)?.status === 'ERROR' && find(spans, GATEWAY_SERVER)?.status === 'ERROR'
  );
  check(s, 'không có span send order-events', !find(spans, ['order-service', 'send order-events']));
}

function checkInvalid(res, spans) {
  const s = 'invalid';
  check(s, 'HTTP 400', res.status === 400, `nhận ${res.status}`);
  const validate = find(spans, ['order-service', 'order.validate']);
  check(s, 'order.validate có status ERROR và event exception', validate?.status === 'ERROR' && hasException(validate));
  const orderServer = find(spans, ORDER_SERVER);
  const gatewayServer = find(spans, GATEWAY_SERVER);
  check(
    s,
    'span SERVER của order-service và gateway KHÔNG ERROR (4xx là lỗi phía client)',
    orderServer && orderServer.status !== 'ERROR' && gatewayServer && gatewayServer.status !== 'ERROR'
  );
  check(s, 'span CLIENT ở gateway ERROR (client span: >= 400 là lỗi)', find(spans, GATEWAY_CLIENT)?.status === 'ERROR');
}

// Trace coi như "đủ" khi đã có các span mà bước kiểm tra cần (mỗi service flush độc lập).
const COMPLETE = {
  success: (spans) => hasAll(spans, SUCCESS_SPANS),
  'payment-failed': (spans) =>
    hasAll(spans, [GATEWAY_SERVER, GATEWAY_CLIENT, ORDER_SERVER, ['order-service', 'payment.charge']]),
  invalid: (spans) => hasAll(spans, [GATEWAY_SERVER, GATEWAY_CLIENT, ORDER_SERVER, ['order-service', 'order.validate']]),
};
const CHECKS = { success: checkSuccess, 'payment-failed': checkPaymentFailed, invalid: checkInvalid };

async function main() {
  console.log(`Gateway: ${GATEWAY_URL}   Jaeger: ${JAEGER_URL}\n`);
  for (const url of [GATEWAY_URL, ORDER_SERVICE_URL]) {
    if (!(await waitForHealthy(url))) {
      console.error(`FAIL  ${url}/health không phản hồi sau ${READY_TIMEOUT_MS / 1000}s. Đã chạy "npm start" chưa?`);
      process.exit(1);
    }
  }

  // Gửi /health TRƯỚC: lúc kiểm tra operation ở cuối (sau khi đã chờ các trace khác), span của
  // /health nếu có thì chắc chắn đã được flush lên Jaeger.
  const health = await fetch(`${GATEWAY_URL}/health`);
  check('health', 'HTTP 200', health.status === 200, `nhận ${health.status}`);

  const sent = [];
  for (const scenario of SCENARIOS) {
    sent.push({ scenario, res: await sendScenario(scenario) });
  }

  let successSpans = [];
  for (const { scenario, res } of sent) {
    const traceId = res.body.traceId;
    if (!traceId) {
      check(scenario.id, 'response có traceId', false, JSON.stringify(res.body));
      continue;
    }
    console.log(`... chờ trace ${scenario.id}: ${JAEGER_URL}/trace/${traceId}`);
    const spans = await waitForTrace(traceId, COMPLETE[scenario.id]);
    CHECKS[scenario.id](res, spans);
    if (scenario.id === 'success') successSpans = spans;
  }

  const getOperationNames = (await getOperations('api-gateway')).filter((name) => name.startsWith('GET'));
  check('health', 'Jaeger không có operation GET nào của api-gateway', getOperationNames.length === 0, getOperationNames.join(', '));

  console.log('');
  for (const r of results) {
    const detail = !r.ok && r.detail ? `  (${r.detail})` : '';
    console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.scenario.padEnd(15)} ${r.description}${detail}`);
  }
  const passed = results.filter((r) => r.ok).length;
  console.log(`\nKết quả: ${passed}/${results.length} check PASS`);
  if (successSpans.length > 0) {
    console.log('\nCây span của đơn thành công (lấy từ Jaeger):\n');
    console.log(formatTree(successSpans));
  }
  process.exit(passed === results.length ? 0 : 1);
}

main().catch((err) => {
  console.error(`Lỗi: ${err.message}`);
  process.exit(1);
});
```

- [ ] **Step 3: Chạy verify khi chưa có service, phải FAIL đúng cách**

Run: `VERIFY_READY_TIMEOUT_MS=3000 npm run verify; echo "exit=$?"`
Expected: sau dòng `Gateway: http://localhost:3000   Jaeger: http://localhost:16686` là:
```
FAIL  http://localhost:3000/health không phản hồi sau 3s. Đã chạy "npm start" chưa?
exit=1
```

- [ ] **Step 4: Kiểm tra cú pháp và unit test không bị ảnh hưởng**

Run: `node --check scripts/verify-traces.js && node --check scripts/lib/scenarios.js && npm test`
Expected: không có lỗi cú pháp, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add scripts/lib/scenarios.js scripts/verify-traces.js
git commit -F - <<'EOF'
148_opentelemetry_tracing: add end-to-end trace verification script

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 6: order-service (custom span, ghi lỗi, inject context vào Redis)

**Files:**
- Create: `test/unit/order-service.test.js`
- Create: `src/shared/http.js`
- Create: `src/order-service/catalog.js`
- Create: `src/order-service/errors.js`
- Create: `src/order-service/steps.js`
- Create: `src/order-service/server.js`

**Interfaces:**
- Consumes: `tracer`, `withSpan` (Task 3), `injectContext`, `getBaggageValue` (Task 3), `createLogger` (Task 3), hằng số trong `src/shared/messaging.js` (Task 3). Helper test `setupTestTracing`, `findSpan` (Task 3).
- Produces:
  - `src/shared/http.js`: `currentTraceId(): string|undefined`, `errorHandler(log): express.ErrorRequestHandler`. Lỗi có `status` 4xx trả `{ error: 'BAD_REQUEST', message, traceId }` với status đó. Lỗi còn lại trả 500 `{ error: 'INTERNAL_ERROR', message, traceId }`.
  - `src/order-service/catalog.js`: `findProduct(sku): { sku, name, price, stock } | undefined`.
  - `src/order-service/errors.js`: `AppError` (có `status`, `code`), `ValidationError(message)` (400, `VALIDATION_ERROR`), `PaymentError(message, code = 'PAYMENT_FAILED')` (502).
  - `src/order-service/steps.js`: `validateOrder(order, { customerTier }?) -> Promise<{ lines, total }>`, `reserveInventory(lines) -> Promise<void>`, `chargePayment({ method, amount }) -> Promise<{ transactionId }>`, `publishOrderCreated(redis, payload) -> Promise<message>`.
  - `src/order-service/server.js`: `createApp({ redis }) -> express.Application`. Khi chạy làm entry thì listen trên `PORT` (mặc định 3001) và nối Redis `REDIS_URL` (mặc định `redis://localhost:16379`).

- [ ] **Step 1: Viết test, sẽ FAIL**

`test/unit/order-service.test.js`:

```js
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { SpanKind, SpanStatusCode } = require('@opentelemetry/api');
const { setupTestTracing, findSpan } = require('../helpers/otel');
const { createApp } = require('../../src/order-service/server');

let exporter;
beforeEach(() => {
  exporter = setupTestTracing();
});

/** Redis giả, chỉ cần lpush. `fail: true` giả lập Redis mất kết nối. */
function fakeRedis({ fail = false } = {}) {
  const pushed = [];
  return {
    pushed,
    async lpush(key, value) {
      if (fail) throw new Error('Connection is closed.');
      pushed.push({ key, message: JSON.parse(value) });
      return pushed.length;
    },
  };
}

/** Bật app trên cổng ngẫu nhiên, gửi 1 request, tắt app. */
async function request(app, { method = 'POST', path = '/orders', body, raw } = {}) {
  const server = app.listen(0);
  await once(server, 'listening');
  try {
    const res = await fetch(`http://127.0.0.1:${server.address().port}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : raw ?? JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    server.close();
    server.closeAllConnections();
  }
}

const VALID_ORDER = {
  customerId: 'VIP-001',
  items: [
    { sku: 'SERUM-01', qty: 2 },
    { sku: 'MASK-03', qty: 1 },
  ],
  paymentMethod: 'card',
};

const spanNames = () => exporter.getFinishedSpans().map((s) => s.name);

test('đơn hợp lệ -> 201, tổng 820.000, đủ 4 custom span ở trạng thái UNSET', async () => {
  const res = await request(createApp({ redis: fakeRedis() }), { body: VALID_ORDER });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'CONFIRMED');
  assert.equal(res.body.total, 820000);
  assert.match(res.body.orderId, /^ORD-\d+$/);
  for (const name of ['order.validate', 'inventory.reserve', 'payment.charge', 'send order-events']) {
    assert.equal(findSpan(name).status.code, SpanStatusCode.UNSET, `${name} phải UNSET`);
  }
  const validate = findSpan('order.validate');
  assert.equal(validate.attributes['customer.id'], 'VIP-001');
  assert.equal(validate.attributes['order.item_count'], 2);
  // Unit test không có instrumentation http nên không có baggage từ header -> 'unknown'
  assert.equal(validate.attributes['customer.tier'], 'unknown');
  const reserved = findSpan('inventory.reserve').events.filter((e) => e.name === 'stock.reserved');
  assert.deepEqual(reserved.map((e) => e.attributes), [
    { sku: 'SERUM-01', qty: 2 },
    { sku: 'MASK-03', qty: 1 },
  ]);
  const charge = findSpan('payment.charge');
  assert.equal(charge.attributes['payment.method'], 'card');
  assert.equal(charge.attributes['payment.amount'], 820000);
  assert.match(charge.attributes['payment.transaction_id'], /^TXN-[0-9A-F]{8}$/);
});

test('message gửi vào Redis mang traceparent của span PRODUCER', async () => {
  const redis = fakeRedis();
  await request(createApp({ redis }), { body: VALID_ORDER });
  assert.equal(redis.pushed.length, 1);
  const { key, message } = redis.pushed[0];
  assert.equal(key, 'order-events');
  assert.equal(message.type, 'order.created');
  assert.match(message.id, /^msg-/);
  assert.ok(!Number.isNaN(Date.parse(message.publishedAt)));
  assert.deepEqual(message.payload, {
    orderId: message.payload.orderId,
    customerId: 'VIP-001',
    total: 820000,
    itemCount: 2,
  });

  const producer = findSpan('send order-events');
  assert.equal(producer.kind, SpanKind.PRODUCER);
  assert.equal(producer.attributes['messaging.system'], 'redis');
  assert.equal(producer.attributes['messaging.destination.name'], 'order-events');
  assert.equal(producer.attributes['messaging.operation.type'], 'send');
  assert.equal(producer.attributes['messaging.operation.name'], 'send');
  assert.equal(producer.attributes['messaging.message.id'], message.id);
  const { traceId, spanId } = producer.spanContext();
  assert.equal(message.headers.traceparent, `00-${traceId}-${spanId}-01`);
});

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

const INVALID_CASES = [
  ['đơn không có sản phẩm', { ...VALID_ORDER, items: [] }, /ít nhất 1 sản phẩm/],
  ['SKU không tồn tại', { ...VALID_ORDER, items: [{ sku: 'NOPE-99', qty: 1 }] }, /không tồn tại: NOPE-99/],
  ['qty vượt tồn kho', { ...VALID_ORDER, items: [{ sku: 'TONER-02', qty: 31 }] }, /tồn kho 30/],
  ['qty không phải số nguyên', { ...VALID_ORDER, items: [{ sku: 'TONER-02', qty: '2' }] }, /Số lượng không hợp lệ/],
  ['thiếu customerId', { ...VALID_ORDER, customerId: undefined }, /customerId là bắt buộc/],
  ['thiếu paymentMethod', { ...VALID_ORDER, paymentMethod: '' }, /paymentMethod là bắt buộc/],
];

for (const [label, order, messagePattern] of INVALID_CASES) {
  test(`${label} -> 400 VALIDATION_ERROR, order.validate ERROR, không thanh toán`, async () => {
    const redis = fakeRedis();
    const res = await request(createApp({ redis }), { body: order });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'VALIDATION_ERROR');
    assert.match(res.body.message, messagePattern);
    const validate = findSpan('order.validate');
    assert.equal(validate.status.code, SpanStatusCode.ERROR);
    assert.equal(validate.attributes['error.type'], 'VALIDATION_ERROR');
    assert.ok(validate.events.some((e) => e.name === 'exception'));
    assert.ok(!spanNames().includes('payment.charge'), 'không được thanh toán khi đơn sai');
    assert.equal(redis.pushed.length, 0);
  });
}

test('body JSON sai cú pháp -> 400 BAD_REQUEST (không phải 500)', async () => {
  const res = await request(createApp({ redis: fakeRedis() }), { raw: '{"customerId":' });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, 'BAD_REQUEST');
});

test('Redis lỗi -> 500 INTERNAL_ERROR, span send order-events ERROR', async () => {
  const res = await request(createApp({ redis: fakeRedis({ fail: true }) }), { body: VALID_ORDER });
  assert.equal(res.status, 500);
  assert.equal(res.body.error, 'INTERNAL_ERROR');
  const producer = findSpan('send order-events');
  assert.equal(producer.status.code, SpanStatusCode.ERROR);
  assert.equal(producer.status.message, 'Connection is closed.');
});

test('GET /health -> 200', async () => {
  const res = await request(createApp({ redis: fakeRedis() }), { method: 'GET', path: '/health' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});
```

- [ ] **Step 2: Chạy test để thấy FAIL**

Run: `npm test`
Expected: FAIL với `Cannot find module '../../src/order-service/server'`.

- [ ] **Step 3: Viết `src/shared/http.js`**

```js
'use strict';

const { trace } = require('@opentelemetry/api');

/** trace_id của trace hiện tại. Không có span active (ví dụ chạy test không có SDK) thì trả undefined. */
function currentTraceId() {
  return trace.getActiveSpan()?.spanContext().traceId;
}

/**
 * Error middleware dùng chung. Chỉ nhận lỗi đi qua next(err): lỗi phân tích body
 * (express.json() gắn sẵn status 400) hoặc lỗi bất ngờ (500).
 * Lỗi nghiệp vụ đã biết được route tự trả response, không đi qua đây.
 */
function errorHandler(log) {
  // Express nhận ra error middleware nhờ đủ 4 tham số, nên phải giữ `next` dù không dùng.
  return (err, req, res, next) => {
    const isClientError = Number.isInteger(err.status) && err.status >= 400 && err.status < 500;
    const status = isClientError ? err.status : 500;
    log[isClientError ? 'warn' : 'error']('request lỗi', { status, reason: err.message });
    res.status(status).json({
      error: isClientError ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      message: err.message,
      traceId: currentTraceId(),
    });
  };
}

module.exports = { currentTraceId, errorHandler };
```

- [ ] **Step 4: Viết `src/order-service/catalog.js`**

```js
'use strict';

/** Danh mục sản phẩm trong bộ nhớ, thay cho database để ví dụ tập trung vào tracing. */
const PRODUCTS = new Map([
  ['SERUM-01', { sku: 'SERUM-01', name: 'Serum vitamin C', price: 350000, stock: 50 }],
  ['TONER-02', { sku: 'TONER-02', name: 'Toner hoa hồng', price: 180000, stock: 30 }],
  ['MASK-03', { sku: 'MASK-03', name: 'Mặt nạ đất sét', price: 120000, stock: 100 }],
]);

/** @returns {{ sku: string, name: string, price: number, stock: number } | undefined} */
function findProduct(sku) {
  return PRODUCTS.get(sku);
}

module.exports = { findProduct };
```

- [ ] **Step 5: Viết `src/order-service/errors.js`**

```js
'use strict';

/**
 * Lỗi nghiệp vụ "đã biết": mang sẵn HTTP status và một mã lỗi ổn định.
 * Mã lỗi (`code`) được dùng làm error.type trên span, và SDK cũng dùng nó làm exception.type.
 */
class AppError extends Error {
  constructor(message, { status, code }) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

/** Dữ liệu đơn hàng sai: lỗi phía client. */
class ValidationError extends AppError {
  constructor(message) {
    super(message, { status: 400, code: 'VALIDATION_ERROR' });
  }
}

/** Cổng thanh toán từ chối: lỗi ở dịch vụ phía sau, nên trả 502. */
class PaymentError extends AppError {
  constructor(message, code = 'PAYMENT_FAILED') {
    super(message, { status: 502, code });
  }
}

module.exports = { AppError, ValidationError, PaymentError };
```

- [ ] **Step 6: Viết `src/order-service/steps.js`**

```js
'use strict';

const { randomUUID } = require('node:crypto');
const { SpanKind, SpanStatusCode } = require('@opentelemetry/api');
const { ATTR_ERROR_TYPE } = require('@opentelemetry/semantic-conventions');
const { tracer, withSpan } = require('../shared/tracer');
const { injectContext } = require('../shared/propagation');
const {
  QUEUE_NAME,
  ATTR_MESSAGING_SYSTEM,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_OPERATION_TYPE,
  ATTR_MESSAGING_OPERATION_NAME,
  ATTR_MESSAGING_MESSAGE_ID,
} = require('../shared/messaging');
const { findProduct } = require('./catalog');
const { ValidationError, PaymentError } = require('./errors');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Độ trễ giả 20–80 ms để span có độ dài dễ nhìn trong Jaeger.
const simulateLatency = () => sleep(20 + Math.floor(Math.random() * 60));

/**
 * Bước 1: kiểm tra đơn hàng. Dữ liệu sai thì ném ValidationError (400).
 * @param {object} order body của request
 * @param {{ customerTier?: string }} [options] hạng khách lấy từ baggage
 * @returns {Promise<{ lines: Array<{ sku: string, name: string, price: number, qty: number }>, total: number }>}
 */
function validateOrder(order, { customerTier } = {}) {
  const attributes = {
    'customer.id': String(order?.customerId ?? ''),
    'customer.tier': customerTier || 'unknown',
    'order.item_count': Array.isArray(order?.items) ? order.items.length : 0,
  };
  return withSpan('order.validate', { attributes }, async () => {
    await simulateLatency();
    if (typeof order?.customerId !== 'string' || order.customerId.trim() === '') {
      throw new ValidationError('customerId là bắt buộc');
    }
    if (typeof order.paymentMethod !== 'string' || order.paymentMethod.trim() === '') {
      throw new ValidationError('paymentMethod là bắt buộc');
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
      throw new ValidationError('Đơn hàng phải có ít nhất 1 sản phẩm');
    }
    const lines = order.items.map((item) => {
      const product = findProduct(item?.sku);
      if (!product) {
        throw new ValidationError(`Sản phẩm không tồn tại: ${item?.sku}`);
      }
      if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > product.stock) {
        throw new ValidationError(`Số lượng không hợp lệ cho ${product.sku}: ${item.qty} (tồn kho ${product.stock})`);
      }
      return { sku: product.sku, name: product.name, price: product.price, qty: item.qty };
    });
    const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
    return { lines, total };
  });
}

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

module.exports = { validateOrder, reserveInventory, chargePayment, publishOrderCreated };
```

- [ ] **Step 7: Viết `src/order-service/server.js`**

```js
'use strict';

const express = require('express');
const Redis = require('ioredis');
const { createLogger } = require('../shared/logger');
const { getBaggageValue } = require('../shared/propagation');
const { currentTraceId, errorHandler } = require('../shared/http');
const { AppError } = require('./errors');
const { validateOrder, reserveInventory, chargePayment, publishOrderCreated } = require('./steps');

const log = createLogger('order-service');

/**
 * Tạo Express app. `redis` được truyền vào (thay vì tạo bên trong) để unit test dùng Redis giả.
 * @param {{ redis: { lpush(key: string, value: string): Promise<number> } }} deps
 */
function createApp({ redis }) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/orders', async (req, res) => {
    const order = req.body;
    // Baggage do gateway gắn, đi theo header `baggage`. Instrumentation http đã đọc sẵn vào context.
    const customerTier = getBaggageValue('customer.tier');
    try {
      const { lines, total } = await validateOrder(order, { customerTier });
      await reserveInventory(lines);
      const { transactionId } = await chargePayment({ method: order.paymentMethod, amount: total });
      const orderId = `ORD-${Date.now()}`;
      await publishOrderCreated(redis, { orderId, customerId: order.customerId, total, itemCount: lines.length });
      log.info('đã xác nhận đơn', { orderId, total, transactionId });
      res.status(201).json({ orderId, status: 'CONFIRMED', total, traceId: currentTraceId() });
    } catch (err) {
      // Lỗi bất ngờ (ví dụ Redis mất kết nối): ném tiếp cho errorHandler, trả 500.
      if (!(err instanceof AppError)) throw err;
      // Lỗi nghiệp vụ đã biết: trả response ngay tại đây. Nếu đẩy qua next(err), instrumentation
      // express sẽ đánh dấu cả span "request handler" là ERROR, kể cả với lỗi 400.
      log.warn('từ chối đơn', { code: err.code, reason: err.message });
      res.status(err.status).json({ error: err.code, message: err.message, traceId: currentTraceId() });
    }
  });

  app.use(errorHandler(log));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3001;
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:16379';
  // maxRetriesPerRequest: 1 -> Redis chết thì request lỗi nhanh (500) thay vì treo chờ kết nối lại.
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  redis.on('error', (err) => log.error('lỗi Redis', { reason: err.message }));
  createApp({ redis }).listen(port, () => log.info(`đang nghe http://localhost:${port}`, { redis: redisUrl }));
}

module.exports = { createApp };
```

- [ ] **Step 8: Chạy test để thấy PASS**

Run: `npm test`
Expected: `# fail 0`. Tổng 31 test pass: 19 cũ và 12 mới gồm 3 test chính, 6 test validation, JSON sai, Redis lỗi, health.

- [ ] **Step 9: Smoke test với Redis thật và tracing thật**

Chạy nền: `npm run start:order` (Bash `run_in_background: true`, hoặc mở terminal riêng). Sau đó:

```bash
for i in $(seq 1 20); do curl -sf -o /dev/null http://localhost:3001/health && break; sleep 1; done
curl -s -X POST http://localhost:3001/orders -H 'content-type: application/json' -d '{"customerId":"VIP-001","items":[{"sku":"SERUM-01","qty":2},{"sku":"MASK-03","qty":1}],"paymentMethod":"card"}'; echo
curl -s -X POST http://localhost:3001/orders -H 'content-type: application/json' -d '{"customerId":"C-002","items":[{"sku":"TONER-02","qty":1}],"paymentMethod":"expired_card"}'; echo
docker compose exec -T redis redis-cli LLEN order-events
```

Expected:
- `{"orderId":"ORD-...","status":"CONFIRMED","total":820000,"traceId":"<32 hex>"}`
- `{"error":"CARD_EXPIRED","message":"Thẻ đã hết hạn","traceId":"<32 hex>"}`
- `(integer) 1` hoặc lớn hơn (chưa có worker tiêu thụ).
- Log của service có dòng `[otel] tracing đã bật: service=order-service export=http://localhost:4318`.

Dừng service (PowerShell):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'tracing\.js.*src[\\/](api-gateway|order-service|notification-worker)[\\/]' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "stopped $($_.ProcessId)" }
```

Xoá message thử khỏi hàng đợi, để Task 8 không gặp message cũ: `docker compose exec -T redis redis-cli DEL order-events`

- [ ] **Step 10: Commit**

```bash
git add test/unit/order-service.test.js src/shared/http.js src/order-service/catalog.js src/order-service/errors.js src/order-service/steps.js src/order-service/server.js
git commit -F - <<'EOF'
148_opentelemetry_tracing: add order-service with custom spans

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 7: api-gateway (auto-instrument HTTP, baggage)

**Files:**
- Create: `test/unit/api-gateway.test.js`
- Create: `src/api-gateway/server.js`

**Interfaces:**
- Consumes: `withBaggage` (Task 3), `createLogger` (Task 3), `currentTraceId`, `errorHandler` (Task 6). Helper test `setupTestTracing` (Task 3).
- Produces: `createApp({ orderServiceUrl }?) -> express.Application`, `customerTierOf(customerId): 'gold'|'standard'`. Khi chạy làm entry thì listen trên `PORT` (mặc định 3000), gọi `ORDER_SERVICE_URL` (mặc định `http://localhost:3001`).

- [ ] **Step 1: Viết test, sẽ FAIL**

`test/unit/api-gateway.test.js`:

```js
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setupTestTracing } = require('../helpers/otel');
const { createApp, customerTierOf } = require('../../src/api-gateway/server');

setupTestTracing();

async function listen(server) {
  server.listen(0);
  await once(server, 'listening');
  return `http://127.0.0.1:${server.address().port}`;
}

function close(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/** order-service giả: trả status/body cố định và ghi lại các request nhận được. */
async function fakeOrderService(status, body) {
  const received = [];
  const server = http.createServer((req, res) => {
    let data = '';
    req.on('data', (chunk) => (data += chunk));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, body: JSON.parse(data || '{}') });
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    });
  });
  return { url: await listen(server), received, server };
}

/** Bật gateway trên cổng ngẫu nhiên, gửi 1 request, tắt gateway. */
async function callGateway(orderServiceUrl, { method = 'POST', path = '/orders', body, raw } = {}) {
  const server = http.createServer(createApp({ orderServiceUrl }));
  const base = await listen(server);
  try {
    const res = await fetch(`${base}${path}`, {
      method,
      headers: { 'content-type': 'application/json' },
      body: method === 'GET' ? undefined : raw ?? JSON.stringify(body),
    });
    return { status: res.status, body: await res.json() };
  } finally {
    await close(server);
  }
}

const ORDER = { customerId: 'VIP-001', items: [{ sku: 'SERUM-01', qty: 1 }], paymentMethod: 'card' };

test('customerTierOf: mã bắt đầu bằng VIP -> gold, còn lại -> standard', () => {
  assert.equal(customerTierOf('VIP-001'), 'gold');
  assert.equal(customerTierOf('C-002'), 'standard');
  assert.equal(customerTierOf(undefined), 'standard');
  assert.equal(customerTierOf(123), 'standard');
});

test('chuyển tiếp đơn sang order-service, trả nguyên status và body', async () => {
  const upstream = await fakeOrderService(201, { orderId: 'ORD-1', status: 'CONFIRMED' });
  try {
    const res = await callGateway(upstream.url, { body: ORDER });
    assert.equal(res.status, 201);
    assert.equal(res.body.orderId, 'ORD-1');
    assert.equal(res.body.status, 'CONFIRMED');
    assert.deepEqual(upstream.received, [{ method: 'POST', url: '/orders', body: ORDER }]);
  } finally {
    await close(upstream.server);
  }
});

test('trả nguyên lỗi từ order-service (502 CARD_EXPIRED)', async () => {
  const upstream = await fakeOrderService(502, { error: 'CARD_EXPIRED', message: 'Thẻ đã hết hạn' });
  try {
    const res = await callGateway(upstream.url, { body: ORDER });
    assert.equal(res.status, 502);
    assert.equal(res.body.error, 'CARD_EXPIRED');
  } finally {
    await close(upstream.server);
  }
});

test('order-service không chạy -> 503 ORDER_SERVICE_UNAVAILABLE', async () => {
  const dead = http.createServer();
  const url = await listen(dead);
  await close(dead); // cổng vừa được giải phóng, không còn ai nghe
  const started = Date.now();
  const res = await callGateway(url, { body: ORDER });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, 'ORDER_SERVICE_UNAVAILABLE');
  assert.ok(Date.now() - started < 6000, 'phải trả lời trong vòng timeout 5 giây');
});

test('body JSON sai cú pháp -> 400 BAD_REQUEST, không gọi order-service', async () => {
  const upstream = await fakeOrderService(201, {});
  try {
    const res = await callGateway(upstream.url, { raw: '{"customerId":' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, 'BAD_REQUEST');
    assert.equal(upstream.received.length, 0);
  } finally {
    await close(upstream.server);
  }
});

test('GET /health -> 200', async () => {
  const res = await callGateway('http://127.0.0.1:1', { method: 'GET', path: '/health' });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { status: 'ok' });
});
```

- [ ] **Step 2: Chạy test để thấy FAIL**

Run: `npm test`
Expected: FAIL với `Cannot find module '../../src/api-gateway/server'`.

- [ ] **Step 3: Viết `src/api-gateway/server.js`**

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

- [ ] **Step 4: Chạy test để thấy PASS**

Run: `npm test`
Expected: `# fail 0`. Tổng 37 test pass (31 cũ và 6 mới).

- [ ] **Step 5: E2E một phần (chưa có worker)**

Chạy nền hai lệnh `npm run start:order` và `npm run start:gateway`. Chờ sẵn sàng rồi chạy verify:

```bash
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3000/health && curl -sf -o /dev/null http://localhost:3001/health && break; sleep 1; done
npm run verify; echo "exit=$?"
```

Expected (verify chờ tối đa 30 giây cho trace `success`, vì span của worker không bao giờ tới):
- `PASS` toàn bộ check của `payment-failed`, `invalid`, `health`.
- Trong `success`: `FAIL` đúng 6 check liên quan tới worker, gồm span `process order-events`, span `email.send`, "trace đi qua đủ 3 service", "span cha của process order-events", "customer.tier = gold trên process order-events", "resource của notification-worker". Các check còn lại của `success` đều `PASS`, bao gồm `customer.tier = gold trên order.validate`, chứng tỏ baggage đã đi qua HTTP.
- `Kết quả: 26/32 check PASS`, `exit=1`.

Nếu có check khác cũng FAIL, xem cây span ở cuối output để tìm nguyên nhân. Lỗi nằm ở code thì sửa code. Nếu đó là hành vi thật của instrumentation khác với spec (ví dụ tên span), dừng lại và báo trước khi đổi check.

Dừng service (PowerShell):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'tracing\.js.*src[\\/](api-gateway|order-service|notification-worker)[\\/]' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "stopped $($_.ProcessId)" }
```

Rồi xoá hàng đợi: `docker compose exec -T redis redis-cli DEL order-events`

- [ ] **Step 6: Commit**

```bash
git add test/unit/api-gateway.test.js src/api-gateway/server.js
git commit -F - <<'EOF'
148_opentelemetry_tracing: add api-gateway with baggage propagation

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 8: notification-worker (extract context, span CONSUMER)

**Files:**
- Create: `test/unit/worker.test.js`
- Create: `src/notification-worker/worker.js`

**Interfaces:**
- Consumes: `withSpan` (Task 3), `extractContext`, `getBaggageValue`, `injectContext`, `withBaggage` (Task 3), `createLogger` (Task 3), hằng số trong `src/shared/messaging.js` (Task 3). Helper test `setupTestTracing`, `findSpan` (Task 3).
- Produces: `handleMessage(raw: string): Promise<boolean>` (false khi message không phải JSON). Khi chạy làm entry thì chạy vòng lặp `BRPOP order-events 5` trên `REDIS_URL` (mặc định `redis://localhost:16379`).

- [ ] **Step 1: Viết test, sẽ FAIL**

`test/unit/worker.test.js`:

```js
'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { SpanKind, SpanStatusCode } = require('@opentelemetry/api');
const { setupTestTracing, findSpan } = require('../helpers/otel');
const { withSpan } = require('../../src/shared/tracer');
const { injectContext, withBaggage } = require('../../src/shared/propagation');
const { handleMessage } = require('../../src/notification-worker/worker');

let exporter;
beforeEach(() => {
  exporter = setupTestTracing();
});

/** Giả lập phía producer: mở span PRODUCER (kèm baggage nếu có) rồi inject vào headers như order-service. */
function producerHeaders(tier) {
  const run = () =>
    withSpan('test.producer', { kind: SpanKind.PRODUCER }, async (span) => ({
      headers: injectContext({}),
      producer: span.spanContext(),
    }));
  return tier ? withBaggage({ 'customer.tier': tier }, run) : run();
}

const messageWith = (headers, id = 'msg-1') =>
  JSON.stringify({ id, type: 'order.created', payload: { orderId: 'ORD-1' }, headers, publishedAt: new Date().toISOString() });

test('span CONSUMER là con của span PRODUCER lấy từ headers, cùng trace id', async () => {
  const { headers, producer } = await producerHeaders('gold');
  assert.equal(await handleMessage(messageWith(headers)), true);
  const consumer = findSpan('process order-events');
  assert.equal(consumer.kind, SpanKind.CONSUMER);
  assert.equal(consumer.spanContext().traceId, producer.traceId);
  assert.equal(consumer.parentSpanContext.spanId, producer.spanId);
  assert.equal(consumer.status.code, SpanStatusCode.UNSET);
  assert.equal(consumer.attributes['messaging.system'], 'redis');
  assert.equal(consumer.attributes['messaging.destination.name'], 'order-events');
  assert.equal(consumer.attributes['messaging.operation.type'], 'process');
  assert.equal(consumer.attributes['messaging.operation.name'], 'process');
  assert.equal(consumer.attributes['messaging.message.id'], 'msg-1');
});

test('baggage customer.tier=gold đi qua message -> priority high', async () => {
  const { headers } = await producerHeaders('gold');
  await handleMessage(messageWith(headers));
  const consumer = findSpan('process order-events');
  assert.equal(consumer.attributes['customer.tier'], 'gold');
  assert.equal(consumer.attributes['notification.priority'], 'high');
});

test('khách standard -> priority normal', async () => {
  const { headers } = await producerHeaders('standard');
  await handleMessage(messageWith(headers));
  assert.equal(findSpan('process order-events').attributes['notification.priority'], 'normal');
});

test('email.send là span con của span CONSUMER', async () => {
  const { headers } = await producerHeaders('gold');
  await handleMessage(messageWith(headers));
  const consumer = findSpan('process order-events');
  const email = findSpan('email.send');
  assert.equal(email.parentSpanContext.spanId, consumer.spanContext().spanId);
  assert.equal(email.attributes['notification.channel'], 'email');
  assert.equal(email.attributes['notification.template'], 'order-confirmation');
});

test('message không có headers -> vẫn xử lý, span CONSUMER mở trace mới', async () => {
  assert.equal(await handleMessage(JSON.stringify({ id: 'msg-2', payload: { orderId: 'ORD-2' } })), true);
  const consumer = findSpan('process order-events');
  assert.equal(consumer.parentSpanContext, undefined);
  assert.equal(consumer.attributes['customer.tier'], 'unknown');
  assert.equal(consumer.attributes['notification.priority'], 'normal');
});

test('message không phải JSON -> trả false, không ném lỗi, không tạo span', async () => {
  assert.equal(await handleMessage('{không phải json'), false);
  assert.equal(exporter.getFinishedSpans().length, 0);
});
```

- [ ] **Step 2: Chạy test để thấy FAIL**

Run: `npm test`
Expected: FAIL với `Cannot find module '../../src/notification-worker/worker'`.

- [ ] **Step 3: Viết `src/notification-worker/worker.js`**

```js
'use strict';

const Redis = require('ioredis');
const { SpanKind } = require('@opentelemetry/api');
const { withSpan } = require('../shared/tracer');
const { extractContext, getBaggageValue } = require('../shared/propagation');
const { createLogger } = require('../shared/logger');
const {
  QUEUE_NAME,
  ATTR_MESSAGING_SYSTEM,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_OPERATION_TYPE,
  ATTR_MESSAGING_OPERATION_NAME,
  ATTR_MESSAGING_MESSAGE_ID,
} = require('../shared/messaging');

const log = createLogger('notification-worker');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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

/** Vòng lặp chờ message. BRPOP chặn tối đa 5 giây mỗi lần rồi lặp lại. */
async function run(redis) {
  log.info(`đang chờ message trên list "${QUEUE_NAME}"`);
  for (;;) {
    let item;
    try {
      // Lúc này không có span cha, nên instrumentation ioredis (mặc định requireParentSpan: true)
      // không tạo span cho BRPOP. Nhờ vậy Jaeger không bị ngập span rác mỗi 5 giây.
      item = await redis.brpop(QUEUE_NAME, 5);
    } catch (err) {
      log.error('lỗi đọc Redis, thử lại sau 1 giây', { reason: err.message });
      await sleep(1000);
      continue;
    }
    if (!item) continue; // hết 5 giây mà chưa có message
    const [, raw] = item;
    await handleMessage(raw).catch((err) => log.error('xử lý message thất bại', { reason: err.message }));
  }
}

if (require.main === module) {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:16379';
  const redis = new Redis(redisUrl);
  redis.on('error', (err) => log.error('lỗi Redis', { reason: err.message }));
  run(redis);
}

module.exports = { handleMessage };
```

- [ ] **Step 4: Chạy test để thấy PASS**

Run: `npm test`
Expected: `# fail 0`. Tổng 43 test pass (37 cũ và 6 mới).

- [ ] **Step 5: E2E đầy đủ, phải PASS toàn bộ**

Xoá hàng đợi cũ: `docker compose exec -T redis redis-cli DEL order-events`. Chạy nền `npm start` (Bash `run_in_background: true`, hoặc mở terminal riêng). Sau đó:

```bash
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3000/health && curl -sf -o /dev/null http://localhost:3001/health && break; sleep 1; done
npm run verify; echo "exit=$?"
```

Expected: mọi dòng đều `PASS`, `Kết quả: 32/32 check PASS`, rồi tới cây span của đơn thành công. Cây này có đủ các span trong spec mục 2.2, cùng các span `middleware - ...` và `request handler - /orders` của Express. Cuối cùng là `exit=0`.

Dừng service (PowerShell):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'tracing\.js.*src[\\/](api-gateway|order-service|notification-worker)[\\/]' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "stopped $($_.ProcessId)" }
```

- [ ] **Step 6: Commit**

```bash
git add test/unit/worker.test.js src/notification-worker/worker.js
git commit -F - <<'EOF'
148_opentelemetry_tracing: add notification-worker with manual context extraction

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 9: Script demo và kiểm chứng hai chế độ export

**Files:**
- Create: `scripts/demo.js`

**Interfaces:**
- Consumes: `JAEGER_URL` (Task 2), `GATEWAY_URL`, `SCENARIOS`, `sendScenario` (Task 5).
- Produces: `npm run demo` in từng kịch bản dạng `<id> HTTP <status> <tóm tắt>` kèm link `http://localhost:16686/trace/<traceId>`. Ngoài ra lưu output thật vào `.tmp/*.txt` để Task 10 chép vào README.

- [ ] **Step 1: Chạy demo khi chưa có file, phải FAIL**

Run: `npm run demo`
Expected: FAIL với `Cannot find module ...scripts/demo.js`.

- [ ] **Step 2: Viết `scripts/demo.js`**

```js
'use strict';

/**
 * Gửi 3 kịch bản mẫu tới gateway và in link Jaeger của từng trace.
 * Yêu cầu: `npm run infra:up` và `npm start` đang chạy.
 */
const { JAEGER_URL } = require('./lib/jaeger');
const { GATEWAY_URL, SCENARIOS, sendScenario } = require('./lib/scenarios');

async function main() {
  console.log(`Gửi ${SCENARIOS.length} kịch bản tới ${GATEWAY_URL}\n`);
  for (const scenario of SCENARIOS) {
    const { status, body } = await sendScenario(scenario);
    const summary = body.error
      ? `${body.error}: ${body.message}`
      : `${body.status} ${body.orderId}, tổng ${Number(body.total).toLocaleString('vi-VN')}đ`;
    console.log(`${scenario.id.padEnd(15)} HTTP ${status}  ${summary}`);
    if (body.traceId) console.log(`${''.padEnd(15)} ${JAEGER_URL}/trace/${body.traceId}`);
  }
  console.log('\nSpan được gom và gửi khoảng 5 giây một lần, đợi vài giây rồi mở link.');
}

main().catch((err) => {
  console.error(`Lỗi: ${err.message}. Đã chạy "npm run infra:up" và "npm start" chưa?`);
  process.exit(1);
});
```

- [ ] **Step 3: Chạy demo với chế độ qua Collector và lưu output thật**

Xoá hàng đợi: `docker compose exec -T redis redis-cli DEL order-events`. Tạo thư mục tạm: `mkdir -p .tmp`. Chạy nền `npm start` và ghi log ra file: `npm start > .tmp/services.log 2>&1` (Bash `run_in_background: true`). Sau đó:

```bash
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3000/health && curl -sf -o /dev/null http://localhost:3001/health && break; sleep 1; done
T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
npm run demo | tee .tmp/demo.txt
sleep 8
docker compose logs --since "$T0" otel-collector 2>&1 | grep -ci 'spans'
npm run verify | tee .tmp/verify.txt; echo "exit=${PIPESTATUS[0]}"
```

Expected:
- Demo in 3 kịch bản: `success HTTP 201 CONFIRMED ORD-..., tổng 820.000đ`, `payment-failed HTTP 502 CARD_EXPIRED: Thẻ đã hết hạn`, `invalid HTTP 400 VALIDATION_ERROR: Đơn hàng phải có ít nhất 1 sản phẩm`. Mỗi kịch bản kèm một link Jaeger.
- Lệnh đếm log của Collector in ra số **lớn hơn 0**, chứng tỏ span đã đi qua Collector.
- Verify: `Kết quả: 32/32 check PASS`, `exit=0`.

Dừng service (PowerShell):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'tracing\.js.*src[\\/](api-gateway|order-service|notification-worker)[\\/]' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "stopped $($_.ProcessId)" }
```

- [ ] **Step 4: Chế độ gửi thẳng Jaeger, phải PASS và Collector không nhận span nào**

Chạy nền `npm run start:direct > .tmp/services-direct.log 2>&1` (Bash `run_in_background: true`). Sau đó:

```bash
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3000/health && curl -sf -o /dev/null http://localhost:3001/health && break; sleep 1; done
grep -m3 "export=" .tmp/services-direct.log
T0=$(date -u +%Y-%m-%dT%H:%M:%SZ)
npm run verify | tail -3; echo "exit=${PIPESTATUS[0]}"
docker compose logs --since "$T0" otel-collector 2>&1 | grep -ci 'spans'
```

Expected:
- 3 dòng `[otel] tracing đã bật: service=... export=http://localhost:14318`.
- Verify: `Kết quả: 32/32 check PASS`, `exit=0`.
- Lệnh đếm log của Collector in ra `0`: trace tới thẳng Jaeger, không đi qua Collector.

Dừng service (PowerShell), dùng đúng lệnh ở Step 3.

- [ ] **Step 5: Lấy một message thật trong Redis để minh hoạ trong README**

Chỉ chạy order-service (worker không chạy, nên message còn nằm lại trong hàng đợi): chạy nền `npm run start:order`, rồi:

```bash
for i in $(seq 1 20); do curl -sf -o /dev/null http://localhost:3001/health && break; sleep 1; done
curl -s -X POST http://localhost:3001/orders -H 'content-type: application/json' -H 'baggage: customer.tier=gold' -d '{"customerId":"VIP-001","items":[{"sku":"SERUM-01","qty":2},{"sku":"MASK-03","qty":1}],"paymentMethod":"card"}' > /dev/null
docker compose exec -T redis redis-cli --raw RPOP order-events | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.stringify(JSON.parse(s),null,2)))" | tee .tmp/message.json
```

Expected: JSON có `id`, `type: "order.created"`, `payload` (orderId, customerId, total 820000, itemCount 2), `headers.traceparent` dạng `00-<32 hex>-<16 hex>-01` và `headers.baggage: "customer.tier=gold"`, `publishedAt`.

Dừng service (PowerShell), dùng đúng lệnh ở Step 3.

- [ ] **Step 6: Commit**

```bash
git add scripts/demo.js
git commit -F - <<'EOF'
148_opentelemetry_tracing: add demo script

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
```

---

### Task 10: README tiếng Việt và kiểm tra cuối

**Files:**
- Create: `README.md`

**Interfaces:**
- Consumes: toàn bộ code của Task 1–9, và output thật ở `.tmp/services.log`, `.tmp/demo.txt`, `.tmp/verify.txt`, `.tmp/message.json`.
- Produces: `README.md`, commit tổng kết của bài.

**Văn phong:** giống `146_saga_pattern_nodejs/README.md`. Tiêu đề và giải thích bằng tiếng Việt, thuật ngữ giữ nguyên tiếng Anh (span, trace, exporter...). Câu ngắn, đi thẳng vào ý. Có bảng, sơ đồ ASCII, và khối code chép **nguyên văn** từ file thật (không viết lại bằng trí nhớ). Mỗi đoạn code đặt ngay dưới phần giải thích của nó.

- [ ] **Step 1: Viết `README.md` theo đúng dàn ý và nội dung bắt buộc dưới đây**

Tiêu đề: `# OpenTelemetry Tracing với Node.js`. Mở đầu 2–3 câu nói ví dụ làm gì. Liền sau là sơ đồ kiến trúc (chép từ spec mục 2), dòng yêu cầu "Node.js >= 22, Docker", rồi `## Mục lục` có link tới từng mục bên dưới.

1. `## 1. Chạy nhanh`
   - Các lệnh: `npm install`, `npm run infra:up`, `npm start` (terminal 1), `npm run demo` (terminal 2), mở `http://localhost:16686`, `npm run verify`. Dừng: Ctrl+C rồi `npm run infra:down`.
   - Bảng cổng: 3000, 3001, 4317, 4318, 14318, 16686, 16379. Ghi chú Redis dùng 16379 để tránh 6379 thường đã có Redis khác.
2. `## 2. Kiến trúc ví dụ`
   - Bảng thành phần (spec mục 2.1, không có dòng nhắc container của dự án khác).
   - Bảng 3 kịch bản (spec mục 2.3).
   - Cây span **thật** lấy từ `.tmp/verify.txt` (phần "Cây span của đơn thành công").
3. `## 3. Bước 1: Cài package`
   - Hai lệnh `npm install` của Task 1, Step 3.
   - Bảng vai trò từng package: `sdk-node` (gom SDK: tracer provider, context manager, propagator, đọc biến `OTEL_*`); `auto-instrumentations-node` (gói các instrumentation: http, express, undici/fetch, ioredis...); `exporter-trace-otlp-proto` (gửi OTLP/HTTP protobuf, cổng 4318); `api` (API mà code gọi: trace, context, propagation); `resources` và `semantic-conventions` (khai báo resource bằng hằng số chuẩn); `express`, `ioredis`; `cross-env`, `concurrently` (npm script chạy được trên cả Windows lẫn Linux); 3 package chỉ dùng trong test.
   - Lưu ý: chỉ được có một bản `@opentelemetry/api` (kiểm tra bằng `npm ls @opentelemetry/api`). Các package `0.x` là experimental, nên pin minor (`^0.222.0` chỉ nhận 0.222.x).
4. `## 4. Bước 2: File khởi tạo tracing và cách nạp trước khi app chạy`
   - Chép nguyên văn `src/tracing.js`.
   - Giải thích monkey-patch: module nào được require trước `sdk.start()` thì không được vá.
   - Các cách nạp, mỗi cách một khối lệnh:
     - `node --require ./src/tracing.js src/order-service/server.js` (cách ví dụ dùng, xem `package.json`);
     - biến `NODE_OPTIONS`. Bash: `NODE_OPTIONS="--require ./src/tracing.js" node app.js`. PowerShell: `$env:NODE_OPTIONS="--require ./src/tracing.js"; node app.js`;
     - ESM, theo tài liệu esm-support của OpenTelemetry JS: `node --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import ./telemetry.mjs app.mjs`;
     - zero-code, không cần viết file: `node --require @opentelemetry/auto-instrumentations-node/register app.js` cùng các biến `OTEL_SERVICE_NAME`, `OTEL_EXPORTER_OTLP_ENDPOINT`. Bản ESM: `node --experimental-loader=@opentelemetry/instrumentation/hook.mjs --import @opentelemetry/auto-instrumentations-node/register app.mjs`.
   - Vì sao không nên đặt `require('./tracing')` ở dòng đầu app: ai đó thêm một `require` phía trên là hỏng mà không có lỗi nào; với ESM/TypeScript, các `import` bị hoist nên thứ tự trong file không còn là thứ tự chạy.
   - Tắt êm: SIGINT/SIGTERM → `sdk.shutdown()` để flush lô span cuối.
5. `## 5. Bước 3: Service name và resource attributes`
   - Chép đoạn `resource` trong `src/tracing.js`.
   - Bảng attribute: `service.name` (bắt buộc, là "tên service" trong Jaeger), `service.version`, `service.namespace`, `service.instance.id`, `deployment.environment.name`. Cả 5 đều stable trong semantic-conventions 1.43. Kèm các attribute detector tự thêm (`host.*`, `process.*`, `telemetry.sdk.*`).
   - Thứ tự ưu tiên, đã kiểm tra trong source sdk-node 0.222: resource trong code < resource do detector phát hiện (detector `env` đọc `OTEL_SERVICE_NAME`, `OTEL_RESOURCE_ATTRIBUTES`) < option `serviceName` của NodeSDK. Vì vậy ví dụ không dùng option `serviceName`.
   - Ví dụ ghi đè bằng biến môi trường, Bash và PowerShell: `OTEL_RESOURCE_ATTRIBUTES=deployment.environment.name=staging,team.name=platform`. Test `npm run test:integration` chứng minh điều này.
   - Vì sao phải merge `defaultResource()`: không merge thì mất `telemetry.sdk.*`.
6. `## 6. Bước 4: Express, tự động trace HTTP request`
   - Chép nguyên văn `src/api-gateway/server.js`. Nhấn mạnh: không có dòng code tracing nào cho HTTP.
   - Các span tự sinh: span SERVER của instrumentation http (tên thành `POST /orders` nhờ Express báo route), các span `middleware - ...` và `request handler - /orders` của Express, span CLIENT `POST` của undici (`fetch`), span `lpush` của ioredis.
   - Bên trong route handler, span active là `request handler - /orders`, nên custom span nằm dưới span đó.
   - Cấu hình instrumentation: `ignoreIncomingRequestHook` cho `/health`; tắt `dns`, `net`; `fs` mặc định đã tắt. Có thể bật/tắt bằng biến `OTEL_NODE_ENABLED_INSTRUMENTATIONS` / `OTEL_NODE_DISABLED_INSTRUMENTATIONS`.
   - Phiên bản hỗ trợ: instrumentation-express `>=4 <6` (có Express 5), instrumentation-ioredis `>=2 <7`.
7. `## 7. Bước 5: Custom span, attributes, event, exception, status`
   - Chép nguyên văn hàm `chargePayment` (API gốc, viết tay), rồi toàn bộ `src/shared/tracer.js` (helper `withSpan`).
   - Giải thích: `startActiveSpan` so với `startSpan` (span active thì span con tự lồng vào); attribute (dữ liệu tra cứu, lọc được) so với event (mốc thời gian, ví dụ `stock.reserved`); 3 bước ghi lỗi (`recordException`, `error.type`, `setStatus(ERROR)`); luôn `end()` trong `finally`; thành công thì để UNSET, không đặt OK.
   - SDK lấy `exception.type` từ `err.code` nếu có, không có thì lấy `err.name` (đã xem trong source sdk-trace 2.11). Vì vậy `PaymentError` có `code: 'CARD_EXPIRED'`.
   - Quy tắc semantic conventions cho HTTP: span SERVER chỉ ERROR khi 5xx; span CLIENT ERROR khi >= 400. Bảng 3 kịch bản kèm các span đỏ.
   - Vì sao lỗi nghiệp vụ trả response ngay trong handler: đẩy qua `next(err)` thì instrumentation express đánh ERROR cho span `request handler`.
   - Tên span nên ít giá trị khác nhau (`payment.charge`, không phải `charge ORD-123`). Id để trong attribute.
8. `## 8. Bước 6: Truyền context giữa các service`
   - Cấu trúc `traceparent`: `00-<trace-id 32 hex>-<parent-id 16 hex>-<flags>`, `01` = sampled. Lấy ví dụ thật từ `.tmp/message.json`.
   - HTTP: tự động. undici inject vào request, http extract ở phía server. NodeSDK mặc định dùng propagator W3C Trace Context + W3C Baggage (đổi bằng `OTEL_PROPAGATORS`).
   - Redis: thủ công. Chép hàm `publishOrderCreated`, hàm `handleMessage`, và toàn bộ `src/shared/propagation.js`. Chép message thật từ `.tmp/message.json`.
   - Baggage: gateway gắn `customer.tier`, order-service đọc qua HTTP, worker đọc qua message. Baggage không tự thành attribute. Nó đi dạng plain text trong header, nên không chứa dữ liệu nhạy cảm. Giữ baggage nhỏ.
   - Span cha hay span link: ví dụ dùng span cha (xử lý từng message). Xử lý theo lô thì dùng `links`, vì một span CONSUMER khi đó có nhiều producer.
   - Áp dụng cho hàng đợi khác: beanstalkd, SQS, cron, outbox cần tự inject/extract giống hệt; kafkajs và amqplib có instrumentation tự truyền context qua message header.
9. `## 9. Bước 7: Export tới OTel Collector hoặc Jaeger`
   - Chép nguyên văn `docker-compose.yml` và `otel-collector-config.yaml`, rồi giải thích từng khối.
   - Receiver phải bind `0.0.0.0`: mặc định là `localhost:4317/4318` (README của otlpreceiver).
   - Từ Collector 0.161: exporter `otlp_grpc` và `otlp_http`. Tên cũ `otlp` / `otlphttp` vẫn chạy nhưng deprecated, và phần lớn tutorial cũ còn dùng tên cũ.
   - Bảng hai chế độ (spec mục 5.3). Cách kiểm chứng: `docker compose logs --since 1m otel-collector`.
   - Đổi sang gRPC, cách 1: `npm install @opentelemetry/exporter-trace-otlp-grpc@^0.222.0`, đổi import trong `tracing.js`, endpoint `http://localhost:4317`. Cách 2: bỏ option `traceExporter` rồi đặt `OTEL_EXPORTER_OTLP_PROTOCOL=grpc`; NodeSDK tự tạo exporter theo biến này, và nhận các giá trị `grpc`, `http/protobuf`, `http/json`.
   - Dạo nhanh Jaeger UI: chọn Service, Find Traces, mở trace, tìm theo trace id, xem tab Process để thấy resource.
10. `## 10. Cấu trúc thư mục`
    - Cây thư mục thật (gồm `scripts/lib`, `test/`), mỗi file một dòng mô tả vai trò.
11. `## 11. Output mẫu`
    - Log terminal khi `npm start` chạy và xử lý đơn: trích 10–20 dòng từ `.tmp/services.log`, gồm dòng `[otel] tracing đã bật` và các dòng có `trace_id=`.
    - Output của `npm run demo`: chép từ `.tmp/demo.txt`.
    - Output của `npm run verify`: chép từ `.tmp/verify.txt`.
12. `## 12. Kiểm thử`
    - `npm test` (unit test, không cần Docker, dùng `InMemorySpanExporter` của `@opentelemetry/sdk-trace`). Chép hàm `setupTestTracing` trong `test/helpers/otel.js` làm ví dụ cách test span.
    - `npm run test:integration` (cần `infra:up`).
    - `npm run verify` (cần `npm start`).
13. `## 13. Lưu ý khi đưa lên production`
    - Sampling. Head sampling bằng biến môi trường, NodeSDK đọc khi code không truyền `sampler`: `OTEL_TRACES_SAMPLER=parentbased_traceidratio`, `OTEL_TRACES_SAMPLER_ARG=0.1`. Tail sampling ở Collector, kèm đoạn config:
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
      Giải thích: giữ 100% trace lỗi và 10% trace còn lại. Phải đặt trước `batch` trong pipeline. Mọi span của cùng một trace phải về cùng một Collector.
    - Batch: `OTEL_BSP_SCHEDULE_DELAY`, `OTEL_BSP_MAX_QUEUE_SIZE`, `OTEL_BSP_MAX_EXPORT_BATCH_SIZE`, `OTEL_BSP_EXPORT_TIMEOUT`. NodeSDK vẫn đọc các biến này khi truyền `traceExporter` (đã xem trong source 0.222).
    - Shutdown: Kubernetes gửi SIGTERM, cần flush như `tracing.js`.
    - Dữ liệu nhạy cảm: không ghi email, số điện thoại, token vào attribute hay baggage. Collector có processor `attributes` / `redaction` để lọc thêm một lớp.
    - Tên span ít giá trị khác nhau. Id để trong attribute.
    - Tắt nhanh: `OTEL_SDK_DISABLED=true`.
    - Pin phiên bản. Package `0.x` có thể phá API giữa các bản minor.
    - Collector có hai kiểu triển khai: agent (sidecar hoặc daemonset, cạnh app) và gateway (cụm tập trung). App chỉ biết địa chỉ Collector, đổi backend không cần deploy lại app.
    - Bảo mật đường gửi: TLS và header xác thực qua `OTEL_EXPORTER_OTLP_HEADERS`.
14. `## 14. Xử lý sự cố`
    - Bảng "Triệu chứng | Nguyên nhân | Cách sửa", tối thiểu các dòng:
      - Không thấy trace trong Jaeger: quên `infra:up` (terminal có cảnh báo export lỗi); sai endpoint; mới gửi chưa tới 5 giây.
      - Log có cảnh báo `Module ... has been loaded before ...`: `tracing.js` nạp quá muộn.
      - Một luồng bị tách thành 2 trace: context không được truyền (kiểm tra header `traceparent` hoặc `headers` của message).
      - `/health` vẫn có trace: kiểm tra `ignoreIncomingRequestHook`.
      - `docker compose up` báo cổng bị chiếm: đổi cổng bên trái trong `ports` (ví dụ Redis đang dùng 16379).
      - `EADDRINUSE :3000`: còn tiến trình cũ, tắt đi.
      - App ESM không có span: thiếu `--experimental-loader=@opentelemetry/instrumentation/hook.mjs`.
      - Windows: Ctrl+C với `concurrently` có thể không kịp flush lô span cuối, nên chờ vài giây rồi mới dừng.
    - Bật log chi tiết của SDK: `OTEL_LOG_LEVEL=debug`.
15. `## Tham khảo`
    - Link: opentelemetry.io/docs/languages/js; README của `@opentelemetry/sdk-node`; README của `@opentelemetry/auto-instrumentations-node`; tài liệu esm-support của OpenTelemetry JS; semantic conventions cho HTTP spans và messaging spans; W3C Trace Context; W3C Baggage; tài liệu OTel Collector; tài liệu Jaeger v2 (APIs); spec và plan của bài này trong `docs/superpowers/`.

- [ ] **Step 2: Kiểm tra link nội bộ và file được nhắc tới trong README đều tồn tại**

```bash
node -e "
const fs=require('fs');const md=fs.readFileSync('README.md','utf8');
const links=[...md.matchAll(/\]\(((?!https?:|#)[^)]+)\)/g)].map(m=>m[1].split('#')[0]);
const missing=links.filter(p=>!fs.existsSync(p));
const headings=[...md.matchAll(/^## .+$/gm)].length;
console.log('links:',links.length,'missing:',missing,'h2:',headings);
process.exit(missing.length?1:0);"
```

Expected: `missing: []`, `h2:` ít nhất 16 (Mục lục, 14 mục đánh số, Tham khảo).

- [ ] **Step 3: Kiểm tra cuối từ trạng thái sạch, làm đúng theo phần "Chạy nhanh" của README**

```bash
npm run infra:down && npm run infra:up
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:16686/ && break; sleep 1; done
npm test
npm run test:integration
```

Chạy nền `npm start`, rồi:

```bash
for i in $(seq 1 30); do curl -sf -o /dev/null http://localhost:3000/health && curl -sf -o /dev/null http://localhost:3001/health && break; sleep 1; done
npm run demo
npm run verify | tail -2; echo "exit=${PIPESTATUS[0]}"
```

Expected: `npm test` có `# fail 0` (43 pass). `test:integration` có `# fail 0` (3 pass). Demo in 3 kịch bản. Verify `32/32 check PASS`, `exit=0`.

Dừng service (PowerShell):

```powershell
Get-CimInstance Win32_Process -Filter "Name='node.exe'" | Where-Object { $_.CommandLine -match 'tracing\.js.*src[\\/](api-gateway|order-service|notification-worker)[\\/]' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force; "stopped $($_.ProcessId)" }
```

Rồi tắt hạ tầng: `npm run infra:down`

- [ ] **Step 4: Kiểm tra git sạch, `.idea/` không bị đụng tới**

```bash
git status --porcelain
```

Expected: chỉ còn `?? README.md` (sắp commit) và `?? .idea/`. Không có file nào khác chưa commit.

- [ ] **Step 5: Commit tổng kết theo kiểu các bài trước**

```bash
git add README.md
git commit -F - <<'EOF'
Add OpenTelemetry tracing + Node.js example (148_opentelemetry_tracing)

Ví dụ chạy được về OpenTelemetry tracing cho Node.js, kèm README
tiếng Việt đi lần lượt từng bước.

- tracing.js: NodeSDK + auto-instrumentations + OTLP/HTTP exporter,
  resource attributes theo semantic conventions 1.43, nạp bằng
  --require, flush khi SIGINT/SIGTERM
- api-gateway -> order-service qua HTTP: traceparent và baggage tự
  truyền, không cần code
- order-service: custom span (withSpan và một span viết tay bằng API
  gốc), ghi exception + error.type + status, inject context vào
  message Redis
- notification-worker: extract context từ message, span CONSUMER nối
  đúng trace
- docker-compose: OTel Collector 0.161 + Jaeger 2.21 + Redis 8, hai
  chế độ export (qua Collector hoặc gửi thẳng Jaeger)
- Kiểm thử: unit test với InMemorySpanExporter, test tích hợp cho
  tracing.js, verify end-to-end qua Jaeger API v3

Co-Authored-By: Claude Opus 5.5 (1M context) <noreply@anthropic.com>
EOF
git log --oneline -12
```
