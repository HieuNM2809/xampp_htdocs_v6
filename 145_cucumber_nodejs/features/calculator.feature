Feature: Máy tính (Calculator)
  Là một người dùng
  Tôi muốn thực hiện các phép tính cơ bản
  Để nhận được kết quả chính xác

  Scenario: Cộng hai số
    Given tôi có số 5 và số 3
    When tôi cộng chúng lại
    Then kết quả là 8

  Scenario Outline: Các phép tính cơ bản
    Given tôi có số <a> và số <b>
    When tôi thực hiện phép "<phép tính>"
    Then kết quả là <kết quả>

    Examples:
      | a  | b | phép tính | kết quả |
      | 5  | 3 | cộng      | 8       |
      | 10 | 4 | trừ       | 6       |
      | 6  | 7 | nhân      | 42      |
      | 20 | 5 | chia      | 4       |

  Scenario: Chia cho 0 sẽ báo lỗi
    Given tôi có số 10 và số 0
    When tôi thực hiện phép "chia"
    Then hệ thống báo lỗi "Không thể chia cho 0"
