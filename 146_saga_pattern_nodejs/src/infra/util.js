'use strict';

/** Ngủ `ms` milliseconds - dùng để mô phỏng độ trễ mạng giữa các service. */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Format số tiền VND cho log dễ đọc: 52000000 -> "52.000.000đ" */
const money = (n) => `${Number(n).toLocaleString('de-DE')}đ`;

/** Biến object thành chuỗi "k=v k=v" để in kèm mỗi bước. */
const kv = (obj) =>
  Object.entries(obj || {})
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`)
    .join(' ');

module.exports = { sleep, money, kv };
