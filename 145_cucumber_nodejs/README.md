# Ví dụ Cucumber.js với Node.js (BDD)

Dự án mẫu minh họa **BDD (Behavior-Driven Development)** bằng
[Cucumber.js](https://github.com/cucumber/cucumber-js). Bạn viết mô tả hành vi
bằng ngôn ngữ gần với tiếng người (Gherkin), sau đó ánh xạ mỗi câu sang một hàm
JavaScript (step definition).

## 1. Cài đặt

```bash
cd 145_cucumber_nodejs
npm install
```

## 2. Chạy test

```bash
npm test                 # chạy tất cả feature
npm run test:calculator  # chỉ chạy máy tính
npm run test:cart        # chỉ chạy giỏ hàng
npm run test:report      # xuất báo cáo ra cucumber-report.html
```

## 3. Cấu trúc thư mục

```
145_cucumber_nodejs/
├── cucumber.js                       # cấu hình Cucumber
├── package.json
├── src/                              # MÃ NGUỒN cần kiểm thử
│   ├── calculator.js
│   └── shoppingCart.js
└── features/                         # TEST viết bằng Gherkin
    ├── calculator.feature            # kịch bản máy tính
    ├── shopping_cart.feature         # kịch bản giỏ hàng
    ├── step_definitions/             # ánh xạ câu Gherkin -> code
    │   ├── calculator.steps.js
    │   └── shopping_cart.steps.js
    └── support/
        ├── world.js                  # World: ngữ cảnh riêng cho mỗi kịch bản
        └── hooks.js                  # Before/After hooks
```

## 4. Các khái niệm chính

| Khái niệm            | Ý nghĩa                                                        |
| -------------------- | ------------------------------------------------------------- |
| **Feature**          | Một tính năng cần kiểm thử                                     |
| **Scenario**         | Một kịch bản/trường hợp cụ thể                                 |
| **Given/When/Then**  | Điều kiện ban đầu / Hành động / Kết quả mong đợi               |
| **Background**       | Các bước lặp lại, chạy trước MỖI scenario                      |
| **Scenario Outline** | Một kịch bản chạy với nhiều bộ dữ liệu (bảng `Examples`)       |
| **Data Table**       | Bảng dữ liệu truyền vào một bước                               |
| **Step Definition**  | Hàm JS khớp với một câu Gherkin qua biểu thức `{int}`, `{string}` |
| **World** (`this`)   | Ngữ cảnh được tạo mới cho mỗi scenario để lưu trạng thái       |
| **Hooks**            | `BeforeAll`, `Before`, `After`, `AfterAll` để chuẩn bị/dọn dẹp |

## 5. Ví dụ một kịch bản (Gherkin)

```gherkin
Scenario: Cộng hai số
  Given tôi có số 5 và số 3
  When tôi cộng chúng lại
  Then kết quả là 8
```

Ánh xạ sang step definition:

```js
Given('tôi có số {int} và số {int}', function (a, b) {
  this.calculator = new Calculator();
  this.a = a;
  this.b = b;
});
```

> ⚠️ Dùng `function () {}` (không dùng arrow function) trong step/hook để
> truy cập được `this` — chính là **World**.

## 6. Mẹo: viết Gherkin bằng tiếng Việt hoàn toàn

Thêm dòng đầu tiên `# language: vi` vào file `.feature` để dùng từ khóa tiếng
Việt như `Tính năng`, `Kịch bản`, `Cho`, `Khi`, `Thì`, `Và`. Phần step
definition trong JS vẫn giữ nguyên `Given/When/Then`.
