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
