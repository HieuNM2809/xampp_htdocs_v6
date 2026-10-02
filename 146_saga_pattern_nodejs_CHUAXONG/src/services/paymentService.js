'use strict';

const { db, nextId } = require('../infra/store');
const { BusinessError } = require('../infra/errors');
const { action } = require('./serviceKit');
const { money } = require('../infra/util');

/** PAYMENT SERVICE - sở hữu `wallets` và `payments`. */

// Bước 3: thu tiền.
const charge = action('payment.charge', 30, (ctx) => {
  const { customerId } = ctx.request;
  const amount = ctx.data.amount;
  const wallet = db.wallets.get(customerId);

  if (!wallet) throw new BusinessError('WALLET_NOT_FOUND', `không có ví ${customerId}`);
  if (wallet.balance < amount) {
    throw new BusinessError(
      'INSUFFICIENT_FUNDS',
      `cần ${money(amount)}, ví chỉ có ${money(wallet.balance)}`
    );
  }

  wallet.balance -= amount;
  const paymentId = nextId('PAY');
  db.payments.set(paymentId, { id: paymentId, customerId, amount, type: 'CHARGE' });

  return { paymentId, amount, balanceLeft: wallet.balance };
});

/**
 * COMPENSATION cho bước 3.
 *
 * Đây là chỗ thể hiện rõ nhất "compensation KHÔNG phải rollback":
 * bút toán CHARGE đã commit và không bị xoá. Ta ghi thêm một bút toán REFUND
 * mới, ngược dấu. Sổ sách giữ đủ vết cả hai chiều - đúng nguyên tắc kế toán,
 * và đó là lý do không thể dùng `ROLLBACK` của DB ở đây.
 */
const refund = action('payment.refund', 28, (ctx) => {
  const original = db.payments.get(ctx.data.paymentId);
  if (!original) return { paymentId: ctx.data.paymentId, status: 'NOT_FOUND' };
  if (original.refundedBy) {
    return { refundId: original.refundedBy, status: 'ALREADY_REFUNDED' };
  }

  const wallet = db.wallets.get(original.customerId);
  wallet.balance += original.amount;

  const refundId = nextId('PAY');
  db.payments.set(refundId, {
    id: refundId,
    customerId: original.customerId,
    amount: original.amount,
    type: 'REFUND',
    reverses: original.id,
  });
  original.refundedBy = refundId;

  return { refundId, reverses: original.id, balanceLeft: wallet.balance };
});

module.exports = { charge, refund };
