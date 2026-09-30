'use strict';

const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const { setupTestTracing } = require('../helpers/otel');
const { withSpan } = require('../../src/shared/tracer');
const { createLogger } = require('../../src/shared/logger');

beforeEach(() => {
  setupTestTracing();
});

test('log bên trong span có trace_id và span_id của span đó', async () => {
  const lines = [];
  const log = createLogger('unit-svc', (line) => lines.push(line));
  let ids;
  await withSpan('unit.log', {}, async (span) => {
    ids = span.spanContext();
    log.info('hello', { orderId: 'ORD-1' });
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^\d{2}:\d{2}:\d{2}\.\d{3} INFO  \[unit-svc\] hello orderId=ORD-1 /);
  assert.ok(lines[0].endsWith(`trace_id=${ids.traceId} span_id=${ids.spanId}`), lines[0]);
});

test('xuống dòng trong giá trị được escape, một lần log luôn là một dòng', () => {
  const lines = [];
  const log = createLogger('unit-svc', (line) => lines.push(line));
  log.warn('request lỗi', { reason: 'dòng 1\ndòng 2\r\nINFO giả mạo' });
  assert.equal(lines.length, 1);
  assert.ok(!/[\r\n]/.test(lines[0]), lines[0]);
  assert.ok(lines[0].endsWith('reason=dòng 1\\ndòng 2\\r\\nINFO giả mạo'), lines[0]);
});

test('log ngoài span không có trace_id; field undefined bị bỏ; object in dạng JSON', () => {
  const lines = [];
  const log = createLogger('unit-svc', (line) => lines.push(line));
  log.error('boom', { status: 500, skip: undefined, detail: { a: 1 } });
  assert.match(lines[0], /^\d{2}:\d{2}:\d{2}\.\d{3} ERROR \[unit-svc\] boom status=500 detail=\{"a":1\}$/);
});
