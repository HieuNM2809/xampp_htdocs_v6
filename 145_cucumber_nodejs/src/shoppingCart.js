// Mã nguồn cần kiểm thử: giỏ hàng có trạng thái (stateful)
class ShoppingCart {
  constructor() {
    this.items = [];
  }

  // Thêm sản phẩm; nếu đã có thì cộng dồn số lượng
  addItem(name, price, quantity = 1) {
    const existing = this.items.find((item) => item.name === name);
    if (existing) {
      existing.quantity += quantity;
    } else {
      this.items.push({ name, price, quantity });
    }
  }

  removeItem(name) {
    this.items = this.items.filter((item) => item.name !== name);
  }

  // Tổng số lượng sản phẩm trong giỏ
  get count() {
    return this.items.reduce((sum, item) => sum + item.quantity, 0);
  }

  // Tổng tiền trước giảm giá
  get total() {
    return this.items.reduce((sum, item) => sum + item.price * item.quantity, 0);
  }

  // Số tiền phải trả sau khi giảm giá theo phần trăm
  applyDiscount(percent) {
    return this.total * (1 - percent / 100);
  }
}

module.exports = ShoppingCart;
