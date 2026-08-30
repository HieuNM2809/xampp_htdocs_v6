const { Given, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert');

// `this.cart` được khởi tạo trong features/support/world.js

Given('giỏ hàng đang trống', function () {
  assert.strictEqual(this.cart.count, 0);
});

// "thêm" (When) và "đã thêm" (Given) là hai câu khác nhau -> hai step riêng biệt
When('tôi thêm sản phẩm {string} giá {int} vào giỏ', function (name, price) {
  this.cart.addItem(name, price);
});

Given('tôi đã thêm sản phẩm {string} giá {int} vào giỏ', function (name, price) {
  this.cart.addItem(name, price);
});

When('tôi thêm các sản phẩm sau:', function (dataTable) {
  // dataTable.hashes() -> mảng object dùng dòng đầu làm khóa
  for (const row of dataTable.hashes()) {
    this.cart.addItem(
      row['tên sản phẩm'],
      Number(row['giá']),
      Number(row['số lượng']),
    );
  }
});

When('tôi áp dụng giảm giá {int} phần trăm', function (percent) {
  this.finalTotal = this.cart.applyDiscount(percent);
});

When('tôi xóa sản phẩm {string} khỏi giỏ', function (name) {
  this.cart.removeItem(name);
});

Then('giỏ hàng có {int} sản phẩm', function (count) {
  assert.strictEqual(this.cart.count, count);
});

Then('tổng tiền là {int}', function (total) {
  assert.strictEqual(this.cart.total, total);
});

Then('số tiền phải trả là {int}', function (amount) {
  assert.strictEqual(this.finalTotal, amount);
});
