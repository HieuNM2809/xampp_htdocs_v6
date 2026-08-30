// Cấu hình cho Cucumber.js (profile "default")
// Tài liệu: https://github.com/cucumber/cucumber-js/blob/main/docs/configuration.md
module.exports = {
  default: {
    // Nạp các file step definitions và support (CommonJS)
    require: ['features/**/*.js'],
    // Định dạng kết quả hiển thị ra terminal
    format: ['progress-bar', 'summary'],
    // Sinh code mẫu (snippet) dạng async/await khi thiếu step
    formatOptions: { snippetInterface: 'async-await' },
    // Không đặt "paths" ở đây: mặc định đã là features/**/*.feature.
    // Nếu đặt cứng, nó sẽ bị gộp với tham số dòng lệnh khiến các script
    // như test:calculator / test:cart chạy cả 2 feature thay vì chỉ 1.
  },
};
