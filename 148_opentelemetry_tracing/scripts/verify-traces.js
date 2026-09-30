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
  // Express 5 chạy trên package `router`. Nếu instrumentation-express và instrumentation-router
  // cùng bật, mỗi middleware/route bị tạo span 2 lần (xuất hiện span "middleware - patched").
  for (const service of ['api-gateway', 'order-service']) {
    const handlers = spans.filter((x) => x.service === service && x.name.startsWith('request handler - '));
    const patched = spans.some((x) => x.service === service && x.name === 'middleware - patched');
    check(s, `${service}: span Express không bị lặp`, handlers.length === 1 && !patched, `${handlers.length} span request handler`);
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
