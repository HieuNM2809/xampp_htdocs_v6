'use strict';

/**
 * BƯỚC 2 + 3: khởi tạo OpenTelemetry SDK, dùng chung cho MỌI service trong ví dụ.
 *
 * File này phải chạy TRƯỚC mọi module khác của app, nên được nạp bằng cờ --require:
 *
 *   node --require ./src/tracing.js src/order-service/server.js
 *
 * Lý do: auto-instrumentation "vá" (monkey-patch) các module như http, express, ioredis
 * ngay lúc chúng được require lần đầu. Module nào đã được require trước khi sdk.start()
 * chạy thì sẽ không được vá, và sẽ không sinh span.
 */

const { randomUUID } = require('node:crypto');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-proto');
const { defaultResource, resourceFromAttributes } = require('@opentelemetry/resources');
const {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_SERVICE_NAMESPACE,
  ATTR_SERVICE_INSTANCE_ID,
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
} = require('@opentelemetry/semantic-conventions');

const pkg = require('../package.json');

// Mặc định SDK im lặng khi gửi trace thất bại (ví dụ quên `npm run infra:up`).
// Bật mức WARN để thấy lỗi. Muốn xem chi tiết hơn thì đặt OTEL_LOG_LEVEL=debug, khi đó
// NodeSDK tự cấu hình logger theo biến này.
if (!process.env.OTEL_LOG_LEVEL) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
}

const serviceName = process.env.OTEL_SERVICE_NAME || 'unknown-service';

// BƯỚC 3: resource là "danh tính" của service, được gắn vào MỌI span service này gửi đi.
// Phải merge với defaultResource(), nếu không sẽ mất các attribute telemetry.sdk.*.
// Đây chỉ là giá trị mặc định. NodeSDK merge resource do detector phát hiện (đọc
// OTEL_SERVICE_NAME, OTEL_RESOURCE_ATTRIBUTES...) SAU resource này, nên biến môi trường thắng.
const resource = defaultResource().merge(
  resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_VERSION]: pkg.version,
    [ATTR_SERVICE_NAMESPACE]: 'shop',
    [ATTR_SERVICE_INSTANCE_ID]: randomUUID(),
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: process.env.NODE_ENV || 'development',
  })
);

const sdk = new NodeSDK({
  resource,
  // Không truyền url: exporter tự đọc OTEL_EXPORTER_OTLP_ENDPOINT (mặc định http://localhost:4318)
  // rồi nối thêm /v1/traces. NodeSDK bọc exporter trong BatchSpanProcessor: span được gom lại và
  // gửi theo lô, mặc định khoảng 5 giây một lần (chỉnh bằng OTEL_BSP_SCHEDULE_DELAY).
  traceExporter: new OTLPTraceExporter(),
  // Ví dụ này chỉ dùng tracing. Không khai báo gì thì NodeSDK còn tự export metrics và logs qua
  // OTLP (OTEL_METRICS_EXPORTER / OTEL_LOGS_EXPORTER mặc định là "otlp"), trong khi Collector và
  // Jaeger ở đây chỉ nhận traces, nên cứ 60 giây lại có lỗi 404. Mảng rỗng nghĩa là không export.
  metricReaders: [],
  logRecordProcessors: [],
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': {
        // /health bị gọi liên tục (load balancer, k8s probe) nên chỉ tạo nhiễu.
        ignoreIncomingRequestHook: (req) => (req.url || '').split('?')[0] === '/health',
      },
      // dns.lookup / tcp.connect sinh rất nhiều span nhỏ mà không giúp đọc trace.
      '@opentelemetry/instrumentation-dns': { enabled: false },
      '@opentelemetry/instrumentation-net': { enabled: false },
      // Express 5 chạy trên package `router`. Bật cả instrumentation-express lẫn
      // instrumentation-router thì mỗi middleware/route bị tạo span 2 lần (thấy span
      // "middleware - patched"). Chỉ giữ instrumentation-express.
      '@opentelemetry/instrumentation-router': { enabled: false },
    }),
  ],
});

sdk.start();

const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
console.log(`[otel] tracing đã bật: service=${serviceName} export=${endpoint}`);

// Tắt êm: flush các span còn nằm trong buffer của BatchSpanProcessor trước khi thoát.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await sdk.shutdown();
    console.log(`[otel] ${signal}: đã flush span và tắt SDK`);
  } catch (err) {
    console.error(`[otel] ${signal}: lỗi khi tắt SDK: ${err.message}`);
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

module.exports = { sdk };
