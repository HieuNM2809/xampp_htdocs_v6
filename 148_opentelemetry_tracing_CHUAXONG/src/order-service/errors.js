'use strict';

/**
 * Lỗi nghiệp vụ "đã biết": mang sẵn HTTP status và một mã lỗi ổn định.
 * Mã lỗi (`code`) được dùng làm error.type trên span, và SDK cũng dùng nó làm exception.type.
 */
class AppError extends Error {
  constructor(message, { status, code }) {
    super(message);
    this.name = this.constructor.name;
    this.status = status;
    this.code = code;
  }
}

/** Dữ liệu đơn hàng sai: lỗi phía client. */
class ValidationError extends AppError {
  constructor(message) {
    super(message, { status: 400, code: 'VALIDATION_ERROR' });
  }
}

/** Cổng thanh toán từ chối: lỗi ở dịch vụ phía sau, nên trả 502. */
class PaymentError extends AppError {
  constructor(message, code = 'PAYMENT_FAILED') {
    super(message, { status: 502, code });
  }
}

module.exports = { AppError, ValidationError, PaymentError };
