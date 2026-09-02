'use strict';

const logger = require('../infra/logger');
const orderService = require('../services/orderService');
const inventoryService = require('../services/inventoryService');
const paymentService = require('../services/paymentService');
const shippingService = require('../services/shippingService');

/**
 * CHOREOGRAPHY
 *
 * Không có orchestrator. Mỗi service chỉ biết 2 điều:
 *   - nó lắng nghe event nào
 *   - sau khi làm xong thì phát ra event nào
 *
 * Luồng nghiệp vụ không nằm trong file nào cả - nó "hiện ra" từ cách các
 * service phản ứng với nhau. Đó vừa là điểm mạnh (service tự trị, thêm
 * service mới không sửa ai) vừa là điểm yếu (muốn biết luồng đầy đủ phải
 * đọc hết mọi service, hoặc dựng distributed tracing).
 *
 * Chuỗi thuận:
 *   ORDER_CREATED -> STOCK_RESERVED -> PAYMENT_CAPTURED -> SHIPMENT_SCHEDULED
 *                                                       -> ORDER_CONFIRMED
 * Chuỗi bù trừ (chạy ngược bằng chính event):
 *   SHIPMENT_REJECTED -> PAYMENT_REFUNDED -> STOCK_RELEASED -> ORDER_CANCELLED
 *   PAYMENT_REJECTED  ------------------->  STOCK_RELEASED -> ORDER_CANCELLED
 *   STOCK_REJECTED    ----------------------------------->    ORDER_CANCELLED
 */

/** Dựng lại ctx cho service từ payload của event (không có state chung). */
function ctxOf(payload, faults) {
  return {
    sagaId: payload.sagaId,
    request: payload.request,
    data: payload.data || {},
    faults,
    failure: payload.reason ? { message: payload.reason } : null,
  };
}

/** Payload cho event kế tiếp = payload cũ + kết quả bước vừa xong. */
function forward(payload, output, extra = {}) {
  const data = Object.assign({}, payload.data);
  for (const [k, v] of Object.entries(output || {})) {
    if (!k.startsWith('_')) data[k] = v;
  }
  return Object.assign({}, payload, { data }, extra);
}

/** Ghép ghi chú cho log: nhãn bước + cờ replay nếu event bị giao lại. */
function note(output, label) {
  const parts = [];
  if (label) parts.push(label);
  if (output._replayed) parts.push('idempotent replay');
  return parts.length > 0 ? parts.join(', ') : null;
}

function registerHandlers(bus, faults) {
  // ---------------------------------------------------------------- thuận ---

  bus.subscribe('ORDER_CREATED', 'inventory', async (payload, bus) => {
    const ctx = ctxOf(payload, faults);
    try {
      const out = await inventoryService.reserveStock(ctx);
      logger.handler('inventory', 'reserveStock', note(out));
      bus.publish('STOCK_RESERVED', forward(payload, out));
    } catch (err) {
      logger.handler('inventory', 'reserveStock', 'THẤT BẠI: ' + err.message);
      bus.publish('STOCK_REJECTED', forward(payload, {}, { reason: err.message }));
    }
  });

  bus.subscribe('STOCK_RESERVED', 'payment', async (payload, bus) => {
    const ctx = ctxOf(payload, faults);
    try {
      const out = await paymentService.charge(ctx);
      logger.handler('payment', 'charge', note(out));
      bus.publish('PAYMENT_CAPTURED', forward(payload, out));
    } catch (err) {
      logger.handler('payment', 'charge', 'THẤT BẠI: ' + err.message);
      bus.publish('PAYMENT_REJECTED', forward(payload, {}, { reason: err.message }));
    }
  });

  bus.subscribe('PAYMENT_CAPTURED', 'shipping', async (payload, bus) => {
    const ctx = ctxOf(payload, faults);
    try {
      const out = await shippingService.scheduleDelivery(ctx);
      logger.handler('shipping', 'scheduleDelivery', note(out));
      bus.publish('SHIPMENT_SCHEDULED', forward(payload, out));
    } catch (err) {
      logger.handler('shipping', 'scheduleDelivery', 'THẤT BẠI: ' + err.message);
      bus.publish('SHIPMENT_REJECTED', forward(payload, {}, { reason: err.message }));
    }
  });

  bus.subscribe('SHIPMENT_SCHEDULED', 'order', async (payload, bus) => {
    const ctx = ctxOf(payload, faults);
    const out = await orderService.confirmOrder(ctx);
    logger.handler('order', 'confirmOrder', note(out));
    bus.publish('ORDER_CONFIRMED', forward(payload, out));
  });

  // --------------------------------------------------------------- bù trừ ---
  // Điểm cần nhớ: compensation ở đây cũng chỉ là event bình thường. Không có
  // ai "ra lệnh rollback"; mỗi service tự biết phải nhả thứ mình đang giữ khi
  // nghe tin bước sau thất bại.

  bus.subscribe('SHIPMENT_REJECTED', 'payment', async (payload, bus) => {
    const ctx = ctxOf(payload, faults);
    const out = await paymentService.refund(ctx);
    logger.handler('payment', 'refund', note(out, 'bù trừ'));
    bus.publish('PAYMENT_REFUNDED', forward(payload, out));
  });

  bus.subscribe('PAYMENT_REFUNDED', 'inventory', async (payload, bus) => {
    const ctx = ctxOf(payload, faults);
    const out = await inventoryService.releaseStock(ctx);
    logger.handler('inventory', 'releaseStock', note(out, 'bù trừ'));
    bus.publish('STOCK_RELEASED', forward(payload, out));
  });

  bus.subscribe('PAYMENT_REJECTED', 'inventory', async (payload, bus) => {
    const ctx = ctxOf(payload, faults);
    const out = await inventoryService.releaseStock(ctx);
    logger.handler('inventory', 'releaseStock', note(out, 'bù trừ'));
    bus.publish('STOCK_RELEASED', forward(payload, out));
  });

  bus.subscribe('STOCK_RELEASED', 'order', async (payload, bus) => {
    const ctx = ctxOf(payload, faults);
    const out = await orderService.cancelOrder(ctx);
    logger.handler('order', 'cancelOrder', note(out, 'bù trừ'));
    bus.publish('ORDER_CANCELLED', forward(payload, out));
  });

  bus.subscribe('STOCK_REJECTED', 'order', async (payload, bus) => {
    const ctx = ctxOf(payload, faults);
    const out = await orderService.cancelOrder(ctx);
    logger.handler('order', 'cancelOrder', note(out, 'bù trừ'));
    bus.publish('ORDER_CANCELLED', forward(payload, out));
  });

  // Hai event kết thúc không ai xử lý tiếp - đăng ký handler rỗng để log gọn.
  bus.subscribe('ORDER_CONFIRMED', 'analytics', async () => {});
  bus.subscribe('ORDER_CANCELLED', 'analytics', async () => {});

  return bus;
}

module.exports = { registerHandlers };
