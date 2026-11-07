'use strict';

/**
 * Tracer, meter và các metric riêng của ứng dụng (manual instrumentation).
 *
 * Auto-instrumentation đã lo span cho HTTP server, Express, fetch. Phần dưới đây dùng khi ta muốn
 * thấy thêm những bước NGHIỆP VỤ trong trace (kiểm tra đơn, truy vấn DB, chấm điểm gian lận...)
 * và đếm những con số mà chỉ app mới biết (số đơn, doanh thu, tồn kho).
 *
 * Chỉ dùng @opentelemetry/api, không đụng tới SDK. Nếu SDK không chạy (quên --require, hoặc
 * OTEL_SDK_DISABLED=true) thì api trả về tracer/meter "no-op": code vẫn chạy bình thường,
 * chỉ là không sinh telemetry.
 */

const { trace, metrics, SpanStatusCode } = require('@opentelemetry/api');

// Tên "instrumentation scope", hiện trong SigNoz ở thuộc tính otel.scope.name của span.
const SCOPE_NAME = 'shop-demo';
const SCOPE_VERSION = '1.0.0';

const tracer = trace.getTracer(SCOPE_NAME, SCOPE_VERSION);

// Lưu ý: khác với trace, API metrics KHÔNG có "proxy". Meter lấy ra trước khi SDK đăng ký
// MeterProvider sẽ là no-op vĩnh viễn. Ở đây an toàn vì tracing.js (--require) đã chạy xong từ trước.
const meter = metrics.getMeter(SCOPE_NAME, SCOPE_VERSION);

/**
 * Chạy `fn` bên trong một span mới.
 *
 * Span được đặt làm "active" trong lúc fn chạy, nên mọi span con (kể cả của auto-instrumentation,
 * ví dụ fetch) và mọi dòng log bên trong đều tự gắn vào span này. Nếu fn ném lỗi: ghi exception
 * vào span, đặt status ERROR, rồi ném tiếp. Span luôn được end(), kể cả khi lỗi.
 *
 *   await withSpan('fraud.check', async (span) => { span.setAttribute('app.fraud.score', 12); ... });
 *   await withSpan('SELECT shop.products', { kind: SpanKind.CLIENT, attributes: {...} }, async () => {...});
 */
function withSpan(name, options, fn) {
  if (typeof options === 'function') {
    fn = options;
    options = {};
  }
  return tracer.startActiveSpan(name, options, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err);
      span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
      throw err;
    } finally {
      span.end();
    }
  });
}

// ---------------------------------------------------------------------------------------------
// Metric của ứng dụng. Trên SigNoz: Dashboards → New Panel → Query Builder → gõ "shop" để tìm.
// ---------------------------------------------------------------------------------------------

/** Counter: chỉ tăng. Đếm đơn hàng theo kết quả (thuộc tính order.status). */
const ordersCounter = meter.createCounter('shop.orders', {
  description: 'Số đơn hàng đã xử lý, chia theo kết quả',
  unit: '{order}',
});

/** Counter: tổng tiền của các đơn thanh toán thành công. */
const revenueCounter = meter.createCounter('shop.revenue', {
  description: 'Doanh thu từ các đơn đã thanh toán',
  unit: 'VND',
});

/** Histogram: phân bố thời gian gọi payment-service, để vẽ p50/p95/p99. */
const paymentDuration = meter.createHistogram('shop.payment.duration', {
  description: 'Thời gian order-service chờ payment-service trả lời',
  unit: 'ms',
});

module.exports = { tracer, meter, withSpan, ordersCounter, revenueCounter, paymentDuration };
