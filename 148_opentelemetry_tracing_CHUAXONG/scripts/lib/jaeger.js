'use strict';

/**
 * Client tối giản cho API v3 của Jaeger 2.x: OTLP JSON, có OpenAPI, là API chính thức.
 * Các endpoint /api/* không có "v3" là API nội bộ của Jaeger UI. Tài liệu Jaeger ghi rõ
 * chúng có thể thay đổi bất cứ lúc nào, nên ở đây không dùng.
 *
 * Dùng chung cho scripts/verify-traces.js và test tích hợp.
 */

const JAEGER_URL = process.env.JAEGER_URL || 'http://localhost:16686';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Enum SpanKind trong OTLP: 0 UNSPECIFIED, 1 INTERNAL, 2 SERVER, 3 CLIENT, 4 PRODUCER, 5 CONSUMER.
// Lưu ý: khác với SpanKind của @opentelemetry/api (ở đó INTERNAL = 0).
const KIND_NAMES = ['UNSPECIFIED', 'INTERNAL', 'SERVER', 'CLIENT', 'PRODUCER', 'CONSUMER'];

/** 2 -> 'SERVER'. Cũng chấp nhận dạng chuỗi 'SPAN_KIND_SERVER'. */
function normalizeKind(kind) {
  if (typeof kind === 'number') return KIND_NAMES[kind] || 'UNSPECIFIED';
  return String(kind || 'SPAN_KIND_UNSPECIFIED').replace(/^SPAN_KIND_/, '');
}

/** { code: 2 } -> 'ERROR'. Status rỗng {} nghĩa là UNSET. */
function normalizeStatus(status) {
  const code = status?.code;
  if (code === 2 || code === 'STATUS_CODE_ERROR') return 'ERROR';
  if (code === 1 || code === 'STATUS_CODE_OK') return 'OK';
  return 'UNSET';
}

function attributeValue(value = {}) {
  if ('stringValue' in value) return value.stringValue;
  if ('intValue' in value) return Number(value.intValue); // int64 được mã hoá thành chuỗi trong OTLP JSON
  if ('doubleValue' in value) return value.doubleValue;
  if ('boolValue' in value) return value.boolValue;
  if ('arrayValue' in value) return (value.arrayValue.values || []).map(attributeValue);
  return undefined;
}

function toAttributes(list = []) {
  return Object.fromEntries(list.map(({ key, value }) => [key, attributeValue(value)]));
}

/** OTLP JSON (resourceSpans -> scopeSpans -> spans) -> mảng span phẳng, dễ kiểm tra. */
function flattenTrace(body) {
  const resourceSpans = body?.result?.resourceSpans ?? body?.resourceSpans ?? [];
  const spans = [];
  for (const rs of resourceSpans) {
    const resource = toAttributes(rs.resource?.attributes);
    for (const ss of rs.scopeSpans || []) {
      for (const s of ss.spans || []) {
        spans.push({
          service: resource['service.name'],
          resource,
          name: s.name,
          traceId: s.traceId,
          spanId: s.spanId,
          parentSpanId: s.parentSpanId || '',
          kind: normalizeKind(s.kind),
          status: normalizeStatus(s.status),
          startTime: BigInt(s.startTimeUnixNano || 0),
          attributes: toAttributes(s.attributes),
          events: (s.events || []).map((e) => ({ name: e.name, attributes: toAttributes(e.attributes) })),
        });
      }
    }
  }
  return spans;
}

/**
 * Vẽ cây span dạng text, giống màn hình Jaeger, để in ra terminal hoặc chép vào README:
 *   api-gateway    POST /orders        SERVER
 *   api-gateway    └─ POST             CLIENT
 */
function formatTree(spans) {
  const ids = new Set(spans.map((s) => s.spanId));
  const children = new Map();
  for (const span of spans) {
    // Span không có cha, hoặc cha không nằm trong trace, được coi là gốc.
    const parentId = ids.has(span.parentSpanId) ? span.parentSpanId : '';
    if (!children.has(parentId)) children.set(parentId, []);
    children.get(parentId).push(span);
  }
  for (const list of children.values()) {
    list.sort((a, b) => (a.startTime < b.startTime ? -1 : a.startTime > b.startTime ? 1 : 0));
  }

  const rows = [];
  const walk = (span, prefix, connector) => {
    rows.push({
      service: span.service || '?',
      label: `${prefix}${connector}${span.name}`,
      kind: span.kind,
      error: span.status === 'ERROR',
    });
    const kids = children.get(span.spanId) || [];
    const nextPrefix = prefix + (connector === '├─ ' ? '│  ' : connector === '└─ ' ? '   ' : '');
    kids.forEach((kid, i) => walk(kid, nextPrefix, i === kids.length - 1 ? '└─ ' : '├─ '));
  };
  for (const root of children.get('') || []) walk(root, '', '');

  const serviceWidth = Math.max(0, ...rows.map((r) => r.service.length));
  const labelWidth = Math.max(0, ...rows.map((r) => r.label.length));
  return rows
    .map((r) => `${r.service.padEnd(serviceWidth)}  ${r.label.padEnd(labelWidth)}  ${r.kind}${r.error ? '  ERROR' : ''}`)
    .join('\n');
}

async function getJson(path, baseUrl = JAEGER_URL) {
  const res = await fetch(`${baseUrl}${path}`, { signal: AbortSignal.timeout(5000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Jaeger ${path} -> HTTP ${res.status}`);
  return res.json();
}

/** Lấy trace theo id. Chưa có (404) thì trả mảng rỗng. */
async function getTrace(traceId, baseUrl) {
  return flattenTrace(await getJson(`/api/v3/traces/${traceId}`, baseUrl));
}

/**
 * Hỏi lặp lại tới khi isComplete(spans) đúng hoặc hết giờ. Cần thiết vì SDK gom span và gửi
 * theo lô (mặc định khoảng 5 giây một lần), rồi Collector lại gom thêm một nhịp nữa.
 * Hết giờ thì trả về phần đã có, để báo cáo span nào còn thiếu.
 */
async function waitForTrace(traceId, isComplete, { timeoutMs = 30000, intervalMs = 1000, baseUrl } = {}) {
  const deadline = Date.now() + timeoutMs;
  let spans = [];
  while (Date.now() < deadline) {
    spans = await getTrace(traceId, baseUrl);
    if (spans.length > 0 && isComplete(spans)) return spans;
    await sleep(intervalMs);
  }
  return spans;
}

/** Danh sách tên operation (tên span) Jaeger đã thấy của một service. */
async function getOperations(service, baseUrl) {
  const body = await getJson(`/api/v3/operations?service=${encodeURIComponent(service)}`, baseUrl);
  return (body?.operations || []).map((op) => op.name);
}

module.exports = {
  JAEGER_URL,
  normalizeKind,
  normalizeStatus,
  flattenTrace,
  formatTree,
  getTrace,
  waitForTrace,
  getOperations,
};
