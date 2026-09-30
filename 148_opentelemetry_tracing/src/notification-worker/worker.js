'use strict';

const Redis = require('ioredis');
const { SpanKind } = require('@opentelemetry/api');
const { withSpan } = require('../shared/tracer');
const { extractContext, getBaggageValue } = require('../shared/propagation');
const { createLogger } = require('../shared/logger');
const {
  QUEUE_NAME,
  ATTR_MESSAGING_SYSTEM,
  ATTR_MESSAGING_DESTINATION_NAME,
  ATTR_MESSAGING_OPERATION_TYPE,
  ATTR_MESSAGING_OPERATION_NAME,
  ATTR_MESSAGING_MESSAGE_ID,
} = require('../shared/messaging');

const log = createLogger('notification-worker');
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Xử lý một message lấy từ Redis. Tách khỏi vòng lặp để unit test gọi trực tiếp.
 * @param {string} raw nội dung message (JSON)
 * @returns {Promise<boolean>} false nếu message hỏng (đã log và bỏ qua)
 */
async function handleMessage(raw) {
  let message;
  try {
    message = JSON.parse(raw);
  } catch (err) {
    log.error('bỏ qua message không phải JSON', { reason: err.message });
    return false;
  }

  // Dựng lại context của producer từ headers. Span CONSUMER tạo từ context này là con của span
  // PRODUCER bên order-service, nên cả luồng hiện thành MỘT trace trong Jaeger.
  const parentContext = extractContext(message?.headers);
  const tier = getBaggageValue('customer.tier', parentContext) || 'unknown';

  await withSpan(
    `process ${QUEUE_NAME}`,
    {
      kind: SpanKind.CONSUMER,
      attributes: {
        [ATTR_MESSAGING_SYSTEM]: 'redis',
        [ATTR_MESSAGING_DESTINATION_NAME]: QUEUE_NAME,
        [ATTR_MESSAGING_OPERATION_TYPE]: 'process',
        [ATTR_MESSAGING_OPERATION_NAME]: 'process',
        [ATTR_MESSAGING_MESSAGE_ID]: String(message?.id ?? ''),
        'customer.tier': tier,
        'notification.priority': tier === 'gold' ? 'high' : 'normal',
      },
    },
    async () => {
      await withSpan(
        'email.send',
        { attributes: { 'notification.channel': 'email', 'notification.template': 'order-confirmation' } },
        () => sleep(30 + Math.floor(Math.random() * 50)) // giả lập gọi dịch vụ gửi email
      );
      log.info('đã gửi email xác nhận', { orderId: message?.payload?.orderId, tier });
    },
    parentContext
  );
  return true;
}

/** Vòng lặp chờ message. BRPOP chặn tối đa 5 giây mỗi lần rồi lặp lại. */
async function run(redis) {
  log.info(`đang chờ message trên list "${QUEUE_NAME}"`);
  for (;;) {
    let item;
    try {
      // Lúc này không có span cha, nên instrumentation ioredis (mặc định requireParentSpan: true)
      // không tạo span cho BRPOP. Nhờ vậy Jaeger không bị ngập span rác mỗi 5 giây.
      item = await redis.brpop(QUEUE_NAME, 5);
    } catch (err) {
      log.error('lỗi đọc Redis, thử lại sau 1 giây', { reason: err.message });
      await sleep(1000);
      continue;
    }
    if (!item) continue; // hết 5 giây mà chưa có message
    const [, raw] = item;
    await handleMessage(raw).catch((err) => log.error('xử lý message thất bại', { reason: err.message }));
  }
}

if (require.main === module) {
  const redisUrl = process.env.REDIS_URL || 'redis://localhost:16379';
  const redis = new Redis(redisUrl);
  redis.on('error', (err) => log.error('lỗi Redis', { reason: err.message }));
  run(redis);
}

module.exports = { handleMessage };
