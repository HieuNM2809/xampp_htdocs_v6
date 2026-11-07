'use strict';

/**
 * order-service: API chính của demo (Express 5).
 *
 *   node --require ./src/tracing.js src/server.js
 *
 *   GET  /health              health check cho Docker (không tạo trace, xem tracing.js)
 *   GET  /api/products        danh sách sản phẩm: cache → DB giả lập
 *   GET  /api/products/:id    chi tiết sản phẩm, 404 nếu không có
 *   POST /api/orders          tạo đơn: DB + gọi payment-service → trace trải qua 2 service
 *   GET  /api/orders/:id      xem đơn
 *   GET  /api/error           cố tình lỗi 500 (?type=db: lỗi phát sinh ở tầng DB)
 *   GET  /api/slow            request chậm có nhiều span con
 */

const express = require('express');
const { logger } = require('./lib/logger');
const { requestContext, notFound, errorHandler } = require('./lib/middlewares');

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'order-service';
const PORT = Number(process.env.PORT) || 3400;

const app = express();
app.disable('x-powered-by');

// Health check khai báo TRƯỚC requestContext: Docker gọi nó vài giây một lần, không cần access log.
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: SERVICE_NAME, uptimeSeconds: Math.round(process.uptime()) });
});

app.use(express.json());
app.use(requestContext());

app.get('/', (req, res) => {
  res.json({
    service: SERVICE_NAME,
    endpoints: [
      'GET  /health',
      'GET  /api/products',
      'GET  /api/products/:id',
      'POST /api/orders   {"productId":"p-1001","quantity":1,"customerId":"c-001"}',
      'GET  /api/orders/:id',
      'GET  /api/error    (?type=db)',
      'GET  /api/slow',
    ],
  });
});

app.use('/api/products', require('./routes/products'));
app.use('/api/orders', require('./routes/orders'));
app.use('/api', require('./routes/demo'));

app.use(notFound());
app.use(errorHandler());

const server = app.listen(PORT, () => {
  logger.info({ port: PORT }, `${SERVICE_NAME} đang chạy ở http://localhost:${PORT}`);
});

// Ngừng nhận request mới khi nhận tín hiệu tắt. Việc flush telemetry rồi thoát process
// do tracing.js đảm nhận (nó cũng lắng nghe SIGTERM/SIGINT).
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    logger.info(`${signal}: ngừng nhận request mới`);
    server.close();
  });
}
