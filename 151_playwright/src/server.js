// Web app mẫu "Mini Shop": đối tượng để test Playwright và Claude (qua Playwright MCP) thao tác.
// Chỉ dùng module có sẵn của Node, không cần cài thêm gì. Dữ liệu nằm trong bộ nhớ.
// Chạy: npm run serve   → http://localhost:3151 (đổi cổng bằng biến môi trường PORT)
'use strict';

const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');

const PORT = Number(process.env.PORT) || 3151;
// Giả lập mạng chậm để thấy rõ auto-waiting của Playwright. Đặt API_DELAY_MS=0 để tắt.
const API_DELAY_MS = Number(process.env.API_DELAY_MS ?? 400);
const PUBLIC_DIR = path.join(__dirname, 'public');

const PRODUCTS = [
  { id: 1, name: 'Sữa rửa mặt dịu nhẹ 236ml', category: 'Làm sạch', price: 285000, inStock: true },
  { id: 2, name: 'Nước tẩy trang micellar 400ml', category: 'Làm sạch', price: 189000, inStock: true },
  { id: 3, name: 'Toner cân bằng ẩm 200ml', category: 'Dưỡng da', price: 245000, inStock: true },
  { id: 4, name: 'Serum vitamin C 30ml', category: 'Dưỡng da', price: 459000, inStock: true },
  { id: 5, name: 'Kem dưỡng ẩm phục hồi 50ml', category: 'Dưỡng da', price: 365000, inStock: true },
  { id: 6, name: 'Kem chống nắng SPF50+ 50ml', category: 'Chống nắng', price: 329000, inStock: true },
  { id: 7, name: 'Xịt chống nắng SPF50 150ml', category: 'Chống nắng', price: 299000, inStock: true },
  { id: 8, name: 'Mặt nạ đất sét 100g', category: 'Mặt nạ', price: 210000, inStock: false },
];

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
};

let lastOrderNumber = 0;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value) => (typeof value === 'string' ? value.trim() : '');
const httpError = (status, message) => Object.assign(new Error(message), { status, expose: true });

// Bỏ dấu tiếng Việt để gõ "kem chong nang" vẫn ra "Kem chống nắng".
function normalize(value) {
  return value
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/đ/g, 'd')
    .trim();
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 100_000) throw httpError(413, 'Dữ liệu gửi lên quá lớn');
  }
  try {
    return JSON.parse(raw || '{}');
  } catch {
    throw httpError(400, 'Body không phải JSON hợp lệ');
  }
}

// GET /api/products?q=kem&category=Dưỡng da
async function listProducts(url) {
  await sleep(API_DELAY_MS);
  const q = normalize(url.searchParams.get('q') ?? '');
  const category = url.searchParams.get('category') ?? '';
  const items = PRODUCTS.filter(
    (p) => (!q || normalize(p.name).includes(q)) && (!category || p.category === category),
  );
  return [200, { items, total: items.length }];
}

// POST /api/contact: chỉ kiểm tra lại trường bắt buộc, không lưu ở đâu cả.
async function createContact(body) {
  await sleep(API_DELAY_MS);
  if (!text(body.name) || !text(body.email).includes('@') || text(body.message).length < 10) {
    return [400, { error: 'Thiếu thông tin bắt buộc' }];
  }
  return [200, { ok: true }];
}

// POST /api/orders: tính lại tổng tiền theo giá trên server, không tin giá client gửi lên.
async function createOrder(body) {
  await sleep(API_DELAY_MS);
  const customer = body.customer ?? {};
  if (!text(customer.name) || !/^0\d{9}$/.test(text(customer.phone)) || !text(customer.address)) {
    return [400, { error: 'Thông tin giao hàng chưa hợp lệ' }];
  }
  if (!Array.isArray(body.items) || body.items.length === 0) {
    return [400, { error: 'Giỏ hàng đang trống' }];
  }

  let total = 0;
  for (const { id, quantity } of body.items) {
    const product = PRODUCTS.find((p) => p.id === id);
    if (!product?.inStock) return [400, { error: `Sản phẩm #${id} không còn bán` }];
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 10) {
      return [400, { error: 'Số lượng không hợp lệ' }];
    }
    total += product.price * quantity;
  }

  lastOrderNumber += 1;
  return [201, { orderId: `DH${String(lastOrderNumber).padStart(6, '0')}`, total }];
}

const API_ROUTES = {
  'GET /api/health': async () => [200, { status: 'ok' }],
  'GET /api/products': (req, url) => listProducts(url),
  'POST /api/contact': async (req) => createContact(await readJson(req)),
  'POST /api/orders': async (req) => createOrder(await readJson(req)),
};

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function sendFile(res, status, filePath) {
  const content = await fs.readFile(filePath);
  res.writeHead(status, {
    'Content-Type': MIME_TYPES[path.extname(filePath)] ?? 'application/octet-stream',
    'Cache-Control': 'no-store',
  });
  res.end(content);
}

// "/" → index.html, "/products" → products.html, "/js/cart.js" → giữ nguyên
async function serveStatic(pathname, res) {
  let relative = pathname === '/' ? '/index.html' : pathname;
  if (!path.extname(relative)) relative += '.html';
  const filePath = path.join(PUBLIC_DIR, relative);

  // path.join đã gộp các đoạn "..", kiểm tra thêm để chắc chắn không đọc ra ngoài public/
  if (filePath.startsWith(PUBLIC_DIR + path.sep)) {
    try {
      return await sendFile(res, 200, filePath);
    } catch (error) {
      if (error.code !== 'ENOENT' && error.code !== 'EISDIR') throw error;
    }
  }
  await sendFile(res, 404, path.join(PUBLIC_DIR, '404.html'));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  try {
    const route = API_ROUTES[`${req.method} ${url.pathname}`];
    if (route) {
      const [status, body] = await route(req, url);
      return sendJson(res, status, body);
    }
    if (url.pathname.startsWith('/api/')) return sendJson(res, 404, { error: 'Không có API này' });
    if (req.method !== 'GET' && req.method !== 'HEAD') return sendJson(res, 405, { error: 'Method không hỗ trợ' });
    await serveStatic(url.pathname, res);
  } catch (error) {
    if (!error.expose) console.error(error);
    sendJson(res, error.status ?? 500, { error: error.expose ? error.message : 'Lỗi máy chủ' });
  }
});

server.on('error', (error) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Cổng ${PORT} đang bị chiếm. Tắt tiến trình đang dùng cổng này hoặc đặt biến PORT sang cổng khác.`);
    process.exit(1);
  }
  throw error;
});

server.listen(PORT, () => {
  console.log(`Mini Shop: http://localhost:${PORT}   (độ trễ API ${API_DELAY_MS}ms, Ctrl+C để dừng)`);
});

// Tắt gọn khi bấm Ctrl+C hoặc khi Playwright dừng webServer sau khi chạy test xong
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
    server.closeAllConnections();
  });
}
