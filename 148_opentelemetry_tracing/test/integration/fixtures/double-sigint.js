'use strict';

/**
 * Chạy dưới `node --require ./src/tracing.js` (xem test/integration/tracing.test.js):
 * giả lập người dùng bấm Ctrl+C hai lần liên tiếp. Lần 1 bắt đầu tắt êm (flush span), lần 2
 * phải thoát ngay. process.emit() gọi handler trực tiếp nên chạy được cả trên Windows, nơi
 * không gửi được signal thật cho tiến trình con.
 */
setInterval(() => {}, 1000); // giữ tiến trình sống như một service thật
process.emit('SIGINT');
process.emit('SIGINT');
