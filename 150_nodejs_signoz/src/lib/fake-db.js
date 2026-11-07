'use strict';

/**
 * PostgreSQL và Redis GIẢ LẬP, chạy hoàn toàn trong bộ nhớ.
 *
 * Mục đích: trace có thêm các span "gọi database / cache" mà không phải dựng PostgreSQL và Redis thật.
 * Mỗi thao tác tạo một span kind=CLIENT kèm các thuộc tính theo semantic conventions cho database
 * (db.system, db.name, db.operation, db.statement...). SigNoz dựa vào span có db.system để vẽ
 * mục "Database Calls" trên trang của service.
 *
 * Với database thật (pg, mysql2, mongodb, ioredis...), auto-instrumentation sinh ra span y hệt thế này
 * mà không cần viết dòng nào. Cách viết tay ở đây cũng chính là cách instrument một thư viện
 * chưa có instrumentation sẵn.
 */

const { SpanKind } = require('@opentelemetry/api');
const { logger } = require('./logger');
const { meter, withSpan } = require('./telemetry');
const { sleep, randomInt } = require('./utils');

// Một phần nhỏ truy vấn chậm bất thường (200–600 ms) để biểu đồ latency có "đuôi" p95/p99.
const SLOW_QUERY_RATE = 0.03;

const INITIAL_STOCK = {
  'p-1001': 5000,
  'p-1002': 5000,
  'p-1003': 5000,
  'p-1004': 5000,
  // Cố ý để tồn kho thấp: đặt vài đơn là hết hàng → thấy response 409 trên SigNoz.
  'p-1005': 25,
};

const products = new Map(
  [
    { id: 'p-1001', name: 'Sữa rửa mặt CeraVe sạch sâu 473ml', price: 385_000 },
    { id: 'p-1002', name: 'Kem chống nắng La Roche-Posay Anthelios 50ml', price: 495_000 },
    { id: 'p-1003', name: 'Serum The Ordinary Niacinamide 10% 30ml', price: 289_000 },
    { id: 'p-1004', name: 'Nước tẩy trang Bioderma Sensibio H2O 500ml', price: 435_000 },
    { id: 'p-1005', name: 'Toner Klairs Supple Preparation 180ml (hàng giới hạn)', price: 329_000 },
  ].map((p) => [p.id, { ...p, stock: INITIAL_STOCK[p.id] }])
);

const orders = new Map();
const MAX_ORDERS_IN_MEMORY = 10_000;
let orderSeq = 0;

const cache = new Map(); // key → { value, expiresAt }

// ---------------------------------------------------------------------------------------------
// Hai hàm tạo span: một cho SQL (PostgreSQL), một cho lệnh cache (Redis).
// ---------------------------------------------------------------------------------------------

/** Chạy `fn` như một câu SQL gửi tới PostgreSQL: có span, có độ trễ mạng + truy vấn. */
function sql(operation, table, statement, fn) {
  return withSpan(
    // Tên span theo quy ước "<thao tác> <database>.<bảng>": ít giá trị khác nhau, dễ gom nhóm.
    `${operation} shop.${table}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'postgresql',
        'db.name': 'shop',
        'db.user': 'shop_app',
        'db.operation': operation,
        'db.sql.table': table,
        // Câu SQL có tham số $1, $2... chứ không nhét giá trị thật: tránh lộ dữ liệu và tránh
        // mỗi giá trị một chuỗi khác nhau.
        'db.statement': statement,
        'server.address': 'postgres',
        'server.port': 5432,
      },
    },
    async (span) => {
      const slow = Math.random() < SLOW_QUERY_RATE;
      if (slow) span.setAttribute('app.db.slow_query', true);
      await sleep(slow ? randomInt(200, 600) : randomInt(3, 25));
      return fn(span);
    }
  );
}

/** Chạy `fn` như một lệnh Redis. */
function redis(command, key, fn) {
  return withSpan(
    `redis ${command}`,
    {
      kind: SpanKind.CLIENT,
      attributes: {
        'db.system': 'redis',
        'db.operation': command,
        'db.statement': `${command} ${key}`,
        'server.address': 'redis',
        'server.port': 6379,
      },
    },
    async (span) => {
      await sleep(randomInt(1, 3));
      return fn(span);
    }
  );
}

async function cacheGet(key) {
  return redis('GET', key, (span) => {
    const entry = cache.get(key);
    const hit = entry !== undefined && entry.expiresAt > Date.now();
    // Thuộc tính tự đặt để lọc trên SigNoz: app.cache.hit = false → các trace phải xuống DB.
    span.setAttribute('app.cache.hit', hit);
    return hit ? entry.value : null;
  });
}

async function cacheSet(key, value, ttlMs) {
  return redis('SET', key, () => {
    cache.set(key, { value, expiresAt: Date.now() + ttlMs });
  });
}

// ---------------------------------------------------------------------------------------------
// Các thao tác dữ liệu mà route dùng.
// ---------------------------------------------------------------------------------------------

/** Danh sách sản phẩm: đọc cache trước; miss thì query DB rồi ghi lại cache 5 giây. */
async function listProducts() {
  const cached = await cacheGet('products:all');
  if (cached) return cached;

  const rows = await sql('SELECT', 'products', 'SELECT id, name, price, stock FROM products ORDER BY id', (span) => {
    span.setAttribute('db.response.returned_rows', products.size);
    return [...products.values()].map((p) => ({ ...p }));
  });
  await cacheSet('products:all', rows, 5_000);
  return rows;
}

async function findProduct(id) {
  return sql('SELECT', 'products', 'SELECT id, name, price, stock FROM products WHERE id = $1', (span) => {
    const product = products.get(id);
    span.setAttribute('db.response.returned_rows', product ? 1 : 0);
    return product ? { ...product } : null;
  });
}

/** Trừ kho có điều kiện, như UPDATE ... WHERE stock >= $1. Trả về false nếu không đủ hàng. */
async function reserveStock(productId, quantity) {
  return sql(
    'UPDATE',
    'products',
    'UPDATE products SET stock = stock - $1 WHERE id = $2 AND stock >= $1',
    (span) => {
      const product = products.get(productId);
      const ok = Boolean(product && product.stock >= quantity);
      if (ok) product.stock -= quantity;
      span.setAttribute('app.db.rows_affected', ok ? 1 : 0);
      return ok;
    }
  );
}

/** Trả hàng lại kho khi thanh toán thất bại (bước bù trừ). */
async function releaseStock(productId, quantity) {
  return sql('UPDATE', 'products', 'UPDATE products SET stock = stock + $1 WHERE id = $2', () => {
    const product = products.get(productId);
    if (product) product.stock += quantity;
  });
}

async function insertOrder({ productId, quantity, customerId, amount }) {
  return sql(
    'INSERT',
    'orders',
    'INSERT INTO orders (id, product_id, quantity, customer_id, amount, status) VALUES ($1, $2, $3, $4, $5, $6)',
    () => {
      orderSeq += 1;
      const order = {
        id: `ORD-${String(orderSeq).padStart(6, '0')}`,
        productId,
        quantity,
        customerId,
        amount,
        status: 'PENDING_PAYMENT',
        createdAt: new Date().toISOString(),
      };
      orders.set(order.id, order);
      // Demo chạy lâu cũng không phình RAM: chỉ giữ các đơn gần nhất.
      if (orders.size > MAX_ORDERS_IN_MEMORY) orders.delete(orders.keys().next().value);
      return { ...order };
    }
  );
}

async function updateOrderStatus(orderId, status, extra = {}) {
  return sql('UPDATE', 'orders', 'UPDATE orders SET status = $1, payment_id = $2 WHERE id = $3', () => {
    const order = orders.get(orderId);
    if (!order) return null;
    Object.assign(order, extra, { status, updatedAt: new Date().toISOString() });
    return { ...order };
  });
}

async function findOrder(id) {
  return sql('SELECT', 'orders', 'SELECT * FROM orders WHERE id = $1', (span) => {
    const order = orders.get(id);
    span.setAttribute('db.response.returned_rows', order ? 1 : 0);
    return order ? { ...order } : null;
  });
}

/** Truy vấn báo cáo LUÔN bị timeout, dùng cho GET /api/error?type=db. */
async function runBrokenReportQuery() {
  return sql(
    'SELECT',
    'order_reports',
    "SELECT product_id, sum(amount) FROM orders WHERE created_at > now() - interval '90 days' GROUP BY product_id",
    async (span) => {
      await sleep(randomInt(150, 300));
      // Đúng thông báo và mã lỗi (SQLSTATE 57014) mà PostgreSQL thật trả về khi quá statement_timeout.
      span.setAttribute('db.response.status_code', '57014');
      const err = new Error('canceling statement due to statement timeout');
      err.code = '57014';
      throw err;
    }
  );
}

/** Truy vấn tổng hợp chậm (0,3–1,2 giây), dùng cho GET /api/slow. */
async function runSlowAggregateQuery() {
  return sql(
    'SELECT',
    'orders',
    'SELECT product_id, count(*), sum(amount) FROM orders GROUP BY product_id',
    async () => {
      await sleep(randomInt(300, 1200));
      return [...products.values()].map((p) => ({ productId: p.id, sold: INITIAL_STOCK[p.id] - p.stock }));
    }
  );
}

// ---------------------------------------------------------------------------------------------
// Job chạy nền: mỗi phút nhập thêm hàng cho sản phẩm sắp hết.
// Không có request HTTP nào, nên job tự mở span gốc (root span) của riêng nó: trên SigNoz sẽ thấy
// trace "inventory.restock" xuất hiện đều đặn, kể cả khi không có ai gọi API.
// ---------------------------------------------------------------------------------------------
setInterval(() => {
  withSpan('inventory.restock', async (span) => {
    const lowStock = [...products.values()].filter((p) => p.stock < 10);
    span.setAttribute('app.restock.products', lowStock.length);
    for (const product of lowStock) {
      await sql('UPDATE', 'products', 'UPDATE products SET stock = $1 WHERE id = $2', () => {
        product.stock = INITIAL_STOCK[product.id];
      });
      logger.info({ productId: product.id, stock: product.stock }, 'Đã nhập thêm hàng');
    }
  }).catch((err) => logger.error({ err }, 'Job nhập hàng bị lỗi'));
}, 60_000).unref(); // unref(): job này không giữ process sống khi app đang tắt

// Metric bất đồng bộ (observable gauge): SDK tự gọi callback mỗi lần xuất metric (15 giây một lần)
// để đọc tồn kho hiện tại, thay vì app phải chủ động ghi mỗi khi kho thay đổi.
meter
  .createObservableGauge('shop.product.stock', {
    description: 'Tồn kho hiện tại của từng sản phẩm',
    unit: '{item}',
  })
  .addCallback((result) => {
    for (const product of products.values()) {
      result.observe(product.stock, { 'product.id': product.id });
    }
  });

module.exports = {
  listProducts,
  findProduct,
  reserveStock,
  releaseStock,
  insertOrder,
  updateOrderStatus,
  findOrder,
  runBrokenReportQuery,
  runSlowAggregateQuery,
};
