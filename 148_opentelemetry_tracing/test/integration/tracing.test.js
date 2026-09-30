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

test('Collector không chạy: tiến trình vẫn chạy xong, không crash', async () => {
  const { traceId } = await emitSpan({
    OTEL_EXPORTER_OTLP_ENDPOINT: 'http://127.0.0.1:1', // cổng không có ai nghe
    OTEL_EXPORTER_OTLP_TIMEOUT: '2000',
  });
  assert.match(traceId, /^[0-9a-f]{32}$/);
});
