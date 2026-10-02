'use strict';

const orderService = require('../services/orderService');
const inventoryService = require('../services/inventoryService');
const paymentService = require('../services/paymentService');
const shippingService = require('../services/shippingService');
const { SagaOrchestrator } = require('./sagaOrchestrator');

/**
 * ĐỊNH NGHĨA SAGA "đặt hàng".
 *
 * Toàn bộ tri thức về luồng nằm gọn trong mảng này - đó vừa là ưu điểm lớn
 * nhất của orchestration (đọc một file là hiểu cả nghiệp vụ), vừa là nhược
 * điểm của nó (orchestrator biết quá nhiều, dễ thành God Service).
 *
 *   order.create  ---> inventory.reserve ---> payment.charge
 *        |                    |                    |
 *   order.cancel <--- inventory.release <--- payment.refund     (bù trừ)
 *
 *   ---> shipping.schedule ---> [carrier.handover = PIVOT] ---> order.confirm
 *              |                                                     |
 *        shipping.cancel                                    retry / forward
 */
const steps = [
  {
    name: 'order.create',
    type: 'compensatable',
    invoke: orderService.createOrder,
    compensate: orderService.cancelOrder,
  },
  {
    name: 'inventory.reserve',
    type: 'compensatable',
    invoke: inventoryService.reserveStock,
    compensate: inventoryService.releaseStock,
  },
  {
    name: 'payment.charge',
    type: 'compensatable',
    invoke: paymentService.charge,
    compensate: paymentService.refund,
  },
  {
    name: 'shipping.schedule',
    type: 'compensatable',
    invoke: shippingService.scheduleDelivery,
    compensate: shippingService.cancelDelivery,
  },
  {
    // PIVOT POINT: tài xế nhận hàng và rời kho.
    // Không có `compensate` - và đó là chủ ý, không phải thiếu sót.
    name: 'carrier.handover',
    type: 'pivot',
    invoke: shippingService.handoverToCarrier,
  },
  {
    // Sau pivot: chỉ được đi tiếp. Cho nhiều lượt retry hơn vì bắt buộc
    // phải về đích, không có đường lùi.
    name: 'order.confirm',
    type: 'retriable',
    invoke: orderService.confirmOrder,
    retry: { attempts: 4, delayMs: 20, factor: 2 },
  },
];

const createOrderSaga = () => new SagaOrchestrator({ name: 'create-order', steps });

module.exports = { createOrderSaga, steps };
