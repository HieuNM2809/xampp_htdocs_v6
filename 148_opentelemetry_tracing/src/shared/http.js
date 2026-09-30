'use strict';

const { STATUS_CODES } = require('node:http');
const { trace } = require('@opentelemetry/api');

/** trace_id của trace hiện tại. Không có span active (ví dụ chạy test không có SDK) thì trả undefined. */
function currentTraceId() {
  return trace.getActiveSpan()?.spanContext().traceId;
}

/**
 * Error middleware dùng chung. Chỉ nhận lỗi đi qua next(err): lỗi của express.json() (có sẵn
 * status 4xx, ví dụ 400 JSON sai cú pháp, 413 body quá lớn) hoặc lỗi bất ngờ (500).
 * Lỗi nghiệp vụ đã biết được route tự trả response, không đi qua đây.
 */
function errorHandler(log) {
  // Express nhận ra error middleware nhờ đủ 4 tham số, nên phải giữ `next`.
  return (err, req, res, next) => {
    // Response đã gửi một phần thì không ghi thêm được nữa: để Express tự đóng kết nối.
    if (res.headersSent) return next(err);
    const isClientError = Number.isInteger(err.status) && err.status >= 400 && err.status < 500;
    const status = isClientError ? err.status : 500;
    log[isClientError ? 'warn' : 'error']('request lỗi', { status, reason: err.message });
    res.status(status).json({
      // 4xx: mã lấy theo HTTP status, ví dụ 400 -> BAD_REQUEST, 413 -> PAYLOAD_TOO_LARGE.
      error: isClientError ? STATUS_CODES[status].toUpperCase().replace(/[^A-Z0-9]+/g, '_') : 'INTERNAL_ERROR',
      // Chỉ trả nguyên thông báo khi lỗi được đánh dấu là an toàn để lộ (err.expose). Lỗi 5xx có
      // thể chứa host, cổng, thông báo của thư viện: những thứ đó chỉ nằm trong log và span.
      message: isClientError && err.expose ? err.message : 'Lỗi hệ thống. Tra traceId trong Jaeger để xem chi tiết.',
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
