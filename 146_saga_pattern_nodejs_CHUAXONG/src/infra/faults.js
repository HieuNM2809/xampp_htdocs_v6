'use strict';

const { BusinessError, TransientError } = require('./errors');

/**
 * Bộ tiêm lỗi. Mỗi scenario khai báo lỗi muốn mô phỏng, ví dụ:
 *
 *   createFaultInjector({
 *     'shipping.dispatch': { kind: 'business', code: 'NO_COURIER', message: '...' },
 *     'order.confirm':     { kind: 'transient', code: 'TIMEOUT', times: 2, message: '...' },
 *   })
 *
 * `times` = số lần đầu tiên bị lỗi, các lần sau thành công -> dùng để demo
 * retry cứu được lỗi tạm thời.
 */
function createFaultInjector(config = {}) {
  const attempts = new Map();

  return {
    check(action) {
      const rule = config[action];
      if (!rule) return;

      const n = (attempts.get(action) || 0) + 1;
      attempts.set(action, n);

      // Chỉ lỗi ở `times` lần đầu (nếu có khai báo), sau đó cho qua.
      if (typeof rule.times === 'number' && n > rule.times) return;

      const code = rule.code || 'INJECTED';
      const message = rule.message || `lỗi mô phỏng tại ${action}`;
      throw rule.kind === 'transient'
        ? new TransientError(code, message)
        : new BusinessError(code, message);
    },
  };
}

/** Injector rỗng: không tiêm lỗi nào. */
const noFaults = () => createFaultInjector({});

module.exports = { createFaultInjector, noFaults };
