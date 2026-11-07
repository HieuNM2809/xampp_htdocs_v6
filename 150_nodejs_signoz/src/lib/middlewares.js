'use strict';

/**
 * Middleware Express dùng chung cho cả order-service và payment-service.
 */

const { trace } = require('@opentelemetry/api');
const { logger } = require('./logger');

/**
 * - Trả trace ID về cho client qua header X-Trace-Id. Copy giá trị đó dán vào SigNoz
 *   (http://localhost:8080/trace/<traceId>) là mở đúng trace của request.
 * - Ghi một dòng access log khi response kết thúc. instrumentation-http gắn sự kiện "finish" của
 *   response vào context của span HTTP gốc, nên dòng log này mang đúng trace_id/span_id của request.
 */
function requestContext() {
  // Hàm có tên: instrumentation-express đặt tên span theo tên hàm → "middleware - requestContext".
  // Viết arrow function ẩn danh thì span chỉ hiện "middleware - <anonymous>".
  return function requestContext(req, res, next) {
    const traceId = trace.getActiveSpan()?.spanContext().traceId;
    if (traceId) res.setHeader('X-Trace-Id', traceId);

    const startedAt = performance.now();
    res.on('finish', () => {
      const durationMs = Math.round(performance.now() - startedAt);
      logger.info(
        { method: req.method, path: req.originalUrl, status: res.statusCode, durationMs },
        `${req.method} ${req.originalUrl} → ${res.statusCode} (${durationMs} ms)`
      );
    });
    next();
  };
}

/** 404 cho route không tồn tại. */
function notFound() {
  return function notFound(req, res) {
    res.status(404).json({ error: `Không có route ${req.method} ${req.path}` });
  };
}

/**
 * Bắt mọi lỗi chưa được xử lý. Express 5 tự chuyển lỗi của async handler (promise bị reject) tới đây.
 *
 * Không cần thêm code tracing nào ở đây:
 *   - instrumentation-express đã ghi exception vào span "request handler - ..." khi lỗi đi qua next(err);
 *   - instrumentation-http tự đặt status ERROR cho span HTTP gốc khi response có mã >= 500.
 * Việc còn lại: ghi log kèm stack trace, trả JSON có traceId để client báo lỗi kèm mã tra cứu.
 */
function errorHandler() {
  // Express nhận ra error handler nhờ hàm có ĐÚNG 4 tham số, nên phải giữ `next` dù ít dùng.
  return function errorHandler(err, req, res, next) {
    if (res.headersSent) return next(err);

    const status = Number(err.status || err.statusCode) || 500;
    const traceId = trace.getActiveSpan()?.spanContext().traceId;

    if (status >= 500) {
      // Key `err` được pino in kèm stack trace, và instrumentation-pino chuyển thành
      // thuộc tính exception.* của log record trên SigNoz.
      logger.error({ err, path: req.originalUrl }, `${req.method} ${req.originalUrl} lỗi: ${err.message}`);
    } else {
      // 4xx (ví dụ JSON gửi lên sai cú pháp) là lỗi của client, không phải sự cố của hệ thống.
      logger.warn({ path: req.originalUrl, status }, `${req.method} ${req.originalUrl} bị từ chối: ${err.message}`);
    }

    // Demo nên trả nguyên thông báo lỗi. Trên production đừng để lộ chi tiết lỗi 500 ra ngoài.
    res.status(status).json({ error: err.message, traceId });
  };
}

module.exports = { requestContext, notFound, errorHandler };
