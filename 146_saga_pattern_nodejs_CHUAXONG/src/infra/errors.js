'use strict';

/**
 * Lỗi NGHIỆP VỤ: retry bao nhiêu lần cũng vẫn sai (hết tồn kho, không đủ tiền,
 * thẻ bị từ chối...). Gặp lỗi này thì đi thẳng sang compensation, KHÔNG retry.
 */
class BusinessError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'BusinessError';
    this.code = code;
    this.retryable = false;
  }
}

/**
 * Lỗi HẠ TẦNG / tạm thời: timeout, mất kết nối, service 503...
 * Loại này ĐƯỢC retry vì lần sau có thể thành công.
 */
class TransientError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'TransientError';
    this.code = code;
    this.retryable = true;
  }
}

module.exports = { BusinessError, TransientError };
