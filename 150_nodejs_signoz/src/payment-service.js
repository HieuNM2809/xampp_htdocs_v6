'use strict';

/**
 * payment-service: dịch vụ thanh toán GIẢ LẬP, đóng vai "service bên ngoài" mà order-service gọi tới.
 *
 *   node --require ./src/tracing.js src/payment-service.js
 *
 * Chạy bằng cùng image và cùng tracing.js với order-service, chỉ khác OTEL_SERVICE_NAME. Vì vậy SigNoz
 * thấy hai service riêng biệt và vẽ được Service Map: order-service → payment-service.
 *
 *   POST /payments  { orderId, amount, customerId }
 *     fraud.check      span nội bộ: chấm điểm rủi ro gian lận
 *     bank.authorize   span kind=CLIENT: giả lập gọi cổng ngân hàng bên ngoài (chậm, thỉnh thoảng lỗi)
 *
 * PAYMENT_FAILURE_RATE (0..1, mặc định 0.15): tỉ lệ cổng ngân hàng "không phản hồi" → trả 502.
 * Lỗi này lan sang order-service trong CÙNG một trace, đúng thứ cần thấy khi debug hệ thống nhiều service.
 */

const express = require('express');
const { randomUUID } = require('node:crypto');
const { SpanKind, trace } = require('@opentelemetry/api');
const { logger } = require('./lib/logger');
const { withSpan } = require('./lib/telemetry');
const { requestContext, notFound, errorHandler } = require('./lib/middlewares');
const { sleep, randomInt } = require('./lib/utils');

const SERVICE_NAME = process.env.OTEL_SERVICE_NAME || 'payment-service';
const PORT = Number(process.env.PORT) || 3401;
const rawFailureRate = Number(process.env.PAYMENT_FAILURE_RATE ?? 0.15);
const FAILURE_RATE = Number.isFinite(rawFailureRate) ? Math.min(Math.max(rawFailureRate, 0), 1) : 0.15;

const app = express();
app.disable('x-powered-by');

app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: SERVICE_NAME, uptimeSeconds: Math.round(process.uptime()) });
});

app.use(express.json());
app.use(requestContext());

app.post('/payments', async (req, res) => {
  const { orderId, amount, customerId } = req.body ?? {};
  if (typeof orderId !== 'string' || !(Number(amount) > 0)) {
    return res.status(400).json({ error: 'Cần orderId (chuỗi) và amount (số > 0)' });
  }

  // Span này nằm trong CÙNG trace với order-service: instrumentation-http đã đọc header
  // `traceparent` của request và nối span HTTP của service này vào span fetch bên kia.
  trace.getActiveSpan()?.setAttributes({
    'app.order.id': orderId,
    'app.customer.id': String(customerId ?? 'guest'),
    'app.payment.amount': Number(amount),
  });

  const riskScore = await withSpan('fraud.check', async (span) => {
    await sleep(randomInt(10, 40));
    const score = randomInt(0, 100);
    span.setAttribute('app.fraud.score', score);
    return score;
  });

  try {
    const authCode = await withSpan(
      'bank.authorize',
      {
        // CLIENT: service này đang gọi ra một hệ thống bên ngoài. Hệ thống đó không gửi telemetry,
        // nên chỉ có span phía ta; peer.service cho biết đang gọi ai.
        kind: SpanKind.CLIENT,
        attributes: {
          'peer.service': 'bank-gateway',
          'server.address': 'api.bank.example',
          'server.port': 443,
          'http.request.method': 'POST',
          'url.full': 'https://api.bank.example/v1/authorize',
        },
      },
      async (span) => {
        await sleep(randomInt(40, 200));
        if (Math.random() < FAILURE_RATE) {
          await sleep(randomInt(300, 800)); // chờ thêm một lúc rồi mới "timeout", như ngoài đời
          throw new Error('Bank gateway timeout: ngân hàng không phản hồi');
        }
        const code = `AUTH${randomInt(100000, 999999)}`;
        span.setAttribute('app.bank.auth_code', code);
        return code;
      }
    );

    const paymentId = `pay_${randomUUID().slice(0, 8)}`;
    logger.info({ orderId, paymentId, amount, riskScore }, 'Thanh toán thành công');
    res.status(201).json({ paymentId, orderId, amount, status: 'APPROVED', authCode });
  } catch (err) {
    // withSpan đã ghi exception vào span bank.authorize và tô đỏ span đó. Ở đây chỉ log và trả 502:
    // instrumentation-http thấy mã >= 500 nên tự đánh dấu span HTTP gốc của service này là lỗi.
    logger.error({ err, orderId, amount }, 'Thanh toán thất bại vì cổng ngân hàng');
    res.status(502).json({ error: err.message, orderId });
  }
});

app.use(notFound());
app.use(errorHandler());

const server = app.listen(PORT, () => {
  logger.info({ port: PORT, failureRate: FAILURE_RATE }, `${SERVICE_NAME} đang chạy ở http://localhost:${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    logger.info(`${signal}: ngừng nhận request mới`);
    server.close();
  });
}
