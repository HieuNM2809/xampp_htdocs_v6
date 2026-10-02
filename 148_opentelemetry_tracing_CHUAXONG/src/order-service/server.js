'use strict';

const express = require('express');
const Redis = require('ioredis');
const { createLogger } = require('../shared/logger');
const { getBaggageValue } = require('../shared/propagation');
const { currentTraceId, errorHandler, listen } = require('../shared/http');
const { AppError } = require('./errors');
const { validateOrder, reserveInventory, chargePayment, publishOrderCreated } = require('./steps');

const log = createLogger('order-service');

/**
 * Tạo Express app. `redis` được truyền vào (thay vì tạo bên trong) để unit test dùng Redis giả.
 * @param {{ redis: { lpush(key: string, value: string): Promise<number> } }} deps
 */
function createApp({ redis }) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/orders', async (req, res) => {
    const order = req.body;
    // Baggage do gateway gắn, đi theo header `baggage`. Instrumentation http đã đọc sẵn vào context.
    const customerTier = getBaggageValue('customer.tier');
    try {
      const { lines, total } = await validateOrder(order, { customerTier });
      await reserveInventory(lines);
      const { transactionId } = await chargePayment({ method: order.paymentMethod, amount: total });
      const orderId = `ORD-${Date.now()}`;
      await publishOrderCreated(redis, { orderId, customerId: order.customerId, total, itemCount: lines.length });
      log.info('đã xác nhận đơn', { orderId, total, transactionId });
      res.status(201).json({ orderId, status: 'CONFIRMED', total, traceId: currentTraceId() });
    } catch (err) {
      // Lỗi bất ngờ (ví dụ Redis mất kết nối): ném tiếp cho errorHandler, trả 500.
      if (!(err instanceof AppError)) throw err;
      // Lỗi nghiệp vụ đã biết: trả response ngay tại đây. Nếu đẩy qua next(err), instrumentation
      // express sẽ đánh dấu cả span "request handler" là ERROR, kể cả với lỗi 400.
      log.warn('từ chối đơn', { code: err.code, reason: err.message });
      res.status(err.status).json({ error: err.code, message: err.message, traceId: currentTraceId() });
    }
  });

  app.use(errorHandler(log));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3001;
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:16379';
  // maxRetriesPerRequest: 1 -> Redis chết thì request lỗi nhanh (500) thay vì treo chờ kết nối lại.
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: 1 });
  redis.on('error', (err) => log.error('lỗi Redis', { reason: err.message }));
  listen(createApp({ redis }), port, log, { redis: redisUrl });
}

module.exports = { createApp };
