#!/usr/bin/env node
'use strict';

/**
 * Kiểm tra có gửi được dữ liệu tới OTLP/HTTP receiver (collector của SigNoz) hay không, và giải thích
 * nguyên nhân nếu không được.
 *
 *   node scripts/check-otlp.js                          dùng OTEL_EXPORTER_OTLP_ENDPOINT, không có thì localhost:4318
 *   node scripts/check-otlp.js http://localhost:4318    kiểm tra một địa chỉ bất kỳ
 *
 * Chạy BÊN TRONG container để kiểm tra đúng con đường mà app đang dùng (cùng network, cùng biến môi trường):
 *
 *   docker compose exec order-service node scripts/check-otlp.js
 *
 * Script gửi một gói traces RỖNG tới <endpoint>/v1/traces: đủ để biết receiver có nhận hay không,
 * mà không tạo dữ liệu rác nào trên SigNoz.
 */

const dns = require('node:dns/promises');
const fs = require('node:fs');

const argEndpoint = process.argv[2];
const baseEndpoint = argEndpoint || process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://localhost:4318';
// Giống SDK: biến riêng cho traces là URL đầy đủ và được ưu tiên; biến chung thì nối thêm /v1/traces.
const tracesUrl =
  !argEndpoint && process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    ? process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT
    : `${baseEndpoint.replace(/\/+$/, '')}/v1/traces`;

const insideContainer = fs.existsSync('/.dockerenv');
let problems = 0;

const ok = (msg) => console.log(`  [OK]   ${msg}`);
const warn = (msg) => console.log(`  [CHÚ Ý] ${msg}`);
const fail = (msg) => {
  problems += 1;
  console.log(`  [LỖI]  ${msg}`);
};

/** Đọc OTEL_EXPORTER_OTLP_HEADERS dạng "k1=v1,k2=v2" giống SDK. */
function headersFromEnv() {
  const raw = process.env.OTEL_EXPORTER_OTLP_HEADERS || '';
  const headers = {};
  for (const pair of raw.split(',')) {
    const idx = pair.indexOf('=');
    if (idx <= 0) continue;
    headers[pair.slice(0, idx).trim()] = decodeURIComponent(pair.slice(idx + 1).trim());
  }
  return headers;
}

async function main() {
  console.log(`Endpoint gốc : ${baseEndpoint}`);
  console.log(`URL traces   : ${tracesUrl}`);
  console.log(`Chạy ở       : ${insideContainer ? 'bên trong container Docker' : 'trên máy (ngoài Docker)'}\n`);

  // 1. Kiểm tra cú pháp và những lỗi cấu hình hay gặp.
  let url;
  try {
    url = new URL(tracesUrl);
  } catch {
    fail(`"${tracesUrl}" không phải URL hợp lệ. Dạng đúng: http://signoz-ingester:4318`);
    return finish();
  }
  if (/\/v1\/(traces|metrics|logs)\/v1\/traces$/.test(url.pathname)) {
    fail('Endpoint đã có sẵn /v1/... nên thành ".../v1/traces/v1/traces". OTEL_EXPORTER_OTLP_ENDPOINT chỉ là địa chỉ GỐC, SDK tự nối /v1/traces.');
  }
  if (url.port === '4317') {
    fail('Cổng 4317 là OTLP/gRPC. App dùng exporter OTLP/HTTP nên phải gửi vào cổng 4318.');
  }
  const isLoopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if (insideContainer && isLoopback) {
    fail(
      'Trong container, "localhost" là CHÍNH container đó, không phải máy host hay SigNoz. ' +
        'Dùng tên collector trên network chung (signoz-ingester / otel-collector) hoặc host.docker.internal.'
    );
  }
  const headers = headersFromEnv();
  const headerNames = Object.keys(headers);
  if (url.hostname.endsWith('signoz.cloud') && !headerNames.some((h) => h.toLowerCase() === 'signoz-ingestion-key')) {
    fail('Gửi tới SigNoz Cloud nhưng thiếu header. Đặt OTEL_EXPORTER_OTLP_HEADERS=signoz-ingestion-key=<key>.');
  }
  if (headerNames.length > 0) ok(`Header gửi kèm: ${headerNames.join(', ')} (không in giá trị)`);

  // 2. Phân giải tên miền: lỗi ở bước này gần như luôn là "không chung network" hoặc sai tên host.
  try {
    const addresses = await dns.lookup(url.hostname, { all: true });
    ok(`DNS: ${url.hostname} → ${addresses.map((a) => a.address).join(', ')}`);
  } catch (err) {
    fail(`DNS: không phân giải được "${url.hostname}" (${err.code}).`);
    if (insideContainer) {
      console.log('         → Container không nằm chung network với SigNoz, hoặc sai tên collector.');
      console.log('           Xem: docker network ls | docker network inspect <network-của-signoz>');
    }
    return finish();
  }

  // 3. Gửi một gói traces rỗng. Receiver OTLP trả 200 nếu nhận được.
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify({ resourceSpans: [] }),
      signal: AbortSignal.timeout(5_000),
    });
    const text = (await res.text()).slice(0, 200);
    if (res.ok) {
      ok(`POST ${url.pathname} → HTTP ${res.status} ${text}`);
    } else if (res.status === 401 || res.status === 403) {
      fail(`HTTP ${res.status}: bị từ chối xác thực. SigNoz Cloud cần signoz-ingestion-key đúng và còn hiệu lực.`);
    } else if (res.status === 404) {
      fail(`HTTP 404: có server trả lời nhưng không có ${url.pathname}. Sai cổng (không phải 4318?) hoặc sai đường dẫn.`);
    } else {
      fail(`HTTP ${res.status}: ${text}`);
    }
  } catch (err) {
    // fetch bọc lỗi thật trong err.cause (mã lỗi mạng như ECONNREFUSED, hoặc lỗi parse HTTP).
    const code = err.cause?.code || err.cause?.name || err.name;
    fail(`Không gửi được: ${code}${err.cause?.message ? ` (${err.cause.message})` : ''}`);
    const hints = {
      ECONNREFUSED: 'Có máy nhưng không có gì nghe ở cổng này: collector chưa chạy, chưa publish cổng 4318, hoặc sai cổng.',
      TimeoutError: 'Hết 5 giây không có phản hồi: sai IP, firewall chặn, hoặc collector quá tải.',
      ECONNRESET: 'Kết nối bị cắt: collector chưa mở receiver (SigNoz chưa tạo tài khoản đầu tiên?), hoặc sai http/https.',
      UND_ERR_SOCKET: 'Kết nối bị đóng giữa chừng: collector chưa mở receiver (SigNoz chưa tạo tài khoản đầu tiên?).',
      HTTPParserError: 'Phía bên kia không nói HTTP/1.1: thường là gửi vào cổng gRPC 4317 thay vì 4318.',
      EPROTO: 'Lỗi TLS: gửi https:// tới cổng 4318 không bật TLS. Tự host thì dùng http://.',
    };
    // Tuỳ phiên bản Node, lỗi parse HTTP có code (HPE_INVALID_CONSTANT) hoặc chỉ có name (HTTPParserError).
    const hint = hints[err.cause?.code] || hints[err.cause?.name] || hints[err.name];
    if (hint) console.log(`         → ${hint}`);
  }

  return finish();
}

function finish() {
  console.log(problems === 0 ? '\nKết luận: gửi được tới OTLP receiver.' : `\nKết luận: có ${problems} vấn đề cần sửa (xem [LỖI] ở trên).`);
  process.exit(problems === 0 ? 0 : 1);
}

main();
