'use strict';

const { trace } = require('@opentelemetry/api');

/** trace_id của trace hiện tại. Không có span active (ví dụ chạy test không có SDK) thì trả undefined. */
function currentTraceId() {
  return trace.getActiveSpan()?.spanContext().traceId;
}

/**
 * Error middleware dùng chung. Chỉ nhận lỗi đi qua next(err): lỗi phân tích body
 * (express.json() gắn sẵn status 400) hoặc lỗi bất ngờ (500).
 * Lỗi nghiệp vụ đã biết được route tự trả response, không đi qua đây.
 */
function errorHandler(log) {
  // Express nhận ra error middleware nhờ đủ 4 tham số, nên phải giữ `next` dù không dùng.
  return (err, req, res, next) => {
    const isClientError = Number.isInteger(err.status) && err.status >= 400 && err.status < 500;
    const status = isClientError ? err.status : 500;
    log[isClientError ? 'warn' : 'error']('request lỗi', { status, reason: err.message });
    res.status(status).json({
      error: isClientError ? 'BAD_REQUEST' : 'INTERNAL_ERROR',
      message: err.message,
      traceId: currentTraceId(),
    });
  };
}

module.exports = { currentTraceId, errorHandler };
