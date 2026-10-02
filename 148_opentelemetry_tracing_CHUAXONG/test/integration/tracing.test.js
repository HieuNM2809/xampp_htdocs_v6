'use strict';

/**
 * Test tích hợp cho src/tracing.js. Hai test đầu cần hạ tầng đang chạy: `npm run infra:up`.
 * Chạy: npm run test:integration
 */
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { waitForTrace } = require('../../scripts/lib/jaeger');

const execFileAsync = promisify(execFile);
const ROOT = path.join(__dirname, '..', '..');

/** Chạy emit-span.js dưới --require ./src/tracing.js, trả về trace id nó in ra và stderr. */
async function emitSpan(extraEnv = {}) {
  const { stdout, stderr } = await execFileAsync(
    process.execPath,
    ['--require', './src/tracing.js', 'test/integration/fixtures/emit-span.js'],
    {
      cwd: ROOT,
      env: {
        ...process.env,
        NODE_ENV: '',
        OTEL_SERVICE_NAME: 'tracing-smoke-test',
        OTEL_RESOURCE_ATTRIBUTES: '',
        OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
        ...extraEnv,
      },
      timeout: 30000,
    }
  );
  const match = stdout.match(/TRACE_ID=([0-9a-f]{32})/);
  assert.ok(match, `Không thấy TRACE_ID trong output:\n${stdout}`);
  return { traceId: match[1], stderr };
}

const hasSmokeSpan = (spans) => spans.some((s) => s.name === 'smoke-span');

test('span đi qua Collector tới Jaeger, kèm resource attributes khai báo trong code', async () => {
  const { traceId, stderr } = await emitSpan();
  // Hạ tầng chạy bình thường thì SDK không được in lỗi nào (ví dụ export metrics/logs bị 404).
  assert.equal(stderr.trim(), '', `stderr phải rỗng, nhận:\n${stderr}`);
  const spans = await waitForTrace(traceId, hasSmokeSpan);
  const span = spans.find((s) => s.name === 'smoke-span');
  assert.ok(span, `Jaeger không có trace ${traceId}. Hạ tầng đã chạy chưa (npm run infra:up)?`);
  assert.equal(span.service, 'tracing-smoke-test');
  assert.equal(span.resource['service.version'], '1.0.0');
  assert.equal(span.resource['service.namespace'], 'shop');
  assert.equal(span.resource['deployment.environment.name'], 'development');
  assert.match(String(span.resource['service.instance.id']), /^[0-9a-f-]{36}$/);
  // Có mặt nhờ merge với defaultResource()
  assert.equal(span.resource['telemetry.sdk.language'], 'nodejs');
});

test('OTEL_RESOURCE_ATTRIBUTES ghi đè giá trị khai báo trong code', async () => {
  const { traceId, stderr } = await emitSpan({
    OTEL_RESOURCE_ATTRIBUTES: 'deployment.environment.name=staging,team.name=platform',
  });
  assert.equal(stderr.trim(), '', `stderr phải rỗng, nhận:\n${stderr}`);
  const spans = await waitForTrace(traceId, hasSmokeSpan);
  const span = spans.find((s) => s.name === 'smoke-span');
  assert.ok(span, `Jaeger không có trace ${traceId}`);
  assert.equal(span.resource['deployment.environment.name'], 'staging');
  assert.equal(span.resource['team.name'], 'platform');
});

test('OTEL_SDK_DISABLED=true: không vá module nào, không báo "tracing đã bật"', async () => {
  const { stdout } = await execFileAsync(
    process.execPath,
    ['--require', './src/tracing.js', '-e', "console.log('WRAPPED=' + Boolean(require('http').request.__wrapped))"],
    { cwd: ROOT, env: { ...process.env, OTEL_SDK_DISABLED: 'true' }, timeout: 30000 }
  );
  assert.match(stdout, /WRAPPED=false/, stdout);
  assert.doesNotMatch(stdout, /tracing đã bật/);
});

test('dòng khởi động in đúng endpoint exporter dùng: OTEL_EXPORTER_OTLP_TRACES_ENDPOINT được ưu tiên', async () => {
  const { stdout } = await execFileAsync(process.execPath, ['--require', './src/tracing.js', '-e', '0'], {
    cwd: ROOT,
    env: {
      ...process.env,
      OTEL_SERVICE_NAME: 'endpoint-test',
      OTEL_EXPORTER_OTLP_ENDPOINT: 'http://localhost:4318',
      OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://127.0.0.1:1/custom/v1/traces',
    },
    timeout: 30000,
  });
  assert.match(stdout, /export=http:\/\/127\.0\.0\.1:1\/custom\/v1\/traces/, stdout);
});

test('Ctrl+C lần 2 trong lúc đang tắt: thoát ngay với mã 130, không bị bỏ qua', async () => {
  const failure = await execFileAsync(
    process.execPath,
    ['--require', './src/tracing.js', 'test/integration/fixtures/double-sigint.js'],
    { cwd: ROOT, env: { ...process.env, OTEL_SERVICE_NAME: 'sigint-test' }, timeout: 30000 }
  ).then(
    () => null,
    (err) => err
  );
  assert.ok(failure, 'tiến trình phải thoát với mã khác 0');
  assert.equal(failure.code, 130);
});

test('Collector không chạy: tiến trình không crash và SDK in cảnh báo export lỗi', async () => {
  const { traceId, stderr } = await emitSpan({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1', // cổng không có ai nghe
    OTEL_EXPORTER_OTLP_TIMEOUT: '1000',
    OTEL_BSP_SCHEDULE_DELAY: '100', // gửi lô sớm, như một service chạy lâu
    EMIT_SPAN_WAIT_MS: '3000',
  });
  assert.match(traceId, /^[0-9a-f]{32}$/);
  // Dòng lỗi phải do chính SDK in ra lúc gửi lô (diag logger trong tracing.js), không phải dòng
  // mà fixture tự in khi shutdown thất bại.
  const sdkErrorLines = stderr.split('\n').filter((line) => line.includes('ECONNREFUSED') && !line.startsWith('[emit-span]'));
  assert.ok(sdkErrorLines.length > 0, `SDK phải in lỗi ECONNREFUSED, stderr:\n${stderr}`);
});
