#!/usr/bin/env node
'use strict';

/**
 * Kiểm thử end-to-end trên SigNoz THẬT: gọi API của demo, rồi truy vấn ClickHouse của SigNoz để chắc
 * chắn traces, logs, metrics đã đi hết đường App → SDK → Collector → ClickHouse.
 *
 *   npm run verify            (hoặc: node scripts/verify.js)
 *
 * Cần: SigNoz tự host chạy bằng Docker trên máy này (đã tạo tài khoản đầu tiên) và app đang chạy
 * (`docker compose up -d`). Script đọc ClickHouse qua `docker exec ... clickhouse-client`, nên không
 * cần API key của SigNoz. Không dùng được với SigNoz Cloud.
 *
 * Biến môi trường (đều có mặc định):
 *   ORDER_URL              http://localhost:3400
 *   PAYMENT_URL            http://localhost:3401
 *   CLICKHOUSE_CONTAINER   tự dò: signoz-telemetrystore-clickhouse-0-0 (Foundry) hoặc signoz-clickhouse (compose cũ)
 *   VERIFY_TIMEOUT_MS      thời gian chờ dữ liệu vào ClickHouse, mặc định 90000
 */

const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);

const ORDER_URL = (process.env.ORDER_URL || 'http://localhost:3400').replace(/\/+$/, '');
const PAYMENT_URL = (process.env.PAYMENT_URL || 'http://localhost:3401').replace(/\/+$/, '');
const TIMEOUT_MS = Number(process.env.VERIFY_TIMEOUT_MS) || 90_000;
const CLICKHOUSE_CANDIDATES = ['signoz-telemetrystore-clickhouse-0-0', 'signoz-clickhouse'];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const results = [];

/** Ghi lại một check: ok = true/false, detail in kèm khi lỗi (hoặc luôn in nếu là chuỗi ngắn). */
function check(name, ok, detail = '') {
  results.push({ name, ok });
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? `  — ${detail}` : ''}`);
  return ok;
}

// ---------------------------------------------------------------------------------------------
// ClickHouse
// ---------------------------------------------------------------------------------------------
let clickhouse;

async function findClickHouse() {
  if (process.env.CLICKHOUSE_CONTAINER) return process.env.CLICKHOUSE_CONTAINER;
  const { stdout } = await execFileAsync('docker', ['ps', '--format', '{{.Names}}']);
  const running = stdout.split(/\r?\n/);
  return CLICKHOUSE_CANDIDATES.find((name) => running.includes(name));
}

/** Chạy một câu SQL, trả về mảng dòng (object). Chuỗi đưa vào SQL chỉ là trace ID / tên cố định. */
async function sql(query) {
  const { stdout } = await execFileAsync(
    'docker',
    ['exec', clickhouse, 'clickhouse-client', '--format', 'JSON', '-q', query],
    { maxBuffer: 32 * 1024 * 1024 }
  );
  return JSON.parse(stdout).data;
}

const quoteList = (ids) => ids.map((id) => `'${id.replace(/[^0-9a-f]/g, '')}'`).join(',');

// ---------------------------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------------------------
async function call(method, url, body) {
  try {
    const res = await fetch(url, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    return { status: res.status, traceId: res.headers.get('x-trace-id'), body: await res.json().catch(() => null) };
  } catch (err) {
    return { status: 0, error: err.cause?.code || err.name };
  }
}

/** Đặt đơn lặp lại tới khi nhận đúng mã mong muốn (thanh toán thành công/thất bại là ngẫu nhiên). */
async function orderUntil(expectedStatus, maxAttempts) {
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const res = await call('POST', `${ORDER_URL}/api/orders`, { productId: 'p-1001', quantity: 1, customerId: 'c-verify' });
    if (res.status === expectedStatus) return { ...res, attempt };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
async function main() {
  const startedAt = Date.now();
  console.log('Kiểm thử end-to-end: app → OpenTelemetry → SigNoz (ClickHouse)\n');

  // [1] Điều kiện cần --------------------------------------------------------------------------
  console.log('[1] Điều kiện cần');
  const orderHealth = await call('GET', `${ORDER_URL}/health`);
  const paymentHealth = await call('GET', `${PAYMENT_URL}/health`);
  check(`order-service trả lời ở ${ORDER_URL}`, orderHealth.body?.service === 'order-service', orderHealth.error || JSON.stringify(orderHealth.body));
  check(`payment-service trả lời ở ${PAYMENT_URL}`, paymentHealth.body?.service === 'payment-service', paymentHealth.error || JSON.stringify(paymentHealth.body));

  clickhouse = await findClickHouse().catch(() => undefined);
  const chOk = check(`tìm thấy container ClickHouse của SigNoz`, Boolean(clickhouse), clickhouse || `không thấy ${CLICKHOUSE_CANDIDATES.join(' / ')} (đặt CLICKHOUSE_CONTAINER)`);
  if (!orderHealth.body || !chOk) return finish(startedAt);

  // [2] Sinh request mẫu, giữ lại trace ID ---------------------------------------------------
  console.log('\n[2] Gọi API, ghi lại trace ID từ header X-Trace-Id');
  const success = await orderUntil(201, 40);
  check('POST /api/orders → 201', Boolean(success), success ? `trace ${success.traceId}, lần thử ${success.attempt}` : 'không có đơn nào thành công sau 40 lần — PAYMENT_FAILURE_RATE đang là 1?');
  const failed = await orderUntil(502, 80);
  check('POST /api/orders → 502 (ngân hàng giả lập lỗi)', Boolean(failed), failed ? `trace ${failed.traceId}, lần thử ${failed.attempt}` : 'không có đơn nào lỗi sau 80 lần — PAYMENT_FAILURE_RATE đang là 0?');
  const appError = await call('GET', `${ORDER_URL}/api/error`);
  check('GET /api/error → 500', appError.status === 500, `trace ${appError.traceId}`);
  const dbError = await call('GET', `${ORDER_URL}/api/error?type=db`);
  check('GET /api/error?type=db → 500', dbError.status === 500, `trace ${dbError.traceId}`);
  const notFound = await call('GET', `${ORDER_URL}/api/products/p-9999`);
  check('GET /api/products/p-9999 → 404', notFound.status === 404, `trace ${notFound.traceId}`);
  for (let i = 0; i < 3; i += 1) await call('GET', `${ORDER_URL}/health`);

  const traces = { success, failed, appError, dbError, notFound };
  const traceIds = Object.values(traces).filter((r) => r?.traceId).map((r) => r.traceId);
  check('mọi response đều có X-Trace-Id 32 ký tự hex', traceIds.length === 5 && traceIds.every((id) => /^[0-9a-f]{32}$/.test(id)));
  if (!success || !failed) return finish(startedAt);

  // [3] Chờ dữ liệu vào ClickHouse -------------------------------------------------------------
  // Mỗi service gửi span theo lô riêng (~5 s/lô), collector lại gom lô thêm một lần, nên các span của
  // CÙNG một trace có thể tới cách nhau vài giây. Phải chờ tới khi trace "đủ", không chỉ có span gốc.
  process.stdout.write(`\n[3] Chờ trace vào ClickHouse (tối đa ${TIMEOUT_MS / 1000} s) ... `);
  const complete = {
    [success.traceId]: (t) => t.services === 2 && t.payment_handler > 0,
    [failed.traceId]: (t) => t.services === 2 && t.bank > 0 && t.update_products === 2,
  };
  const waitStart = Date.now();
  let ready = [];
  while (Date.now() - waitStart < TIMEOUT_MS) {
    const rows = await sql(`SELECT trace_id, countIf(parent_span_id = '') AS roots, uniqExact(serviceName) AS services,
        countIf(name = 'request handler - /payments') AS payment_handler, countIf(name = 'bank.authorize') AS bank,
        countIf(name = 'UPDATE shop.products') AS update_products
      FROM signoz_traces.distributed_signoz_index_v3
      WHERE timestamp > now() - INTERVAL 30 MINUTE AND trace_id IN (${quoteList(traceIds)})
      GROUP BY trace_id`);
    ready = rows.filter((t) => Number(t.roots) > 0 && (complete[t.trace_id] || (() => true))({
      services: Number(t.services), payment_handler: Number(t.payment_handler), bank: Number(t.bank), update_products: Number(t.update_products),
    }));
    if (ready.length === traceIds.length) break;
    await sleep(3000);
  }
  console.log(`${Math.round((Date.now() - waitStart) / 1000)} s`);
  check('đủ 5 trace đã vào ClickHouse (kể cả phần của payment-service)', ready.length === traceIds.length, `${ready.length}/${traceIds.length}`);

  // [4] Traces ---------------------------------------------------------------------------------
  console.log('\n[4] Traces');
  const spansOf = (traceId) =>
    sql(`SELECT serviceName AS svc, name, kind_string AS kind, span_id, parent_span_id, has_error,
           response_status_code AS code, dbSystem, dbName, externalHttpUrl,
           resources_string['deployment.environment'] AS env, resources_string['service.version'] AS ver,
           resources_string['service.namespace'] AS ns, attributes_string['app.customer.id'] AS customer
         FROM signoz_traces.distributed_signoz_index_v3
         WHERE timestamp > now() - INTERVAL 30 MINUTE AND trace_id = '${traceId}'`);

  const ok = await spansOf(success.traceId);
  const services = [...new Set(ok.map((s) => s.svc))].sort();
  check('đơn thành công: trace đi qua cả order-service và payment-service', services.join(',') === 'order-service,payment-service', services.join(', '));
  check('đơn thành công: có ít nhất 15 span', ok.length >= 15, `${ok.length} span`);
  const okRoot = ok.find((s) => s.parent_span_id === '');
  check('đơn thành công: span gốc POST /api/orders, mã 201, không lỗi', okRoot?.name === 'POST /api/orders' && okRoot.code === '201' && !okRoot.has_error);
  const fetchSpan = ok.find((s) => s.svc === 'order-service' && s.kind === 'Client' && s.name === 'POST');
  const paymentServer = ok.find((s) => s.svc === 'payment-service' && s.name === 'POST /payments');
  check('traceparent: span của payment-service là con của span fetch bên order-service', Boolean(fetchSpan && paymentServer && paymentServer.parent_span_id === fetchSpan.span_id));
  check('External Calls: span fetch có externalHttpUrl = payment-service', fetchSpan?.externalHttpUrl === 'payment-service', fetchSpan?.externalHttpUrl);
  const select = ok.find((s) => s.name === 'SELECT shop.products');
  check('Database Calls: span DB có dbSystem = postgresql, dbName = shop', select?.dbSystem === 'postgresql' && select?.dbName === 'shop');
  check('thuộc tính nghiệp vụ app.customer.id có trên span', ok.some((s) => s.customer === 'c-verify'));
  check(
    'resource: deployment.environment, service.version, service.namespace',
    Boolean(okRoot?.env && okRoot?.ver && okRoot?.ns === 'shop-demo'),
    `${okRoot?.env} / ${okRoot?.ver} / ${okRoot?.ns}`
  );

  const bad = await spansOf(failed.traceId);
  const errorSpans = bad.filter((s) => s.has_error).map((s) => `${s.svc}:${s.name}`);
  check('đơn thất bại: span lỗi gốc là bank.authorize của payment-service', errorSpans.includes('payment-service:bank.authorize'), errorSpans.join(', '));
  const badRoot = bad.find((s) => s.parent_span_id === '');
  check('đơn thất bại: span gốc mã 502 và bị đánh dấu lỗi', badRoot?.code === '502' && Boolean(badRoot?.has_error));
  check('đơn thất bại: có bước bù trừ (2 lần UPDATE shop.products)', bad.filter((s) => s.name === 'UPDATE shop.products').length === 2);

  const nf = await spansOf(notFound.traceId);
  check('404: không span nào bị đánh dấu lỗi', nf.length > 0 && nf.every((s) => !s.has_error), `${nf.filter((s) => s.has_error).length} span lỗi`);

  const health = await sql(`SELECT count() AS n FROM signoz_traces.distributed_signoz_index_v3
    WHERE timestamp > now() - INTERVAL 30 MINUTE AND (name = 'GET /health' OR attributes_string['url.path'] = '/health')`);
  check('/health không tạo trace', Number(health[0].n) === 0, `${health[0].n} span`);

  // [5] Exceptions -----------------------------------------------------------------------------
  console.log('\n[5] Exceptions');
  const exceptions = await sql(`SELECT traceID, serviceName, exceptionType, exceptionMessage FROM signoz_traces.distributed_signoz_error_index_v2
    WHERE timestamp > now() - INTERVAL 30 MINUTE AND traceID IN (${quoteList([failed.traceId, appError.traceId, dbError.traceId])})`);
  const exOf = (traceId) => exceptions.filter((e) => e.traceID === traceId);
  check('GET /api/error: exception "Lỗi cố ý..."', exOf(appError.traceId).some((e) => e.exceptionMessage.startsWith('Lỗi cố ý')));
  check('GET /api/error?type=db: exception.type = 57014', exOf(dbError.traceId).some((e) => e.exceptionType === '57014'));
  check(
    'đơn thất bại: exception ở cả 2 service',
    exOf(failed.traceId).some((e) => e.serviceName === 'payment-service') && exOf(failed.traceId).some((e) => e.serviceName === 'order-service' && e.exceptionType === 'HttpError')
  );

  // [6] Logs -----------------------------------------------------------------------------------
  console.log('\n[6] Logs');
  const logsOf = (traceId) =>
    sql(`SELECT resources_string['service.name'] AS svc, severity_text AS sev, body, attributes_string['exception.type'] AS exType
         FROM signoz_logs.distributed_logs_v2
         WHERE timestamp > toUnixTimestamp64Nano(now64() - INTERVAL 30 MINUTE) AND trace_id = '${traceId}'`);
  let okLogs = [];
  let badLogs = [];
  const logWait = Date.now();
  while (Date.now() - logWait < 30_000) {
    [okLogs, badLogs] = await Promise.all([logsOf(success.traceId), logsOf(failed.traceId)]);
    if (okLogs.some((l) => l.svc === 'payment-service') && badLogs.some((l) => l.sev === 'error')) break;
    await sleep(3000);
  }
  check('log của đơn thành công mang trace_id, từ cả 2 service', ['order-service', 'payment-service'].every((svc) => okLogs.some((l) => l.svc === svc)), `${okLogs.length} dòng`);
  check('log "Đơn đã thanh toán" mức info', okLogs.some((l) => l.body === 'Đơn đã thanh toán' && l.sev === 'info'));
  check('log lỗi của đơn thất bại có exception.type = HttpError', badLogs.some((l) => l.sev === 'error' && l.exType === 'HttpError'));

  // [7] Metrics --------------------------------------------------------------------------------
  console.log('\n[7] Metrics (đợi tối đa 90 s: SDK gửi 15 s một lần, span metrics của SigNoz 60 s một lần)');
  const wanted = [
    ['shop.orders', 'order-service'],
    ['shop.revenue', 'order-service'],
    ['shop.product.stock', 'order-service'],
    ['http.server.request.duration.bucket', 'payment-service'],
    ['nodejs.eventloop.delay.p99', 'order-service'],
    ['signoz_calls_total', 'order-service'], // do collector của SigNoz tính từ span (trang Services)
  ];
  // Chỉ tính sample ghi SAU lúc bắt đầu verify: dữ liệu cũ của lần chạy trước không được làm check "đạt".
  // Mốc lùi về đầu phút vì sample delta của span metrics (signoz_calls_total...) được đóng dấu đầu phút.
  const freshSince = Math.floor(startedAt / 60_000) * 60_000;
  const names = wanted.map(([m]) => `'${m}'`).join(',');
  let found = new Set();
  const metricWait = Date.now();
  while (Date.now() - metricWait < 90_000) {
    const rows = await sql(`SELECT DISTINCT s.metric_name AS metric_name, JSONExtractString(ts.labels, 'service.name') AS svc
      FROM signoz_metrics.distributed_samples_v4 AS s
      INNER JOIN (
        SELECT DISTINCT fingerprint, labels FROM signoz_metrics.distributed_time_series_v4
        WHERE metric_name IN (${names}) AND unix_milli > (toUnixTimestamp(now()) - 7200) * 1000
      ) AS ts ON s.fingerprint = ts.fingerprint
      WHERE s.metric_name IN (${names}) AND s.unix_milli >= ${freshSince}`);
    found = new Set(rows.map((r) => `${r.metric_name}|${r.svc}`));
    if (wanted.every(([m, s]) => found.has(`${m}|${s}`))) break;
    await sleep(5000);
  }
  for (const [metric, svc] of wanted) check(`${metric} (${svc})`, found.has(`${metric}|${svc}`));

  return finish(startedAt);
}

function finish(startedAt) {
  const passed = results.filter((r) => r.ok).length;
  const failedChecks = results.length - passed;
  console.log(`\nKết quả: ${passed}/${results.length} check đạt (${Math.round((Date.now() - startedAt) / 1000)} s)`);
  if (failedChecks > 0) console.log('Chưa đạt — xem mục "Xử lý sự cố" trong README, hoặc chạy: node scripts/check-otlp.js');
  process.exit(failedChecks > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(`\nLỗi khi chạy verify: ${err.message}`);
  process.exit(1);
});
