'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { setupTestTracing } = require('../helpers/otel');
const { runEntryOnBusyPort } = require('../helpers/entry');
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
async function callGateway(orderServiceUrl, { method = 'POST', path = '/orders', body, raw } = {}, appOptions = {}) {
  const server = http.createServer(createApp({ orderServiceUrl, ...appOptions }));
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
  // Lý do cụ thể (ECONNREFUSED, địa chỉ nội bộ) chỉ ghi vào log, không trả cho client.
  assert.doesNotMatch(res.body.message, /ECONNREFUSED|fetch failed|127\.0\.0\.1/);
  assert.ok(Date.now() - started < 6000, 'phải trả lời trong vòng timeout 5 giây');
});

test('order-service nhận request nhưng không trả lời -> 503 ngay khi hết timeout', async () => {
  const hung = http.createServer(() => {}); // nhận request rồi im lặng, không bao giờ trả lời
  const url = await listen(hung);
  try {
    const started = Date.now();
    const res = await callGateway(url, { body: ORDER }, { upstreamTimeoutMs: 300 });
    assert.equal(res.status, 503);
    assert.equal(res.body.error, 'ORDER_SERVICE_UNAVAILABLE');
    assert.ok(Date.now() - started < 2000, `phải trả lời ngay sau timeout 300 ms, mất ${Date.now() - started} ms`);
  } finally {
    await close(hung);
  }
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

test('cổng đã bị chiếm -> log lỗi EADDRINUSE và thoát với mã 1, không báo "đang nghe"', async () => {
  const { code, output } = await runEntryOnBusyPort('src/api-gateway/server.js');
  assert.equal(code, 1, output);
  assert.match(output, /EADDRINUSE/);
  assert.doesNotMatch(output, /đang nghe/);
});
