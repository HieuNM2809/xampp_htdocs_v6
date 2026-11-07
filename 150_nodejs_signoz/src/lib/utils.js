'use strict';

/** Chờ `ms` mili giây. Dùng để giả lập độ trễ của database, mạng, cổng thanh toán. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Số nguyên ngẫu nhiên trong đoạn [min, max]. */
const randomInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

/**
 * Lỗi kèm HTTP status. Middleware errorHandler (lib/middlewares.js) đọc `status` để trả về
 * đúng mã lỗi thay vì luôn là 500.
 */
class HttpError extends Error {
  constructor(status, message, options) {
    super(message, options);
    this.name = 'HttpError';
    this.status = status;
  }
}

module.exports = { sleep, randomInt, HttpError };
