'use strict';

const logger = require('./logger');
const { pushDeadLetter } = require('./store');

/**
 * Event bus in-memory thay cho Kafka / RabbitMQ / SNS-SQS.
 *
 * Mô phỏng 2 tính chất quan trọng của message broker thật:
 *  - Bất đồng bộ: publish xong trả về ngay, handler chạy sau.
 *  - At-least-once: bật `redeliver` để mỗi event được giao 2 lần, kiểm tra
 *    xem handler có idempotent thật hay không.
 *
 * Xử lý tuần tự (1 event / lần) để log đọc được theo đúng thứ tự nhân quả.
 */
class EventBus {
  constructor({ redeliver = false } = {}) {
    this.subscribers = new Map(); // eventType -> [{ service, handler }]
    this.queue = [];
    this.processing = false;
    this.redeliver = redeliver;
    this.published = [];
  }

  subscribe(eventType, service, handler) {
    if (!this.subscribers.has(eventType)) this.subscribers.set(eventType, []);
    this.subscribers.get(eventType).push({ service, handler });
    return this;
  }

  publish(eventType, payload = {}) {
    this.queue.push({ eventType, payload });
    this.published.push(eventType);
    if (this.shouldRedeliver(eventType)) {
      this.queue.push({ eventType, payload, duplicate: true });
    }
    if (!this.processing) this.pump();
  }

  /** `redeliver` nhận `true` (giao lại mọi event) hoặc mảng tên event. */
  shouldRedeliver(eventType) {
    if (this.redeliver === true) return true;
    return Array.isArray(this.redeliver) && this.redeliver.includes(eventType);
  }

  async pump() {
    this.processing = true;
    try {
      while (this.queue.length > 0) {
        const event = this.queue.shift();
        if (event.duplicate) logger.busDuplicate(event.eventType);
        logger.event(event.eventType, event.payload);

        const subs = this.subscribers.get(event.eventType) || [];
        if (subs.length === 0) {
          logger.handler('(none)', 'noop', 'không service nào subscribe');
        }
        for (const sub of subs) {
          try {
            await sub.handler(event.payload, this);
          } catch (err) {
            // Handler nổ mà không ai bắt -> vào DLQ, đúng như consumer thật.
            const entry = pushDeadLetter({
              type: 'EVENT_HANDLER_FAILED',
              sagaId: event.payload.sagaId,
              step: `${sub.service} <- ${event.eventType}`,
              error: `${err.name}[${err.code}] ${err.message}`,
              action: 'replay event sau khi fix, hoặc bù trừ thủ công',
            });
            logger.deadLetter(entry);
          }
        }
      }
    } finally {
      this.processing = false;
    }
  }

  /** Chờ tới khi bus rỗng - chỉ cần cho demo, hệ thật thì bus chạy mãi. */
  async drain(timeoutMs = 10000) {
    const start = Date.now();
    while (this.queue.length > 0 || this.processing) {
      if (Date.now() - start > timeoutMs) throw new Error('EventBus.drain() timeout');
      await new Promise((r) => setTimeout(r, 5));
    }
  }
}

module.exports = { EventBus };
