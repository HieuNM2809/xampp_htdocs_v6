'use strict';

/**
 * GET /api/products       danh sách sản phẩm: cache (Redis giả lập) → miss thì PostgreSQL giả lập
 * GET /api/products/:id   chi tiết một sản phẩm, 404 nếu không có
 */

const express = require('express');
const db = require('../lib/fake-db');

const router = express.Router();

router.get('/', async (req, res) => {
  const items = await db.listProducts();
  res.json({ count: items.length, items });
});

router.get('/:id', async (req, res) => {
  const product = await db.findProduct(req.params.id);
  if (!product) {
    // 404 là kết quả bình thường, trả thẳng về thay vì ném lỗi: instrumentation-http KHÔNG đánh dấu
    // span là lỗi với mã 4xx, nên tỉ lệ lỗi trên SigNoz chỉ phản ánh sự cố thật (5xx).
    return res.status(404).json({ error: `Không tìm thấy sản phẩm ${req.params.id}` });
  }
  res.json(product);
});

module.exports = router;
