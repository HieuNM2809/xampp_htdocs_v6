'use strict';

const { money } = require('./util');

/**
 * In-memory store thay cho database thật.
 *
 * Lưu ý về mặt mô hình: trong hệ thống thật MỖI service có DB riêng, không ai
 * đọc bảng của ai. Ở đây gộp vào một object cho gọn, nhưng mỗi service chỉ
 * được truy cập "khoang" của mình (orders / products / payments / shipments).
 */
const db = {
  orders: new Map(),
  products: new Map(),
  wallets: new Map(),
  reservations: new Map(),
  payments: new Map(),
  shipments: new Map(),

  // Hạ tầng saga
  sagas: new Map(), // saga log: nguồn sự thật để recovery sau khi crash
  idempotency: new Map(), // key -> kết quả đã trả về trước đó
  deadLetters: [], // DLQ: việc không tự xử được, cần người/job can thiệp
};

const seq = new Map();

function nextId(prefix) {
  const n = (seq.get(prefix) || 0) + 1;
  seq.set(prefix, n);
  return `${prefix}-${String(n).padStart(4, '0')}`;
}

/** Nạp lại dữ liệu gốc trước mỗi scenario để các demo độc lập nhau. */
function reset(seed = {}) {
  db.orders.clear();
  db.products.clear();
  db.wallets.clear();
  db.reservations.clear();
  db.payments.clear();
  db.shipments.clear();
  db.sagas.clear();
  db.idempotency.clear();
  db.deadLetters.length = 0;
  seq.clear();

  const products = seed.products || [{ sku: 'IPHONE-15', name: 'iPhone 15', stock: 5, price: 26000000 }];
  for (const p of products) db.products.set(p.sku, { ...p });

  const wallets = seed.wallets || [{ customerId: 'CUS-01', balance: 100000000 }];
  for (const w of wallets) db.wallets.set(w.customerId, { ...w });
}

// ---------------------------------------------------------------------------
// Idempotency: chống tác dụng phụ bị áp dụng 2 lần khi retry / giao lại event
// ---------------------------------------------------------------------------

/**
 * Chạy `fn` đúng MỘT lần cho mỗi `key`. Lần gọi sau trả lại kết quả đã cache
 * và đánh dấu `replayed: true` để log nhìn thấy rõ.
 *
 * Đây là mô hình đơn giản hoá. Thực tế bảng idempotency phải nằm trong CÙNG
 * transaction với thay đổi nghiệp vụ, nếu không vẫn hở cửa sổ double-apply.
 */
async function runOnce(key, fn) {
  if (db.idempotency.has(key)) {
    return { value: db.idempotency.get(key), replayed: true };
  }
  const value = await fn();
  db.idempotency.set(key, value);
  return { value, replayed: false };
}

// ---------------------------------------------------------------------------
// Saga log
// ---------------------------------------------------------------------------

function saveSaga(saga) {
  db.sagas.set(saga.sagaId, { ...db.sagas.get(saga.sagaId), ...saga, updatedAt: Date.now() });
  return db.sagas.get(saga.sagaId);
}

const getSaga = (sagaId) => db.sagas.get(sagaId);

// ---------------------------------------------------------------------------
// Dead letter queue
// ---------------------------------------------------------------------------

function pushDeadLetter(entry) {
  const record = { ...entry, at: new Date().toISOString() };
  db.deadLetters.push(record);
  return record;
}

const deadLetters = () => db.deadLetters.slice();

/** Các dòng text mô tả trạng thái cuối, dùng để kiểm chứng rollback. */
function snapshot() {
  const lines = [];
  for (const o of db.orders.values()) {
    lines.push(`order ${o.id}: status=${o.status}${o.cancelReason ? ` reason="${o.cancelReason}"` : ''}`);
  }
  for (const p of db.products.values()) {
    lines.push(`stock ${p.sku}: ${p.stock}`);
  }
  for (const w of db.wallets.values()) {
    lines.push(`wallet ${w.customerId}: ${money(w.balance)}`);
  }
  if (db.payments.size === 0) {
    lines.push('payments: (chưa có bút toán nào)');
  } else {
    const list = [...db.payments.values()]
      .map((p) => `${p.id}/${p.type}/${money(p.amount)}`)
      .join(', ');
    lines.push(`payments: ${list}`);
  }
  for (const s of db.shipments.values()) {
    lines.push(`shipment ${s.id}: status=${s.status}`);
  }
  lines.push(`dead letters: ${db.deadLetters.length}`);
  return lines;
}

module.exports = {
  db,
  nextId,
  reset,
  runOnce,
  saveSaga,
  getSaga,
  pushDeadLetter,
  deadLetters,
  snapshot,
};
