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
