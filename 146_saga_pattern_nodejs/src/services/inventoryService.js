'use strict';

const { db, nextId } = require('../infra/store');
const { BusinessError } = require('../infra/errors');
const { action } = require('./serviceKit');

/** INVENTORY SERVICE - sở hữu `products` và `reservations`. */

// Bước 2: giữ hàng. Đây là SEMANTIC LOCK - hàng chưa trừ hẳn, chỉ bị "treo".
const reserveStock = action('inventory.reserve', 25, (ctx) => {
  const { sku, qty } = ctx.request;
  const product = db.products.get(sku);

  if (!product) throw new BusinessError('SKU_NOT_FOUND', `không có SKU ${sku}`);
  if (product.stock < qty) {
    throw new BusinessError(
      'OUT_OF_STOCK',
      `${sku} chỉ còn ${product.stock}, cần ${qty}`
    );
  }

  product.stock -= qty;
  const reservationId = nextId('RSV');
  db.reservations.set(reservationId, { id: reservationId, sku, qty, status: 'HELD' });

  return { reservationId, sku, qty, stockLeft: product.stock };
});

// COMPENSATION cho bước 2: trả hàng về kho.
// Phải chịu được gọi lại nhiều lần -> kiểm tra status trước khi cộng tồn.
const releaseStock = action('inventory.release', 20, (ctx) => {
  const reservation = db.reservations.get(ctx.data.reservationId);
  if (!reservation) return { reservationId: ctx.data.reservationId, status: 'NOT_FOUND' };
  if (reservation.status === 'RELEASED') {
    return { reservationId: reservation.id, status: 'ALREADY_RELEASED' };
  }

  const product = db.products.get(reservation.sku);
  product.stock += reservation.qty;
  reservation.status = 'RELEASED';

  return { reservationId: reservation.id, sku: reservation.sku, stockLeft: product.stock };
});

module.exports = { reserveStock, releaseStock };
