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
