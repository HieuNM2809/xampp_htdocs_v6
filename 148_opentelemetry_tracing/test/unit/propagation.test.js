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
