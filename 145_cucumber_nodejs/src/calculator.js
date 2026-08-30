// Mã nguồn cần kiểm thử: một máy tính đơn giản (code under test)
class Calculator {
  add(a, b) {
    return a + b;
  }

  subtract(a, b) {
    return a - b;
  }

  multiply(a, b) {
    return a * b;
  }

  divide(a, b) {
    if (b === 0) {
      throw new Error('Không thể chia cho 0');
    }
    return a / b;
  }
}

module.exports = Calculator;
