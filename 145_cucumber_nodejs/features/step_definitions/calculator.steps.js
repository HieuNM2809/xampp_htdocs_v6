const { Given, When, Then } = require('@cucumber/cucumber');
const assert = require('node:assert');
const Calculator = require('../../src/calculator');

// Lưu ý: dùng function() thường (KHÔNG dùng arrow function)
// để truy cập được `this` (World) — nơi lưu trạng thái của mỗi kịch bản.

Given('tôi có số {int} và số {int}', function (a, b) {
  this.calculator = new Calculator();
  this.a = a;
  this.b = b;
});

When('tôi cộng chúng lại', function () {
  this.result = this.calculator.add(this.a, this.b);
});

When('tôi thực hiện phép {string}', function (operation) {
  const map = {
    'cộng': 'add',
    'trừ': 'subtract',
    'nhân': 'multiply',
    'chia': 'divide',
  };
  try {
    this.result = this.calculator[map[operation]](this.a, this.b);
  } catch (err) {
    this.error = err;
  }
});

Then('kết quả là {int}', function (expected) {
  assert.strictEqual(this.result, expected);
});

Then('hệ thống báo lỗi {string}', function (message) {
  assert.ok(this.error, 'Mong đợi có lỗi nhưng lại không có');
  assert.strictEqual(this.error.message, message);
});
