Feature: Giỏ hàng (Shopping Cart)
  Là một khách hàng
  Tôi muốn thêm/xóa sản phẩm trong giỏ hàng
  Để có thể đặt mua sản phẩm mình cần

  Background:
    Given giỏ hàng đang trống

  Scenario: Thêm một sản phẩm vào giỏ
    When tôi thêm sản phẩm "Táo" giá 15000 vào giỏ
    Then giỏ hàng có 1 sản phẩm
    And tổng tiền là 15000

  Scenario: Thêm nhiều sản phẩm cùng lúc (Data Table)
    When tôi thêm các sản phẩm sau:
      | tên sản phẩm | giá   | số lượng |
      | Táo          | 15000 | 2        |
      | Cam          | 20000 | 3        |
      | Chuối        | 10000 | 1        |
    Then giỏ hàng có 6 sản phẩm
    And tổng tiền là 100000

  Scenario: Áp dụng mã giảm giá
    Given tôi đã thêm sản phẩm "Laptop" giá 20000000 vào giỏ
    When tôi áp dụng giảm giá 10 phần trăm
    Then số tiền phải trả là 18000000

  Scenario: Xóa sản phẩm khỏi giỏ
    Given tôi đã thêm sản phẩm "Táo" giá 15000 vào giỏ
    And tôi đã thêm sản phẩm "Cam" giá 20000 vào giỏ
    When tôi xóa sản phẩm "Táo" khỏi giỏ
    Then giỏ hàng có 1 sản phẩm
    And tổng tiền là 20000
