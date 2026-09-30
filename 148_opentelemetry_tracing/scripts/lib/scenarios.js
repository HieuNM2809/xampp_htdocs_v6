'use strict';

/** 3 kịch bản demo (spec mục 2.3), dùng chung cho demo.js và verify-traces.js. */

const GATEWAY_URL = process.env.GATEWAY_URL || 'http://localhost:3000';

const SCENARIOS = [
  {
    id: 'success',
    title: 'Đơn hợp lệ, khách VIP',
    // tổng tiền: 2 x 350.000 + 1 x 120.000 = 820.000
    body: {
      customerId: 'VIP-001',
      items: [
        { sku: 'SERUM-01', qty: 2 },
        { sku: 'MASK-03', qty: 1 },
      ],
      paymentMethod: 'card',
    },
    expectedStatus: 201,
  },
  {
    id: 'payment-failed',
    title: 'Thẻ hết hạn',
    body: { customerId: 'C-002', items: [{ sku: 'TONER-02', qty: 1 }], paymentMethod: 'expired_card' },
    expectedStatus: 502,
  },
  {
    id: 'invalid',
    title: 'Đơn không có sản phẩm',
    body: { customerId: 'C-003', items: [], paymentMethod: 'card' },
    expectedStatus: 400,
  },
];

/** Gửi một kịch bản tới gateway, trả về { status, body }. */
async function sendScenario(scenario, gatewayUrl = GATEWAY_URL) {
  const res = await fetch(`${gatewayUrl}/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(scenario.body),
    signal: AbortSignal.timeout(10000),
  });
  const body = await res.json().catch(() => ({}));
  return { status: res.status, body };
}

module.exports = { GATEWAY_URL, SCENARIOS, sendScenario };
