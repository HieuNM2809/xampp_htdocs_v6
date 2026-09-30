'use strict';

const express = require('express');
const { createLogger } = require('../shared/logger');
const { withBaggage } = require('../shared/propagation');
const { currentTraceId, errorHandler } = require('../shared/http');

const log = createLogger('api-gateway');

/** Khách có mã bắt đầu bằng "VIP" thuộc hạng gold, còn lại là standard. */
function customerTierOf(customerId) {
  return typeof customerId === 'string' && customerId.startsWith('VIP') ? 'gold' : 'standard';
}

/** @param {{ orderServiceUrl?: string }} [options] */
function createApp({ orderServiceUrl = process.env.ORDER_SERVICE_URL || 'http://localhost:3001' } = {}) {
  const app = express();
  app.use(express.json());

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/orders', async (req, res) => {
    const traceId = currentTraceId();
    const tier = customerTierOf(req.body?.customerId);
    let upstream;
    try {
      // KHÔNG cần tự gắn header traceparent: instrumentation undici (fetch) tự inject từ context
      // đang active. withBaggage chỉ thêm baggage customer.tier vào context đó.
      upstream = await withBaggage({ 'customer.tier': tier }, () =>
        fetch(`${orderServiceUrl}/orders`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(req.body ?? {}),
          signal: AbortSignal.timeout(5000),
        })
      );
    } catch (err) {
      const reason = err.cause?.code ? `${err.message} (${err.cause.code})` : err.message;
      log.error('không gọi được order-service', { reason });
      return res.status(503).json({ error: 'ORDER_SERVICE_UNAVAILABLE', message: reason, traceId });
    }
    const body = await upstream.json().catch(() => ({}));
    log.info('đã chuyển tiếp đơn', { status: upstream.status, tier });
    res.status(upstream.status).json({ ...body, traceId });
  });

  app.use(errorHandler(log));
  return app;
}

if (require.main === module) {
  const port = Number(process.env.PORT) || 3000;
  createApp().listen(port, () => log.info(`đang nghe http://localhost:${port}`));
}

module.exports = { createApp, customerTierOf };
