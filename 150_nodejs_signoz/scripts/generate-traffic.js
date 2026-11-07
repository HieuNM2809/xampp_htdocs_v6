#!/usr/bin/env node
'use strict';

/**
 * Sinh traffic giả lập cho order-service để có dữ liệu xem trên SigNoz.
 *
 *   node scripts/generate-traffic.js                         60 giây, 5 request/giây → http://localhost:3400
 *   node scripts/generate-traffic.js --duration 300 --rps 10
 *   node scripts/generate-traffic.js --duration 0            chạy tới khi bấm Ctrl+C
 *   node scripts/generate-traffic.js --url http://localhost:3400
 *
 * Không cần cài Node trên máy: chạy ngay trong container của order-service
 *
 *   docker compose exec order-service node scripts/generate-traffic.js
 *
 * Script này KHÔNG nạp tracing.js nên bản thân nó không gửi telemetry: mọi trace trên SigNoz bắt đầu
 * từ order-service, đúng như khi người dùng thật gọi API.
 */

const { parseArgs } = require('node:util');

const { values } = parseArgs({
  options: {
    url: { type: 'string', default: process.env.TARGET_URL || 'http://localhost:3400' },
    duration: { type: 'string', default: '60' },
    rps: { type: 'string', default: '5' },
  },
});

const BASE_URL = values.url.replace(/\/+$/, '');
const DURATION_S = Math.max(Number(values.duration) || 0, 0);
const RPS = Math.min(Math.max(Number(values.rps) || 5, 0.2), 200);
const SIGNOZ_UI_URL = (process.env.SIGNOZ_UI_URL || 'http://localhost:8080').replace(/\/+$/, '');

const PRODUCT_IDS = ['p-1001', 'p-1002', 'p-1003', 'p-1004', 'p-1005'];
const CUSTOMER_IDS = Array.from({ length: 20 }, (_, i) => `c-${String(i + 1).padStart(3, '0')}`);
const recentOrderIds = [];

const pick = (list) => list[Math.floor(Math.random() * list.length)];
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

// Kịch bản và trọng số (tổng 100): phần lớn là traffic bình thường, xen một ít lỗi để có error trace.
const SCENARIOS = [
  { name: 'GET  /api/products', weight: 22, run: () => call('GET', '/api/products') },
  { name: 'GET  /api/products/:id', weight: 15, run: () => call('GET', `/api/products/${pick(PRODUCT_IDS)}`) },
  { name: 'GET  /api/products/:id  (404)', weight: 3, run: () => call('GET', '/api/products/p-9999') },
  { name: 'POST /api/orders', weight: 35, run: createOrder },
  { name: 'POST /api/orders  (400)', weight: 3, run: () => call('POST', '/api/orders', { productId: '', quantity: 0 }) },
  { name: 'GET  /api/orders/:id', weight: 8, run: () => call('GET', `/api/orders/${pick(recentOrderIds) ?? 'ORD-000001'}`) },
  { name: 'GET  /api/error', weight: 4, run: () => call('GET', '/api/error') },
  { name: 'GET  /api/error?type=db', weight: 3, run: () => call('GET', '/api/error?type=db') },
  { name: 'GET  /api/slow', weight: 7, run: () => call('GET', '/api/slow') },
];
const TOTAL_WEIGHT = SCENARIOS.reduce((sum, s) => sum + s.weight, 0);

function pickScenario() {
  let r = Math.random() * TOTAL_WEIGHT;
  for (const scenario of SCENARIOS) {
    r -= scenario.weight;
    if (r < 0) return scenario;
  }
  return SCENARIOS[0];
}

/** Gọi một endpoint, không bao giờ ném lỗi: lỗi mạng trả về status 'ERR'. */
async function call(method, path, body) {
  const startedAt = performance.now();
  try {
    const res = await fetch(BASE_URL + path, {
      method,
      headers: body ? { 'content-type': 'application/json' } : undefined,
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
    const json = await res.json().catch(() => null);
    return { status: res.status, traceId: res.headers.get('x-trace-id'), body: json, ms: performance.now() - startedAt };
  } catch (err) {
    return { status: 'ERR', error: err.cause?.code || err.name, ms: performance.now() - startedAt };
  }
}

async function createOrder() {
  const result = await call('POST', '/api/orders', {
    productId: pick(PRODUCT_IDS),
    quantity: randomInt(1, 3),
    customerId: pick(CUSTOMER_IDS),
  });
  if (result.status === 201 && result.body?.id) {
    recentOrderIds.push(result.body.id);
    if (recentOrderIds.length > 50) recentOrderIds.shift();
  }
  return result;
}

// ---------------------------------------------------------------------------------------------
// Thống kê
// ---------------------------------------------------------------------------------------------
const stats = new Map(SCENARIOS.map((s) => [s.name, { count: 0, '2xx': 0, '4xx': 0, '5xx': 0, ERR: 0, totalMs: 0 }]));
const errorTraces = []; // vài trace lỗi gần nhất, để mở trên SigNoz

function statusClass(status) {
  return status === 'ERR' ? 'ERR' : `${Math.floor(status / 100)}xx`;
}

function record(name, result) {
  const s = stats.get(name);
  s.count += 1;
  s.totalMs += result.ms;
  const cls = statusClass(result.status);
  if (cls in s) s[cls] += 1;
  if (result.status !== 'ERR' && result.status >= 500 && result.traceId) {
    errorTraces.push({ name, status: result.status, traceId: result.traceId, error: result.body?.error });
    if (errorTraces.length > 5) errorTraces.shift();
  }
}

function totals() {
  const t = { count: 0, '2xx': 0, '4xx': 0, '5xx': 0, ERR: 0 };
  for (const s of stats.values()) for (const k of Object.keys(t)) t[k] += s[k];
  return t;
}

function printSummary() {
  const header = `${'Kịch bản'.padEnd(32)}${'Số lần'.padStart(8)}${'2xx'.padStart(7)}${'4xx'.padStart(7)}${'5xx'.padStart(7)}${'Lỗi mạng'.padStart(10)}${'TB (ms)'.padStart(10)}`;
  console.log(`\n${header}\n${'─'.repeat(header.length)}`);
  for (const [name, s] of stats) {
    if (s.count === 0) continue;
    console.log(
      `${name.padEnd(32)}${String(s.count).padStart(8)}${String(s['2xx']).padStart(7)}${String(s['4xx']).padStart(7)}` +
        `${String(s['5xx']).padStart(7)}${String(s.ERR).padStart(10)}${String(Math.round(s.totalMs / s.count)).padStart(10)}`
    );
  }
  const t = totals();
  console.log(`${'─'.repeat(header.length)}\nTổng: ${t.count} request — 2xx=${t['2xx']} 4xx=${t['4xx']} 5xx=${t['5xx']} lỗi mạng=${t.ERR}`);

  if (errorTraces.length > 0) {
    console.log('\nVài trace lỗi gần nhất, mở trên SigNoz (hoặc dán trace ID vào ô tìm kiếm của Traces):');
    for (const e of errorTraces) {
      console.log(`  ${e.status} ${e.name.trim()}  ${SIGNOZ_UI_URL}/trace/${e.traceId}`);
      if (e.error) console.log(`      ${e.error}`);
    }
  }
  console.log('\nDữ liệu xuất hiện trên SigNoz sau khoảng 10–30 giây (trace gửi theo lô 5 giây, metric 15 giây).');
}

// ---------------------------------------------------------------------------------------------
// Chạy
// ---------------------------------------------------------------------------------------------
async function main() {
  // Kiểm tra order-service đang chạy trước khi bắn traffic, để báo lỗi dễ hiểu.
  const health = await call('GET', '/health');
  if (health.status !== 200) {
    const reason = health.status === 'ERR' ? health.error : `HTTP ${health.status}`;
    console.error(`Không gọi được ${BASE_URL}/health (${reason}).`);
    console.error('Kiểm tra: `docker compose ps` (order-service phải "healthy"), hoặc truyền --url cho đúng.');
    process.exit(1);
  }
  if (health.body?.service !== 'order-service') {
    // Có server trả lời nhưng không phải order-service: thường là app khác đang chiếm cổng này.
    console.error(`${BASE_URL}/health trả lời ${JSON.stringify(health.body)}: đây KHÔNG phải order-service.`);
    console.error('Có ứng dụng khác đang chiếm cổng. Đổi ORDER_SERVICE_PORT trong .env, chạy lại');
    console.error('`docker compose up -d`, rồi gọi script với --url http://localhost:<cổng-mới>.');
    process.exit(1);
  }

  console.log(`Bắn traffic vào ${BASE_URL}: ${RPS} request/giây, ${DURATION_S > 0 ? `${DURATION_S} giây` : 'tới khi bấm Ctrl+C'}`);
  const startedAt = Date.now();
  const inFlight = new Set();

  const sender = setInterval(() => {
    const scenario = pickScenario();
    const p = scenario.run().then((result) => record(scenario.name, result));
    inFlight.add(p);
    p.finally(() => inFlight.delete(p));
  }, 1000 / RPS);

  const progress = setInterval(() => {
    const t = totals();
    const elapsed = Math.round((Date.now() - startedAt) / 1000);
    console.log(`[${String(elapsed).padStart(4)}s] ${t.count} request: 2xx=${t['2xx']} 4xx=${t['4xx']} 5xx=${t['5xx']} lỗi mạng=${t.ERR}`);
  }, 5000);

  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(sender);
    clearInterval(progress);
    await Promise.allSettled([...inFlight]); // chờ các request đang bay về hết
    printSummary();
    process.exit(0);
  };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
  if (DURATION_S > 0) setTimeout(stop, DURATION_S * 1000);
}

main();
