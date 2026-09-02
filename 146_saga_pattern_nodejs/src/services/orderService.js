'use strict';

const { db, nextId } = require('../infra/store');
const { action } = require('./serviceKit');

/** ORDER SERVICE - sở hữu bảng `orders`. */

// Bước 1: tạo đơn ở trạng thái PENDING (chưa phải đơn hợp lệ để giao).
const createOrder = action('order.create', 12, (ctx) => {
  const { customerId, sku, qty, unitPrice } = ctx.request;
  const orderId = ctx.request.orderId || nextId('ORD');
  const amount = qty * unitPrice;

  db.orders.set(orderId, {
    id: orderId,
    customerId,
    sku,
    qty,
    amount,
    status: 'PENDING',
    createdAt: Date.now(),
  });

  return { orderId, amount, status: 'PENDING' };
});

// Bước cuối (sau pivot): chốt đơn. Bắt buộc phải thành công, nếu lỗi thì retry
// chứ không được hủy đơn - vì hàng đã lên xe rồi.
const confirmOrder = action('order.confirm', 8, (ctx) => {
  const order = db.orders.get(ctx.data.orderId);
  order.status = 'CONFIRMED';
  order.confirmedAt = Date.now();
  return { orderId: order.id, status: order.status };
});

// COMPENSATION cho bước 1.
const cancelOrder = action('order.cancel', 10, (ctx) => {
  const order = db.orders.get(ctx.data.orderId);
  if (!order) return { orderId: ctx.data.orderId, status: 'NOT_FOUND' };
  order.status = 'CANCELLED';
  order.cancelReason = ctx.failure ? ctx.failure.message : 'saga compensation';
  return { orderId: order.id, status: order.status };
});

module.exports = { createOrder, confirmOrder, cancelOrder };
