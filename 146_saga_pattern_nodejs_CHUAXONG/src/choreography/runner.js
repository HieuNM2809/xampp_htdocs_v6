'use strict';

const logger = require('../infra/logger');
const { EventBus } = require('../infra/eventBus');
const { db } = require('../infra/store');
const orderService = require('../services/orderService');
const { registerHandlers } = require('./handlers');

/** Bỏ field nội bộ trước khi đưa vào payload event. */
function clean(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    if (!k.startsWith('_')) out[k] = v;
  }
  return out;
}

/**
 * Khởi động saga theo kiểu choreography.
 *
 * Bước đầu tiên là một LOCAL TRANSACTION rồi mới publish event. Trong hệ thật
 * hai việc này phải nguyên tử với nhau, nếu không sẽ có đơn đã tạo mà không ai
 * biết (hoặc event đã bay mà đơn chưa có). Cách chuẩn: Transactional Outbox -
 * ghi order và ghi bản tin vào cùng một DB transaction, một job riêng đọc
 * outbox rồi đẩy sang broker.
 */
async function runOrderChoreography({ sagaId, request, faults, redeliver = false }) {
  const startedAt = Date.now();
  const bus = new EventBus({ redeliver });
  registerHandlers(bus, faults);

  const ctx = { sagaId, request, data: {}, faults, failure: null };

  const out = await orderService.createOrder(ctx);
  Object.assign(ctx.data, out);
  logger.localTx('order', 'createOrder', clean(out), 'ghi DB + ghi outbox trong 1 transaction');

  bus.publish('ORDER_CREATED', {
    sagaId,
    request,
    data: clean(ctx.data),
  });

  await bus.drain();

  const order = db.orders.get(ctx.data.orderId);
  const orderStatus = order ? order.status : 'UNKNOWN';

  // Choreography không có "trạng thái saga" ở đâu cả - phải suy ra từ trạng
  // thái nghiệp vụ cuối cùng. Đây chính là lý do kiểu này khó quan sát hơn.
  const status =
    orderStatus === 'CONFIRMED'
      ? 'COMPLETED'
      : orderStatus === 'CANCELLED'
        ? 'ROLLED_BACK'
        : 'PENDING_RECOVERY';

  logger.sagaEnd(sagaId, status, Date.now() - startedAt);

  return { sagaId, status, orderStatus, events: bus.published };
}

module.exports = { runOrderChoreography };
