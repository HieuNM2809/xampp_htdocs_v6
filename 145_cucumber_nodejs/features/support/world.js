const { setWorldConstructor, World } = require('@cucumber/cucumber');
const ShoppingCart = require('../../src/shoppingCart');

// World = ngữ cảnh (context) được tạo MỚI cho mỗi Scenario.
// Nhờ vậy các kịch bản độc lập, không dùng chung trạng thái.
class CustomWorld extends World {
  constructor(options) {
    super(options);
    this.cart = new ShoppingCart();
  }
}

setWorldConstructor(CustomWorld);
