'use strict';

const { db, nextId } = require('../infra/store');
const { action } = require('./serviceKit');

/** SHIPPING SERVICE - sở hữu `shipments`. */

// Bước 4: đặt chỗ giao hàng. Vẫn còn hủy được vì hàng còn trong kho.
const scheduleDelivery = action('shipping.schedule', 22, (ctx) => {
  const shipmentId = nextId('SHP');
  db.shipments.set(shipmentId, {
    id: shipmentId,
    orderId: ctx.data.orderId,
    status: 'SCHEDULED',
    eta: '2026-09-05',
  });
  return { shipmentId, status: 'SCHEDULED', eta: '2026-09-05' };
});

// COMPENSATION cho bước 4.
const cancelDelivery = action('shipping.cancel', 18, (ctx) => {
  const shipment = db.shipments.get(ctx.data.shipmentId);
  if (!shipment) return { shipmentId: ctx.data.shipmentId, status: 'NOT_FOUND' };
  if (shipment.status === 'HANDED_OVER') {
    // Bảo hiểm ở tầng nghiệp vụ: hàng đã rời kho thì không được "hủy" ngầm.
    return { shipmentId: shipment.id, status: 'CANNOT_CANCEL_AFTER_HANDOVER' };
  }
  shipment.status = 'CANCELLED';
  return { shipmentId: shipment.id, status: shipment.status };
});

/**
 * Bước 5 - PIVOT POINT.
 *
 * Tài xế quét mã, nhận hàng, ra khỏi kho. Từ giây phút này không tồn tại
 * "compensation" nào tương đương: muốn đảo ngược phải mở một quy trình nghiệp
 * vụ MỚI (thu hồi / hoàn hàng), tốn tiền thật và cần con người. Nên saga coi
 * đây là điểm không quay đầu, và mọi bước sau đó chỉ được forward recovery.
 */
const handoverToCarrier = action('carrier.handover', 26, (ctx) => {
  const shipment = db.shipments.get(ctx.data.shipmentId);
  shipment.status = 'HANDED_OVER';
  shipment.trackingNo = nextId('TRK');
  return { shipmentId: shipment.id, trackingNo: shipment.trackingNo, status: shipment.status };
});

module.exports = { scheduleDelivery, cancelDelivery, handoverToCarrier };
