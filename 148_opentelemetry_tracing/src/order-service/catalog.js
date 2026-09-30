'use strict';

/** Danh mục sản phẩm trong bộ nhớ, thay cho database để ví dụ tập trung vào tracing. */
const PRODUCTS = new Map([
  ['SERUM-01', { sku: 'SERUM-01', name: 'Serum vitamin C', price: 350000, stock: 50 }],
  ['TONER-02', { sku: 'TONER-02', name: 'Toner hoa hồng', price: 180000, stock: 30 }],
  ['MASK-03', { sku: 'MASK-03', name: 'Mặt nạ đất sét', price: 120000, stock: 100 }],
]);

/** @returns {{ sku: string, name: string, price: number, stock: number } | undefined} */
function findProduct(sku) {
  return PRODUCTS.get(sku);
}

module.exports = { findProduct };
