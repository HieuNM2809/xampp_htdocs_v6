'use strict';

const { trace } = require('@opentelemetry/api');

const pad = (n, width = 2) => String(n).padStart(width, '0');

/** HH:MM:SS.mmm theo giờ máy. */
function timestamp(d = new Date()) {
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function formatFields(fields) {
  return Object.entries(fields)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
    .join(' ');
}

/**
 * Logger tối giản, in kèm trace_id / span_id của span đang active.
 * Copy trace_id từ terminal rồi dán vào ô tìm kiếm của Jaeger để mở đúng trace.
 * Đây là "log correlation" ở mức thủ công. Production thường dùng pino/winston cùng
 * instrumentation tương ứng để tự gắn các trường này.
 *
 * @param {string} serviceName
 * @param {(line: string) => void} [write] mặc định in ra stdout; test truyền hàm riêng để bắt output
 */
function createLogger(serviceName, write = (line) => process.stdout.write(`${line}\n`)) {
  function log(level, message, fields = {}) {
    const spanContext = trace.getActiveSpan()?.spanContext();
    const ids = spanContext ? { trace_id: spanContext.traceId, span_id: spanContext.spanId } : {};
    const tail = formatFields({ ...fields, ...ids });
    write(`${timestamp()} ${level.padEnd(5)} [${serviceName}] ${message}${tail ? ` ${tail}` : ''}`);
  }
  return {
    info: (message, fields) => log('INFO', message, fields),
    warn: (message, fields) => log('WARN', message, fields),
    error: (message, fields) => log('ERROR', message, fields),
  };
}

module.exports = { createLogger };
