'use strict';

/**
 * Gọi payment-service qua HTTP bằng fetch có sẵn của Node.
 *
 * File này không có dòng code tracing nào, vậy mà trên SigNoz trace vẫn nối liền hai service, vì
 * instrumentation-undici (fetch của Node chạy trên undici) tự động:
 *   - tạo một span kind=CLIENT cho request này;
 *   - chèn header `traceparent` (chuẩn W3C Trace Context) vào request. payment-service đọc header đó
 *     và tạo span của nó làm CON của span này → cùng một trace ID, xem trọn trên một màn hình.
 */

const { paymentDuration } = require('./telemetry');
const { HttpError } = require('./utils');

const PAYMENT_SERVICE_URL = process.env.PAYMENT_SERVICE_URL || 'http://localhost:3401';
const PAYMENT_TIMEOUT_MS = Number(process.env.PAYMENT_TIMEOUT_MS) || 3_000;

/**
 * Yêu cầu payment-service trừ tiền.
 * Thành công: trả về { paymentId, status, ... }.
 * Thất bại: ném HttpError(502). Với order-service, service phía sau hỏng nghĩa là "Bad Gateway".
 */
async function chargePayment({ orderId, amount, customerId }) {
  const startedAt = performance.now();
  let outcome = 'unreachable';
  try {
    let res;
    try {
      res = await fetch(`${PAYMENT_SERVICE_URL}/payments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ orderId, amount, customerId }),
        signal: AbortSignal.timeout(PAYMENT_TIMEOUT_MS),
      });
    } catch (err) {
      // Không tới được payment-service: sai URL, service chưa chạy, khác network, quá thời gian chờ...
      const reason = err.cause?.code || err.name; // ECONNREFUSED, ENOTFOUND, TimeoutError...
      throw new HttpError(502, `Không gọi được payment-service tại ${PAYMENT_SERVICE_URL} (${reason})`, { cause: err });
    }

    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      outcome = 'failed';
      throw new HttpError(502, `payment-service trả về ${res.status}: ${body.error || res.statusText}`);
    }
    outcome = 'success';
    return body;
  } finally {
    // Histogram có thuộc tính payment.outcome: vẽ được p95 riêng cho lần thành công và lần lỗi.
    paymentDuration.record(performance.now() - startedAt, { 'payment.outcome': outcome });
  }
}

module.exports = { chargePayment };
