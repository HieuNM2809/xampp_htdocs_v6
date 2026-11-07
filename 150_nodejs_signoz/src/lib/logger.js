'use strict';

/**
 * Logger dùng chung: pino, ghi JSON ra stdout.
 *
 * Không có dòng code nào gửi log tới SigNoz ở đây. instrumentation-pino (nằm trong
 * auto-instrumentations-node, đã bật ở tracing.js) tự làm hai việc:
 *
 *   1. Log correlation: chèn trace_id, span_id, trace_flags vào mỗi dòng log được ghi khi đang có
 *      span chạy. Trên SigNoz, từ một dòng log bấm sang được trace tương ứng và ngược lại.
 *   2. Log sending: gửi một bản sao của mỗi dòng log thành LogRecord của OpenTelemetry, đi qua
 *      BatchLogRecordProcessor + OTLPLogExporter (khai báo trong tracing.js) tới tab Logs của SigNoz.
 *
 * Điều kiện duy nhất: pino phải được require SAU khi tracing.js chạy. Cờ --require đảm bảo điều đó.
 */

const pino = require('pino');

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  // In "level":"info" thay vì "level":30 cho dễ đọc khi xem `docker compose logs`.
  // Mức độ (severity) gửi sang SigNoz vẫn đúng: instrumentation-pino lấy level dạng số trước khi format.
  formatters: {
    level: (label) => ({ level: label }),
  },
  // "time":"2026-11-05T10:00:00.000Z" thay vì số mili giây. instrumentation-pino hiểu cả hai dạng.
  timestamp: pino.stdTimeFunctions.isoTime,
});

module.exports = { logger };
