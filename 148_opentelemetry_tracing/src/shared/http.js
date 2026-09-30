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

/**
 * Mở cổng cho Express app. Express 5 truyền lỗi (ví dụ EADDRINUSE khi cổng đã bị chiếm) vào
 * callback của listen(). Không kiểm tra `err` thì service vẫn in "đang nghe" dù không nghe gì.
 */
function listen(app, port, log, fields) {
  return app.listen(port, (err) => {
    if (err) {
      log.error(`không mở được cổng ${port}`, { reason: err.message });
      process.exit(1);
    }
    log.info(`đang nghe http://localhost:${port}`, fields);
  });
}

module.exports = { currentTraceId, errorHandler, listen };
