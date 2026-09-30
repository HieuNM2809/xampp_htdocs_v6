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
