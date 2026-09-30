'use strict';

/**
 * Dựng OpenTelemetry "trong bộ nhớ" cho unit test. Span không gửi đi đâu cả mà nằm trong
 * InMemorySpanExporter để test đọc lại.
 * Dùng @opentelemetry/sdk-trace (package thay thế sdk-trace-base / sdk-trace-node), kèm
 * context manager và propagator W3C, giống cách NodeSDK cấu hình khi chạy thật.
 */
const { context, propagation, trace } = require('@opentelemetry/api');
const { TracerProvider, InMemorySpanExporter, SimpleSpanProcessor } = require('@opentelemetry/sdk-trace');
const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
const {
  CompositePropagator,
  W3CTraceContextPropagator,
  W3CBaggagePropagator,
} = require('@opentelemetry/core');

const exporter = new InMemorySpanExporter();
let installed = false;

/** Cài một lần cho mỗi tiến trình test, rồi xoá span của test trước. */
function setupTestTracing() {
  if (!installed) {
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
    propagation.setGlobalPropagator(
      new CompositePropagator({ propagators: [new W3CTraceContextPropagator(), new W3CBaggagePropagator()] })
    );
    // sdk-trace nhận options dạng object ({ exporter }), khác sdk-trace-base (truyền thẳng exporter).
    // Truyền sai kiểu thì span vẫn được tạo nhưng không bao giờ tới exporter, và SDK không báo lỗi.
    trace.setGlobalTracerProvider(new TracerProvider({ spanProcessors: [new SimpleSpanProcessor({ exporter })] }));
    installed = true;
  }
  exporter.reset();
  return exporter;
}

/** Lấy span đã kết thúc theo tên. Không thấy thì ném lỗi, kèm danh sách span đang có. */
function findSpan(name) {
  const spans = exporter.getFinishedSpans();
  const span = spans.find((s) => s.name === name);
  if (!span) {
    throw new Error(`Không thấy span "${name}". Đang có: ${spans.map((s) => s.name).join(', ') || '(trống)'}`);
  }
  return span;
}

module.exports = { setupTestTracing, findSpan };
