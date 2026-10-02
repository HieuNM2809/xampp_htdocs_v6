'use strict';

const { randomUUID } = require('node:crypto');
const { SpanKind, SpanStatusCode } = require('@opentelemetry/api');
const { ATTR_ERROR_TYPE } = require('@opentelemetry/semantic-conventions');
const { tracer, withSpan } = require('../shared/tracer');
const { injectContext } = require('../shared/propagation');
const {
  QUEUE_NAME,
  ATTR_MESSAGING_SYSTEM,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_OPERATION_TYPE,
  ATTR_MESSAGING_OPERATION_NAME,
  ATTR_MESSAGING_MESSAGE_ID,
} = require('../shared/messaging');
const { findProduct } = require('./catalog');
const { ValidationError, PaymentError } = require('./errors');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
// Độ trễ giả 20–80 ms để span có độ dài dễ nhìn trong Jaeger.
const simulateLatency = () => sleep(20 + Math.floor(Math.random() * 60));

/**
 * Bước 1: kiểm tra đơn hàng. Dữ liệu sai thì ném ValidationError (400).
 * @param {object} order body của request
 * @param {{ customerTier?: string }} [options] hạng khách lấy từ baggage
 * @returns {Promise<{ lines: Array<{ sku: string, name: string, price: number, qty: number }>, total: number }>}
 */
function validateOrder(order, { customerTier } = {}) {
  const attributes = {
    'customer.id': String(order?.customerId ?? ''),
    'customer.tier': customerTier || 'unknown',
    'order.item_count': Array.isArray(order?.items) ? order.items.length : 0,
  };
  return withSpan('order.validate', { attributes }, async () => {
    await simulateLatency();
    if (typeof order?.customerId !== 'string' || order.customerId.trim() === '') {
      throw new ValidationError('customerId là bắt buộc');
    }
    if (typeof order.paymentMethod !== 'string' || order.paymentMethod.trim() === '') {
      throw new ValidationError('paymentMethod là bắt buộc');
    }
    if (!Array.isArray(order.items) || order.items.length === 0) {
      throw new ValidationError('Đơn hàng phải có ít nhất 1 sản phẩm');
    }
    const lines = order.items.map((item) => {
      const product = findProduct(item?.sku);
      if (!product) {
        throw new ValidationError(`Sản phẩm không tồn tại: ${item?.sku}`);
      }
      if (!Number.isInteger(item.qty) || item.qty < 1 || item.qty > product.stock) {
        throw new ValidationError(`Số lượng không hợp lệ cho ${product.sku}: ${item.qty} (tồn kho ${product.stock})`);
      }
      return { sku: product.sku, name: product.name, price: product.price, qty: item.qty };
    });
    const total = lines.reduce((sum, line) => sum + line.price * line.qty, 0);
    return { lines, total };
  });
}

/** Bước 2: giữ hàng. Chỉ mô phỏng, không trừ tồn kho thật. Mỗi dòng hàng ghi một span event. */
function reserveInventory(lines) {
  return withSpan('inventory.reserve', { attributes: { 'order.line_count': lines.length } }, async (span) => {
    await simulateLatency();
    for (const line of lines) {
      // Event là một mốc thời gian bên trong span, nhẹ hơn nhiều so với tạo span con.
      span.addEvent('stock.reserved', { sku: line.sku, qty: line.qty });
    }
  });
}

/**
 * Bước 3: thanh toán. CỐ Ý viết tay bằng API gốc, không qua withSpan(), để thấy đủ các bước:
 * startActiveSpan → setAttribute → (khi lỗi) recordException + error.type + setStatus → end().
 */
function chargePayment({ method, amount }) {
  return tracer.startActiveSpan(
    'payment.charge',
    { attributes: { 'payment.method': method, 'payment.amount': amount } },
    async (span) => {
      try {
        await simulateLatency();
        if (method === 'expired_card') {
          throw new PaymentError('Thẻ đã hết hạn', 'CARD_EXPIRED');
        }
        const transactionId = `TXN-${randomUUID().slice(0, 8).toUpperCase()}`;
        span.setAttribute('payment.transaction_id', transactionId);
        return { transactionId };
      } catch (err) {
        span.recordException(err); // event "exception": exception.type / message / stacktrace
        span.setAttribute(ATTR_ERROR_TYPE, err.code || err.name); // error.type = CARD_EXPIRED
        span.setStatus({ code: SpanStatusCode.ERROR, message: err.message }); // span hiện đỏ trong Jaeger
        throw err;
      } finally {
        span.end(); // quên end() thì span không bao giờ được export
      }
    }
  );
}

/**
 * Bước 4: đẩy event "order.created" vào Redis list. Instrumentation ioredis chỉ tạo span cho
 * lệnh LPUSH, KHÔNG truyền context qua nội dung message, nên phải tự inject vào `headers`.
 * @param {{ lpush(key: string, value: string): Promise<number> }} redis
 * @param {{ orderId: string, customerId: string, total: number, itemCount: number }} payload
 */
function publishOrderCreated(redis, payload) {
  const messageId = `msg-${randomUUID()}`;
  return withSpan(
    `send ${QUEUE_NAME}`,
    {
      kind: SpanKind.PRODUCER,
      attributes: {
        [ATTR_MESSAGING_SYSTEM]: 'redis',
        [ATTR_MESSAGING_DESTINATION_NAME]: QUEUE_NAME,
        [ATTR_MESSAGING_OPERATION_TYPE]: 'send',
        [ATTR_MESSAGING_OPERATION_NAME]: 'send',
        [ATTR_MESSAGING_MESSAGE_ID]: messageId,
      },
    },
    async () => {
      const message = {
        id: messageId,
        type: 'order.created',
        payload,
        // Inject BÊN TRONG span PRODUCER: traceparent trỏ tới span này, nên span CONSUMER
        // ở worker sẽ là con của nó.
        headers: injectContext({}),
        publishedAt: new Date().toISOString(),
      };
      await redis.lpush(QUEUE_NAME, JSON.stringify(message));
      return message;
    }
  );
}

module.exports = { validateOrder, reserveInventory, chargePayment, publishOrderCreated };
