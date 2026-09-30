'use strict';

/**
 * Chạy dưới `node --require ./src/tracing.js` (xem test/integration/tracing.test.js):
 * tạo một span, in trace id, rồi tắt SDK để flush ngay thay vì đợi lô 5 giây.
 */
const { trace } = require('@opentelemetry/api');
const { sdk } = require('../../../src/tracing'); // cùng module đã nạp qua --require (lấy từ cache)

const span = trace.getTracer('integration-test').startSpan('smoke-span');
span.end();
console.log(`TRACE_ID=${span.spanContext().traceId}`);

// EMIT_SPAN_WAIT_MS: chờ thêm trước khi tắt, để BatchSpanProcessor tự gửi một lô như service thật.
const waitMs = Number(process.env.EMIT_SPAN_WAIT_MS) || 0;
setTimeout(() => {
  sdk
    .shutdown()
    .catch((err) => console.error(`[emit-span] export thất bại: ${err.message}`))
    .finally(() => process.exit(0));
}, waitMs);
