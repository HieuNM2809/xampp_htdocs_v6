'use strict';

/**
 * POST /api/orders       tạo đơn: kiểm tra → trừ kho → ghi đơn → gọi payment-service → cập nhật đơn
 * GET  /api/orders/:id   xem một đơn
 *
 * Body của POST: { "productId": "p-1001", "quantity": 2, "customerId": "c-001" }
 *
 * Một lần POST thành công sinh ra một trace khoảng 15 span, trải qua 2 service: các bước nghiệp vụ
 * (span tự tạo), các câu SQL (span DB giả lập), lời gọi HTTP sang payment-service (span của fetch),
 * rồi các span bên trong payment-service. Sơ đồ cây đầy đủ có trong docs/README.md, mục "Đọc một trace".
 */

const express = require('express');
const { trace, SpanStatusCode } = require('@opentelemetry/api');
const db = require('../lib/fake-db');
const { chargePayment } = require('../lib/payment-client');
const { logger } = require('../lib/logger');
const { withSpan, ordersCounter, revenueCounter } = require('../lib/telemetry');

const router = express.Router();

/** Kiểm tra body; trả về danh sách lỗi (rỗng nếu hợp lệ) và giá trị đã chuẩn hoá. */
function validateOrderInput(body) {
  const productId = body?.productId;
  const quantity = body?.quantity ?? 1;
  const customerId = body?.customerId ?? 'guest';
  const errors = [];
  if (typeof productId !== 'string' || productId.trim() === '') errors.push('productId là bắt buộc (chuỗi)');
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) errors.push('quantity phải là số nguyên từ 1 đến 10');
  if (typeof customerId !== 'string') errors.push('customerId phải là chuỗi');
  return { errors, value: { productId, quantity, customerId } };
}

router.post('/', async (req, res) => {
  // Span đang active trong handler là span "request handler - /api/orders" do instrumentation-express
  // tạo. Mọi span tạo trong handler (withSpan, DB, fetch) đều thành con của nó.
  const span = trace.getActiveSpan();

  // 1. Kiểm tra dữ liệu vào, trong một span riêng để thấy bước này trên trace.
  const { errors, value } = await withSpan('order.validate', async (validateSpan) => {
    const result = validateOrderInput(req.body);
    validateSpan.setAttribute('app.validation.error_count', result.errors.length);
    return result;
  });
  if (errors.length > 0) {
    ordersCounter.add(1, { 'order.status': 'rejected' });
    logger.warn({ errors }, 'Đơn hàng không hợp lệ');
    return res.status(400).json({ error: 'Dữ liệu không hợp lệ', details: errors });
  }
  const { productId, quantity, customerId } = value;

  // Gắn thông tin nghiệp vụ vào span. Trên SigNoz lọc được trace theo khách hàng, sản phẩm, mã đơn.
  // Thuộc tính tự đặt nên có tiền tố riêng (app.) để không đụng tên chuẩn của OpenTelemetry.
  span?.setAttributes({
    'app.customer.id': customerId,
    'app.product.id': productId,
    'app.order.quantity': quantity,
  });

  // 2. Lấy sản phẩm.
  const product = await db.findProduct(productId);
  if (!product) {
    ordersCounter.add(1, { 'order.status': 'rejected' });
    return res.status(404).json({ error: `Không tìm thấy sản phẩm ${productId}` });
  }

  // 3. Giữ hàng: UPDATE có điều kiện, không đủ hàng thì không trừ. 409 = xung đột với trạng thái kho.
  const reserved = await db.reserveStock(productId, quantity);
  if (!reserved) {
    ordersCounter.add(1, { 'order.status': 'out_of_stock' });
    logger.warn({ productId, quantity }, 'Không đủ hàng trong kho');
    return res.status(409).json({ error: `Sản phẩm ${productId} không đủ hàng` });
  }

  // 4. Ghi đơn ở trạng thái chờ thanh toán.
  const amount = product.price * quantity;
  const order = await db.insertOrder({ productId, quantity, customerId, amount });
  span?.setAttributes({ 'app.order.id': order.id, 'app.order.amount': amount });
  logger.info({ orderId: order.id, amount }, 'Đã tạo đơn, đang gọi payment-service');

  // 5. Thanh toán qua payment-service: HTTP sang service thứ hai, vẫn cùng một trace.
  let payment;
  try {
    payment = await chargePayment({ orderId: order.id, amount, customerId });
  } catch (err) {
    // Bù trừ (compensation): đánh dấu đơn thất bại và trả hàng lại kho.
    await db.updateOrderStatus(order.id, 'PAYMENT_FAILED');
    await db.releaseStock(productId, quantity);
    ordersCounter.add(1, { 'order.status': 'payment_failed' });

    // Lỗi đã được xử lý ở đây (không ném tiếp cho Express), nên phải tự ghi vào span.
    // Nhờ vậy lỗi hiện trong tab Exceptions của SigNoz và span bị tô đỏ.
    span?.recordException(err);
    span?.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
    logger.error({ err, orderId: order.id }, 'Thanh toán thất bại, đã hoàn lại kho');

    return res.status(err.status || 502).json({
      error: err.message,
      orderId: order.id,
      traceId: span?.spanContext().traceId,
    });
  }

  // 6. Thành công: cập nhật đơn, đếm metric.
  const paid = await db.updateOrderStatus(order.id, 'PAID', { paymentId: payment.paymentId });
  ordersCounter.add(1, { 'order.status': 'success' });
  revenueCounter.add(amount);
  logger.info({ orderId: order.id, paymentId: payment.paymentId, amount }, 'Đơn đã thanh toán');

  res.status(201).json(paid);
});

router.get('/:id', async (req, res) => {
  const order = await db.findOrder(req.params.id);
  if (!order) return res.status(404).json({ error: `Không tìm thấy đơn ${req.params.id}` });
  res.json(order);
});

module.exports = router;
