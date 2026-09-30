'use strict';

/**
 * Gửi 3 kịch bản mẫu tới gateway và in link Jaeger của từng trace.
 * Yêu cầu: `npm run infra:up` và `npm start` đang chạy.
 */
const { JAEGER_URL } = require('./lib/jaeger');
const { GATEWAY_URL, SCENARIOS, sendScenario } = require('./lib/scenarios');

async function main() {
  console.log(`Gửi ${SCENARIOS.length} kịch bản tới ${GATEWAY_URL}\n`);
  for (const scenario of SCENARIOS) {
    const { status, body } = await sendScenario(scenario);
    const summary = body.error
      ? `${body.error}: ${body.message}`
      : `${body.status} ${body.orderId}, tổng ${Number(body.total).toLocaleString('vi-VN')}đ`;
    console.log(`${scenario.id.padEnd(15)} HTTP ${status}  ${summary}`);
    if (body.traceId) console.log(`${''.padEnd(15)} ${JAEGER_URL}/trace/${body.traceId}`);
  }
  console.log('\nSpan được gom và gửi khoảng 5 giây một lần, đợi vài giây rồi mở link.');
}

main().catch((err) => {
  console.error(`Lỗi: ${err.message}. Đã chạy "npm run infra:up" và "npm start" chưa?`);
  process.exit(1);
});
