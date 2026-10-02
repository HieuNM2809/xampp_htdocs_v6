'use strict';

const { trace, context, SpanStatusCode } = require('@opentelemetry/api');
const { ATTR_ERROR_TYPE } = require('@opentelemetry/semantic-conventions');
const pkg = require('../../package.json');

/**
 * Tracer dùng chung cho code của ứng dụng. Tên và version ở đây hiện trong Jaeger dưới dạng
 * otel.scope.name / otel.scope.version, giúp phân biệt span "tự viết" với span do thư viện
 * instrumentation sinh ra.
 */
const tracer = trace.getTracer('otel-tracing-demo', pkg.version);

/**
 * Đánh dấu span là lỗi theo 3 bước OpenTelemetry khuyến nghị:
 *  1. recordException: thêm event "exception" (exception.type, exception.message, exception.stacktrace)
 *  2. error.type: phân loại lỗi, ít giá trị khác nhau, dùng để lọc và thống kê
 *  3. setStatus(ERROR): span hiện màu đỏ trong Jaeger
 */
function markSpanError(span, err) {
  const error = err instanceof Error ? err : new Error(String(err));
  span.recordException(error);
  span.setAttribute(ATTR_ERROR_TYPE, String(error.code || error.name));
  span.setStatus({ code: SpanStatusCode.ERROR, message: error.message });
}

/**
 * Chạy `fn` bên trong một span mới và lo phần lặp lại:
 *  - span được đặt làm span active, nên span con (kể cả span tự động của ioredis, http...)
 *    tự lồng vào đúng chỗ
 *  - có lỗi: markSpanError rồi ném tiếp, để code gọi tự quyết định xử lý
 *  - span LUÔN được end() trong finally, kể cả khi lỗi
 *  - thành công: để status UNSET, không đặt OK (theo khuyến nghị của spec OpenTelemetry)
 *
 * @param {string} name tên span. Nên ít giá trị khác nhau, không nhét id vào tên.
 * @param {import('@opentelemetry/api').SpanOptions} options kind, attributes, links...
 * @param {(span: import('@opentelemetry/api').Span) => any} fn
 * @param {import('@opentelemetry/api').Context} [parentContext] mặc định là context đang active
 */
function withSpan(name, options, fn, parentContext = context.active()) {
  return tracer.startActiveSpan(name, options, parentContext, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      markSpanError(span, err);
      throw err;
    } finally {
      span.end();
    }
  });
}

module.exports = { tracer, withSpan, markSpanError };
