'use strict';

/**
 * Test tích hợp telemetry: KHÔNG cần Docker hay SigNoz.
 *
 *   npm test
 *
 * Test chạy order-service và payment-service THẬT, đúng lệnh như production
 * (`node --require ./src/tracing.js ...`), nhưng thay SigNoz bằng một OTLP/HTTP receiver giả chạy ngay
 * trong test. Receiver ghi lại mọi gói traces / metrics / logs mà SDK gửi tới (dạng JSON của
 * exporter-*-otlp-http); test gọi API rồi kiểm tra đúng những gì SigNoz sẽ nhận được.
 *
 * Bốn process được dựng:
 *   order-ok    → payment-ok    (PAYMENT_FAILURE_RATE=0: thanh toán luôn thành công)
 *   order-fail  → payment-fail  (PAYMENT_FAILURE_RATE=1: ngân hàng luôn lỗi)
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');

const ROOT = path.resolve(__dirname, '..');

// Mã trong OTLP (khác enum SpanKind của @opentelemetry/api, vốn bắt đầu từ 0).
const KIND = { INTERNAL: 1, SERVER: 2, CLIENT: 3 };
const STATUS_ERROR = 2;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------------------------
// OTLP receiver giả
// ---------------------------------------------------------------------------------------------
function startFakeOtlpReceiver() {
  const received = { traces: [], metrics: [], logs: [], badRequests: 0 };
  const signals = { '/v1/traces': 'traces', '/v1/metrics': 'metrics', '/v1/logs': 'logs' };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const signal = signals[req.url];
      if (req.method !== 'POST' || !signal) {
        received.badRequests += 1;
        res.writeHead(404).end();
        return;
      }
      received[signal].push(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      res.writeHead(200, { 'content-type': 'application/json' }).end('{}');
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve({ server, received, port: server.address().port }));
  });
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.once('error', reject);
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address();
      srv.close(() => resolve(port));
    });
  });
}

// ---------------------------------------------------------------------------------------------
// Đọc payload OTLP/JSON thành object dễ kiểm tra
// ---------------------------------------------------------------------------------------------
function attrValue(v) {
  if (!v) return undefined;
  if ('stringValue' in v) return v.stringValue;
  if ('boolValue' in v) return v.boolValue;
  if ('intValue' in v) return Number(v.intValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(attrValue);
  return undefined;
}

const toObject = (list = []) => Object.fromEntries(list.map((a) => [a.key, attrValue(a.value)]));

function allSpans(received) {
  const spans = [];
  for (const req of received.traces) {
    for (const rs of req.resourceSpans || []) {
      const resource = toObject(rs.resource?.attributes);
      for (const ss of rs.scopeSpans || []) {
        for (const s of ss.spans || []) {
          spans.push({
            ...s,
            attributes: toObject(s.attributes),
            events: (s.events || []).map((e) => ({ name: e.name, attributes: toObject(e.attributes) })),
            resource,
            service: resource['service.name'],
          });
        }
      }
    }
  }
  return spans;
}

function allLogs(received) {
  const logs = [];
  for (const req of received.logs) {
    for (const rl of req.resourceLogs || []) {
      const resource = toObject(rl.resource?.attributes);
      for (const sl of rl.scopeLogs || []) {
        for (const r of sl.logRecords || []) {
          logs.push({ ...r, body: attrValue(r.body), attributes: toObject(r.attributes), service: resource['service.name'] });
        }
      }
    }
  }
  return logs;
}

/** Trả về danh sách { name, service, type, points: [{ attributes, value }] }. */
function allMetrics(received) {
  const metrics = [];
  for (const req of received.metrics) {
    for (const rm of req.resourceMetrics || []) {
      const resource = toObject(rm.resource?.attributes);
      for (const sm of rm.scopeMetrics || []) {
        for (const m of sm.metrics || []) {
          const type = ['sum', 'gauge', 'histogram', 'exponentialHistogram'].find((t) => m[t]);
          const points = (m[type]?.dataPoints || []).map((p) => ({
            attributes: toObject(p.attributes),
            value: p.asDouble ?? (p.asInt !== undefined ? Number(p.asInt) : Number(p.count ?? 0)),
          }));
          metrics.push({ name: m.name, unit: m.unit, service: resource['service.name'], type, points });
        }
      }
    }
  }
  return metrics;
}

async function waitFor(fn, message, timeoutMs = 15_000) {
  const start = Date.now();
  for (;;) {
    const value = fn();
    if (value) return value;
    if (Date.now() - start > timeoutMs) throw new Error(`Hết ${timeoutMs} ms vẫn chưa thấy: ${message}`);
    await sleep(200);
  }
}

// ---------------------------------------------------------------------------------------------
// Dựng các service
// ---------------------------------------------------------------------------------------------
function startService(script, env) {
  // Bỏ mọi biến OTEL_* đang có trong shell để test không bị ảnh hưởng bởi cấu hình bên ngoài.
  const baseEnv = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('OTEL_')));
  const child = spawn(process.execPath, ['--require', './src/tracing.js', script], {
    cwd: ROOT,
    env: { ...baseEnv, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const svc = { child, output: '', port: Number(env.PORT) };
  child.stdout.on('data', (d) => (svc.output += d));
  child.stderr.on('data', (d) => (svc.output += d));
  return svc;
}

/** Chờ service trả 200 ở /health; báo lỗi kèm output nếu process chết hoặc quá 20 giây. */
async function pollHealth(url, svc) {
  const start = Date.now();
  for (;;) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      // chưa lên
    }
    if (svc.child.exitCode !== null) throw new Error(`Service thoát sớm:\n${svc.output}`);
    if (Date.now() - start > 20_000) throw new Error(`Service không healthy sau 20 s:\n${svc.output}`);
    await sleep(200);
  }
}

async function call(port, method, urlPath, body) {
  const res = await fetch(`http://127.0.0.1:${port}${urlPath}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, traceId: res.headers.get('x-trace-id'), body: await res.json().catch(() => null) };
}

/** Chờ tới khi span gốc (SERVER, không có cha) của trace đã được gửi, rồi trả về toàn bộ span của trace. */
async function traceOf(received, traceId, extraCheck = () => true) {
  return waitFor(() => {
    const spans = allSpans(received).filter((s) => s.traceId === traceId);
    const root = spans.find((s) => s.kind === KIND.SERVER && !s.parentSpanId);
    return root && extraCheck(spans) ? spans : null;
  }, `span gốc của trace ${traceId}`);
}

const byName = (spans, name, service) => spans.filter((s) => s.name === name && (!service || s.service === service));
const one = (spans, name, service) => {
  const found = byName(spans, name, service);
  assert.equal(found.length, 1, `cần đúng 1 span "${name}"${service ? ` (${service})` : ''}, thấy ${found.length}`);
  return found[0];
};

// ---------------------------------------------------------------------------------------------
let receiver;
const svc = {};

before(async () => {
  receiver = await startFakeOtlpReceiver();
  const [pOk, pFail, oOk, oFail] = await Promise.all([getFreePort(), getFreePort(), getFreePort(), getFreePort()]);
  const common = {
    OTEL_EXPORTER_OTLP_ENDPOINT: `http://127.0.0.1:${receiver.port}`,
    OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment=test,service.version=9.9.9',
    OTEL_BSP_SCHEDULE_DELAY: '200', // gửi span sau 0,2 s thay vì 5 s
    OTEL_METRIC_EXPORT_INTERVAL: '1000',
    LOG_LEVEL: 'info',
  };
  svc.paymentOk = startService('src/payment-service.js', { ...common, OTEL_SERVICE_NAME: 'payment-service', PORT: String(pOk), PAYMENT_FAILURE_RATE: '0' });
  svc.paymentFail = startService('src/payment-service.js', { ...common, OTEL_SERVICE_NAME: 'payment-service', PORT: String(pFail), PAYMENT_FAILURE_RATE: '1' });
  svc.orderOk = startService('src/server.js', { ...common, OTEL_SERVICE_NAME: 'order-service', PORT: String(oOk), PAYMENT_SERVICE_URL: `http://127.0.0.1:${pOk}` });
  svc.orderFail = startService('src/server.js', { ...common, OTEL_SERVICE_NAME: 'order-service', PORT: String(oFail), PAYMENT_SERVICE_URL: `http://127.0.0.1:${pFail}` });
  await Promise.all(Object.values(svc).map((s) => pollHealth(`http://127.0.0.1:${s.port}/health`, s)));
});

after(async () => {
  for (const s of Object.values(svc)) s.child.kill();
  await new Promise((resolve) => receiver.server.close(resolve));
});

// ---------------------------------------------------------------------------------------------
test('order thành công: một trace đi qua cả 2 service, cha-con nối đúng qua traceparent', async () => {
  const res = await call(svc.orderOk.port, 'POST', '/api/orders', { productId: 'p-1001', quantity: 2, customerId: 'c-test' });
  assert.equal(res.status, 201);
  assert.equal(res.body.status, 'PAID');
  assert.match(res.traceId, /^[0-9a-f]{32}$/, 'response phải có header X-Trace-Id');

  const spans = await traceOf(receiver.received, res.traceId, (s) => s.some((x) => x.name === 'bank.authorize'));
  assert.deepEqual([...new Set(spans.map((s) => s.service))].sort(), ['order-service', 'payment-service']);

  const root = one(spans, 'POST /api/orders', 'order-service');
  assert.equal(root.kind, KIND.SERVER);
  assert.equal(root.attributes['http.response.status_code'], 201);
  assert.notEqual(root.status?.code, STATUS_ERROR);

  for (const name of ['order.validate', 'SELECT shop.products', 'UPDATE shop.products', 'INSERT shop.orders', 'UPDATE shop.orders', 'middleware - requestContext']) {
    assert.ok(byName(spans, name, 'order-service').length >= 1, `thiếu span ${name}`);
  }
  for (const name of ['POST /payments', 'request handler - /payments', 'fraud.check', 'bank.authorize']) {
    assert.ok(byName(spans, name, 'payment-service').length >= 1, `thiếu span ${name} của payment-service`);
  }

  // Lời gọi fetch của order-service là span CLIENT; span SERVER của payment-service phải là con của nó.
  const fetchSpan = spans.find((s) => s.service === 'order-service' && s.kind === KIND.CLIENT && String(s.attributes['url.full']).endsWith('/payments'));
  assert.ok(fetchSpan, 'thiếu span CLIENT của fetch sang payment-service');
  const paymentServer = one(spans, 'POST /payments', 'payment-service');
  assert.equal(paymentServer.kind, KIND.SERVER);
  assert.equal(paymentServer.parentSpanId, fetchSpan.spanId, 'span của payment-service phải là con của span fetch');

  // Span DB giả lập mang thuộc tính chuẩn để SigNoz vẽ "Database Calls".
  const select = byName(spans, 'SELECT shop.products', 'order-service')[0];
  assert.equal(select.kind, KIND.CLIENT);
  assert.equal(select.attributes['db.system'], 'postgresql');
  assert.match(select.attributes['db.statement'], /\$1/);

  // Thuộc tính nghiệp vụ trên span request handler.
  const handler = one(spans, 'request handler - /api/orders', 'order-service');
  assert.equal(handler.attributes['app.customer.id'], 'c-test');
  assert.match(handler.attributes['app.order.id'], /^ORD-\d{6}$/);

  assert.ok(spans.length >= 15, `trace chỉ có ${spans.length} span`);
});

test('resource: lấy từ OTEL_SERVICE_NAME / OTEL_RESOURCE_ATTRIBUTES, không có host.id', async () => {
  const span = await waitFor(() => allSpans(receiver.received).find((s) => s.service === 'order-service'), 'span bất kỳ của order-service');
  assert.equal(span.resource['deployment.environment'], 'test');
  assert.equal(span.resource['service.version'], '9.9.9'); // env thắng giá trị mặc định 1.0.0 trong code
  assert.equal(span.resource['service.namespace'], 'shop-demo');
  assert.ok(span.resource['host.name'], 'thiếu host.name');
  assert.ok(span.resource['service.instance.id'], 'thiếu service.instance.id');
  assert.equal(span.resource['host.id'], undefined);
});

test('thanh toán thất bại: lỗi gốc ở bank.authorize, order trả 502 và chạy bù trừ', async () => {
  const res = await call(svc.orderFail.port, 'POST', '/api/orders', { productId: 'p-1002', quantity: 1, customerId: 'c-fail' });
  assert.equal(res.status, 502);
  assert.match(res.body.orderId, /^ORD-/);
  assert.equal(res.body.traceId, res.traceId);

  const spans = await traceOf(receiver.received, res.traceId, (s) => s.filter((x) => x.name === 'UPDATE shop.products').length === 2);

  const bank = one(spans, 'bank.authorize', 'payment-service');
  assert.equal(bank.status?.code, STATUS_ERROR);
  const bankException = bank.events.find((e) => e.name === 'exception');
  assert.match(bankException.attributes['exception.message'], /Bank gateway timeout/);

  const paymentServer = one(spans, 'POST /payments', 'payment-service');
  assert.equal(paymentServer.attributes['http.response.status_code'], 502);
  assert.equal(paymentServer.status?.code, STATUS_ERROR);

  const root = one(spans, 'POST /api/orders', 'order-service');
  assert.equal(root.attributes['http.response.status_code'], 502);
  assert.equal(root.status?.code, STATUS_ERROR);

  const handler = one(spans, 'request handler - /api/orders', 'order-service');
  assert.ok(handler.events.some((e) => e.name === 'exception' && e.attributes['exception.type'] === 'HttpError'));

  // Bù trừ: trừ kho + hoàn kho = 2 lần UPDATE products; đánh dấu đơn PAYMENT_FAILED = 1 lần UPDATE orders.
  assert.equal(byName(spans, 'UPDATE shop.products').length, 2);
  assert.equal(byName(spans, 'UPDATE shop.orders').length, 1);
});

test('GET /api/error: exception được ghi, span gốc là ERROR với mã 500', async () => {
  const res = await call(svc.orderOk.port, 'GET', '/api/error');
  assert.equal(res.status, 500);
  assert.equal(res.body.traceId, res.traceId);

  const spans = await traceOf(receiver.received, res.traceId);
  const root = one(spans, 'GET /api/error');
  assert.equal(root.status?.code, STATUS_ERROR);
  assert.equal(root.attributes['http.response.status_code'], 500);
  const handler = one(spans, 'request handler - /api/error');
  assert.ok(handler.events.some((e) => e.name === 'exception' && /Lỗi cố ý/.test(e.attributes['exception.message'])));
});

test('GET /api/error?type=db: exception nằm ở span DB, exception.type = 57014', async () => {
  const res = await call(svc.orderOk.port, 'GET', '/api/error?type=db');
  assert.equal(res.status, 500);
  const spans = await traceOf(receiver.received, res.traceId, (s) => s.some((x) => x.name === 'SELECT shop.order_reports'));
  const db = one(spans, 'SELECT shop.order_reports');
  assert.equal(db.status?.code, STATUS_ERROR);
  const ex = db.events.find((e) => e.name === 'exception');
  assert.equal(ex.attributes['exception.type'], '57014');
  assert.match(ex.attributes['exception.message'], /statement timeout/);
});

test('4xx (400, 404, 409) KHÔNG bị đánh dấu là lỗi', async () => {
  const notFound = await call(svc.orderOk.port, 'GET', '/api/products/p-9999');
  assert.equal(notFound.status, 404);

  const invalid = await call(svc.orderOk.port, 'POST', '/api/orders', { productId: '', quantity: 0 });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.details.length, 2);

  // p-1005 chỉ có 25 hộp: 10 + 10 thành công, lần thứ ba (10 > 5 còn lại) → 409.
  for (let i = 0; i < 2; i += 1) {
    assert.equal((await call(svc.orderOk.port, 'POST', '/api/orders', { productId: 'p-1005', quantity: 10 })).status, 201);
  }
  const outOfStock = await call(svc.orderOk.port, 'POST', '/api/orders', { productId: 'p-1005', quantity: 10 });
  assert.equal(outOfStock.status, 409);

  for (const r of [notFound, invalid, outOfStock]) {
    const spans = await traceOf(receiver.received, r.traceId);
    const root = spans.find((s) => s.kind === KIND.SERVER && !s.parentSpanId);
    assert.equal(root.attributes['http.response.status_code'], r.status);
    // Không span nào bị tô đỏ: nếu code ném lỗi cho 4xx, instrumentation-express sẽ đánh dấu span
    // "request handler" là ERROR và trace hiện như có sự cố dù chỉ là lỗi của client.
    const red = spans.filter((s) => s.status?.code === STATUS_ERROR).map((s) => s.name);
    assert.deepEqual(red, [], `trace ${r.status} có span ERROR: ${red.join(', ')}`);
  }
  const validateSpan = one(await traceOf(receiver.received, invalid.traceId), 'order.validate');
  assert.equal(validateSpan.attributes['app.validation.error_count'], 2);
});

test('/health không tạo span nào (healthcheck của Docker không làm ngập trace)', async () => {
  for (let i = 0; i < 3; i += 1) assert.equal((await call(svc.orderOk.port, 'GET', '/health')).status, 200);
  // Gọi thêm một request bình thường rồi chờ nó được gửi: mọi span sinh ra trước đó cũng đã được gửi.
  const marker = await call(svc.orderOk.port, 'GET', '/api/products');
  await traceOf(receiver.received, marker.traceId);
  const healthSpans = allSpans(receiver.received).filter(
    (s) => s.attributes['url.path'] === '/health' || s.attributes['http.route'] === '/health' || /\/health$/.test(s.name)
  );
  assert.equal(healthSpans.length, 0);
});

test('logs: gửi qua OTLP, mang trace_id/span_id, log lỗi có exception.*', async () => {
  const ok = await call(svc.orderOk.port, 'POST', '/api/orders', { productId: 'p-1003', quantity: 1, customerId: 'c-log' });
  assert.equal(ok.status, 201);
  const fail = await call(svc.orderFail.port, 'POST', '/api/orders', { productId: 'p-1003', quantity: 1, customerId: 'c-log' });
  assert.equal(fail.status, 502);

  const okLogs = await waitFor(() => {
    const logs = allLogs(receiver.received).filter((l) => l.traceId === ok.traceId);
    return logs.some((l) => l.service === 'payment-service') && logs.some((l) => l.body === 'Đơn đã thanh toán') ? logs : null;
  }, 'log của cả 2 service trong trace đơn thành công');
  const paid = okLogs.find((l) => l.body === 'Đơn đã thanh toán');
  assert.equal(paid.severityText, 'info');
  assert.match(paid.spanId, /^[0-9a-f]{16}$/);
  assert.match(paid.attributes.orderId, /^ORD-/);

  const errorLog = await waitFor(
    () => allLogs(receiver.received).find((l) => l.traceId === fail.traceId && l.body === 'Thanh toán thất bại, đã hoàn lại kho'),
    'log lỗi của đơn thất bại'
  );
  assert.equal(errorLog.severityText, 'error');
  assert.match(errorLog.attributes['exception.message'], /payment-service trả về 502/);
  assert.ok(errorLog.attributes['exception.stacktrace'], 'log lỗi phải có stack trace');
});

test('metrics: metric của app, của HTTP và của Node runtime đều được gửi', async () => {
  const find = (name, pred = () => true) =>
    allMetrics(receiver.received).find((m) => m.name === name && m.points.some(pred));

  await waitFor(() => find('shop.orders', (p) => p.attributes['order.status'] === 'success' && p.value >= 1), 'shop.orders{success}');
  await waitFor(() => find('shop.orders', (p) => p.attributes['order.status'] === 'payment_failed'), 'shop.orders{payment_failed}');
  await waitFor(() => find('shop.orders', (p) => p.attributes['order.status'] === 'out_of_stock'), 'shop.orders{out_of_stock}');
  await waitFor(() => find('shop.revenue', (p) => p.value > 0), 'shop.revenue');
  await waitFor(() => find('shop.payment.duration', (p) => p.attributes['payment.outcome'] === 'failed'), 'shop.payment.duration{failed}');

  const stock = await waitFor(() => find('shop.product.stock', (p) => p.attributes['product.id'] === 'p-1001'), 'shop.product.stock');
  assert.equal(stock.type, 'gauge');
  assert.equal(new Set(stock.points.map((p) => p.attributes['product.id'])).size, 5);

  const httpServer = await waitFor(() => find('http.server.request.duration'), 'http.server.request.duration');
  assert.equal(httpServer.type, 'histogram');
  await waitFor(() => find('nodejs.eventloop.delay.p99'), 'nodejs.eventloop.delay.p99 (instrumentation-runtime-node)');
});

test('khởi động sạch: có dòng [otel], không có cảnh báo của SDK', () => {
  for (const [name, s] of Object.entries(svc)) {
    assert.match(s.output, /\[otel\] SDK đã chạy: service=/, `${name} thiếu dòng khởi động`);
    assert.doesNotMatch(s.output, /dropping invalid resource attribute|Unsupported|metrics export failed|ECONNREFUSED/, `${name} có cảnh báo:\n${s.output}`);
  }
  assert.equal(receiver.received.badRequests, 0, 'SDK gửi tới đường dẫn không phải /v1/{traces,metrics,logs}');
});

test('SIGTERM: SDK flush telemetry rồi thoát', { skip: process.platform === 'win32' && 'Windows không gửi được SIGTERM cho process con' }, async () => {
  const s = svc.paymentOk;
  const exited = new Promise((resolve) => s.child.once('exit', (code) => resolve(code)));
  s.child.kill('SIGTERM');
  assert.equal(await exited, 0);
  assert.match(s.output, /\[otel\] SIGTERM: đã flush telemetry và tắt SDK/);
});
