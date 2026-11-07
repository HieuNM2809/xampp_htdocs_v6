'use strict';

/**
 * Khởi tạo OpenTelemetry SDK: traces + metrics + logs, gửi đi bằng OTLP/HTTP.
 *
 * File này phải chạy TRƯỚC mọi module khác của app, nên được nạp bằng cờ --require:
 *
 *   node --require ./src/tracing.js src/server.js
 *
 * Lý do: auto-instrumentation "vá" (monkey-patch) các module http, express, pino, undici (fetch)...
 * đúng lúc chúng được require lần đầu. Module nào đã được require trước khi SDK khởi động thì
 * không được vá, và không sinh ra span hay log nào cả.
 *
 * Mọi cấu hình quan trọng đều đọc từ biến môi trường chuẩn của OpenTelemetry
 * (đặt trong docker-compose.yml, không sửa code khi đổi môi trường):
 *
 *   OTEL_SERVICE_NAME            tên service hiện trong SigNoz: order-service, payment-service
 *   OTEL_RESOURCE_ATTRIBUTES     các cặp key=value gắn vào MỌI span/metric/log,
 *                                ví dụ deployment.environment=docker-demo,service.version=1.0.0
 *   OTEL_EXPORTER_OTLP_ENDPOINT  địa chỉ GỐC của OTLP/HTTP receiver, ví dụ http://signoz-ingester:4318.
 *                                Exporter tự nối thêm /v1/traces, /v1/metrics, /v1/logs.
 *   OTEL_EXPORTER_OTLP_HEADERS   header gửi kèm mỗi request, ví dụ signoz-ingestion-key=<key> (SigNoz Cloud)
 *   OTEL_LOG_LEVEL               log nội bộ của SDK; đặt debug khi cần soi vì sao không thấy dữ liệu
 *   OTEL_SDK_DISABLED=true       tắt hẳn OpenTelemetry, app vẫn chạy bình thường
 */

const os = require('node:os');
const { diag, DiagConsoleLogger, DiagLogLevel } = require('@opentelemetry/api');
const { NodeSDK } = require('@opentelemetry/sdk-node');
const { getNodeAutoInstrumentations } = require('@opentelemetry/auto-instrumentations-node');
const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
const { OTLPMetricExporter } = require('@opentelemetry/exporter-metrics-otlp-http');
const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
const { PeriodicExportingMetricReader } = require('@opentelemetry/sdk-metrics');
const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const {
  defaultResource,
  resourceFromAttributes,
  envDetector,
  processDetector,
  osDetector,
  serviceInstanceIdDetector,
} = require('@opentelemetry/resources');

const pkg = require('../package.json');

// Công tắc tắt khẩn cấp theo chuẩn OpenTelemetry. Phải kiểm tra TRƯỚC khi tạo instrumentation:
// getNodeAutoInstrumentations() vá module ngay lúc được gọi, còn NodeSDK chỉ bỏ qua bước start().
if (/^true$/i.test(process.env.OTEL_SDK_DISABLED || '')) {
  console.log('[otel] OTEL_SDK_DISABLED=true: không bật OpenTelemetry');
  return; // CommonJS bọc mỗi file trong một hàm, nên return ở cấp cao nhất là hợp lệ
}

// Mặc định SDK IM LẶNG khi gửi dữ liệu thất bại (sai endpoint, collector chưa chạy, sai network...).
// Bật mức WARN để những lỗi đó hiện ra trong log của container. Đặt OTEL_LOG_LEVEL=debug để xem
// chi tiết hơn; khi biến này có giá trị thì chính NodeSDK cấu hình logger theo nó.
if (!process.env.OTEL_LOG_LEVEL) {
  diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.WARN);
}

// Resource là "danh tính" của service, được gắn vào MỌI span, metric và log mà service gửi đi.
// Ở đây chỉ là giá trị MẶC ĐỊNH. Khi start(), NodeSDK còn merge thêm resource do các detector
// (khai báo ở resourceDetectors bên dưới) phát hiện, và giá trị phát hiện được sẽ THẮNG. Nhờ envDetector,
// OTEL_SERVICE_NAME và OTEL_RESOURCE_ATTRIBUTES trong docker-compose.yml ghi đè được mọi thứ dưới đây.
const resource = defaultResource().merge(
  resourceFromAttributes({
    'service.version': pkg.version,
    'service.namespace': 'shop-demo',
    'deployment.environment': 'local',
    // Trong container, hostname chính là container ID rút gọn (cột CONTAINER ID của `docker ps`).
    'host.name': os.hostname(),
  })
);

const instrumentations = getNodeAutoInstrumentations({
  '@opentelemetry/instrumentation-http': {
    // Docker healthcheck gọi /health vài giây một lần. Không bỏ qua thì SigNoz ngập trace vô nghĩa.
    ignoreIncomingRequestHook: (req) => (req.url || '').split('?')[0] === '/health',
  },
  // dns.lookup / tcp.connect sinh rất nhiều span nhỏ mà không giúp đọc trace.
  '@opentelemetry/instrumentation-dns': { enabled: false },
  '@opentelemetry/instrumentation-net': { enabled: false },
  // Express 5 chạy trên package `router`. Bật cả instrumentation-express lẫn instrumentation-router
  // thì mỗi middleware/route bị tạo span 2 lần. Chỉ giữ instrumentation-express.
  '@opentelemetry/instrumentation-router': { enabled: false },
  // instrumentation-fs và instrumentation-host-metrics đã tắt sẵn theo mặc định.
  // instrumentation-pino BẬT sẵn: chèn trace_id/span_id vào log và gửi log sang SigNoz (xem lib/logger.js).
  // instrumentation-runtime-node BẬT sẵn: metric event loop, heap, GC của Node.
});

// SDK mặc định đẩy metric 60 giây một lần. Demo để 15 giây cho nhanh thấy số liệu.
// Khi tự tạo PeriodicExportingMetricReader, SDK không tự đọc OTEL_METRIC_EXPORT_INTERVAL nên đọc tay.
const metricExportIntervalMillis = Number(process.env.OTEL_METRIC_EXPORT_INTERVAL) || 15_000;

const sdk = new NodeSDK({
  resource,
  // Bộ detector mặc định là env + process + host. hostDetector đọc host.id từ /etc/machine-id, file mà
  // image node:*-slim không có, nên mỗi lần khởi động SDK in cảnh báo vô hại:
  //   dropping invalid resource attribute value for key "host.id"
  // Vì vậy bỏ hostDetector (host.name đã đặt ở trên), thêm service.instance.id để phân biệt từng process.
  resourceDetectors: [envDetector, processDetector, osDetector, serviceInstanceIdDetector],

  // TRACES. Không truyền url: exporter tự đọc OTEL_EXPORTER_OTLP_ENDPOINT rồi nối thêm /v1/traces
  // (không có biến này thì mặc định http://localhost:4318/v1/traces). NodeSDK bọc exporter trong
  // BatchSpanProcessor: span được gom thành lô, khoảng 5 giây gửi một lần (OTEL_BSP_SCHEDULE_DELAY).
  traceExporter: new OTLPTraceExporter(),

  // METRICS. Reader định kỳ gom số liệu từ mọi instrument (của ta và của auto-instrumentation)
  // rồi đẩy tới /v1/metrics.
  metricReaders: [
    new PeriodicExportingMetricReader({
      exporter: new OTLPMetricExporter(),
      exportIntervalMillis: metricExportIntervalMillis,
    }),
  ],

  // LOGS. instrumentation-pino chuyển mỗi dòng log thành một LogRecord của OpenTelemetry;
  // processor gom lô rồi đẩy tới /v1/logs.
  logRecordProcessors: [new BatchLogRecordProcessor({ exporter: new OTLPLogExporter() })],

  instrumentations,
});

sdk.start();

// OTEL_EXPORTER_OTLP_TRACES_ENDPOINT (URL đầy đủ, exporter dùng nguyên) được ưu tiên hơn
// OTEL_EXPORTER_OTLP_ENDPOINT (URL gốc, exporter tự nối thêm /v1/traces).
const endpoint =
  process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT ||
  process.env.OTEL_EXPORTER_OTLP_ENDPOINT ||
  'http://localhost:4318 (mặc định)';
const serviceName = process.env.OTEL_SERVICE_NAME;
console.log(`[otel] SDK đã chạy: service=${serviceName || 'unknown_service:node'} → OTLP/HTTP ${endpoint}`);
if (!serviceName) {
  console.warn('[otel] Chưa đặt OTEL_SERVICE_NAME: trong SigNoz service sẽ hiện là "unknown_service:node"');
}

// Tắt êm: flush nốt span/metric/log còn nằm trong buffer trước khi process thoát.
// `docker stop` gửi SIGTERM, Ctrl+C gửi SIGINT.
let shuttingDown = false;
async function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  try {
    await sdk.shutdown();
    console.log(`[otel] ${signal}: đã flush telemetry và tắt SDK`);
  } catch (err) {
    console.error(`[otel] ${signal}: lỗi khi tắt SDK: ${err.message}`);
  } finally {
    process.exit(0);
  }
}
process.once('SIGTERM', () => shutdown('SIGTERM'));
process.once('SIGINT', () => shutdown('SIGINT'));
