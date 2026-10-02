'use strict';

/**
 * Hằng số dùng chung cho producer (order-service) và consumer (notification-worker).
 *
 * Attribute messaging.* vẫn ở mức incubating trong @opentelemetry/semantic-conventions 1.43.
 * OpenTelemetry khuyên CHÉP hằng số incubating vào code thay vì import từ entry
 * '@opentelemetry/semantic-conventions/incubating', vì entry đó có thể đổi hoặc xoá giữa các bản minor.
 */
module.exports = {
  QUEUE_NAME: 'order-events',
  ATTR_MESSAGING_SYSTEM: 'messaging.system',
  ATTR_MESSAGING_DESTINATION_NAME: 'messaging.destination.name',
  ATTR_MESSAGING_OPERATION_TYPE: 'messaging.operation.type',
  ATTR_MESSAGING_OPERATION_NAME: 'messaging.operation.name',
  ATTR_MESSAGING_MESSAGE_ID: 'messaging.message.id',
};
