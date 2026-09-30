'use strict';

const { context, propagation, ROOT_CONTEXT } = require('@opentelemetry/api');

/**
 * Ghi trace context (và baggage) của context đang active vào `carrier`.
 * Với propagator mặc định của NodeSDK (W3C Trace Context + W3C Baggage), carrier sẽ có:
 *   traceparent: 00-<trace-id 32 hex>-<span-id 16 hex>-<flags>
 *   baggage:     customer.tier=gold            (nếu context có baggage)
 * HTTP client đã được instrument thì làm việc này TỰ ĐỘNG. Chỉ cần tự gọi khi dữ liệu đi qua
 * kênh mà instrumentation không biết, ví dụ nội dung message trong Redis list.
 */
function injectContext(carrier = {}) {
  propagation.inject(context.active(), carrier);
  return carrier;
}

/**
 * Chiều ngược lại: dựng Context từ carrier. Dùng ROOT_CONTEXT làm gốc để không vô tình thừa
 * hưởng span đang active ở phía consumer.
 * Carrier rỗng hoặc sai định dạng thì không có span cha: span tạo từ đó mở một trace mới.
 */
function extractContext(carrier) {
  return propagation.extract(ROOT_CONTEXT, carrier || {});
}

/**
 * Chạy `fn` trong context có thêm baggage (giữ lại baggage đã có từ upstream).
 * Mọi request hoặc message được inject bên trong `fn` sẽ mang header `baggage`.
 * @param {Record<string, string>} entries
 */
function withBaggage(entries, fn) {
  let baggage = propagation.getBaggage(context.active()) || propagation.createBaggage();
  for (const [key, value] of Object.entries(entries)) {
    baggage = baggage.setEntry(key, { value: String(value) });
  }
  return context.with(propagation.setBaggage(context.active(), baggage), fn);
}

/** Đọc một giá trị baggage. Không có thì trả undefined. */
function getBaggageValue(key, ctx = context.active()) {
  return propagation.getBaggage(ctx)?.getEntry(key)?.value;
}

module.exports = { injectContext, extractContext, withBaggage, getBaggageValue };
