const { BeforeAll, Before, After, AfterAll } = require('@cucumber/cucumber');

// Chạy MỘT lần trước toàn bộ test
BeforeAll(function () {
  console.log('🥒 Bắt đầu chạy test Cucumber...');
});

// Chạy trước MỖI kịch bản (ví dụ: chuẩn bị dữ liệu, mở kết nối...)
Before(function () {
  // World đã tự tạo giỏ hàng mới, nên ở đây thường không cần làm gì.
});

// Chạy sau MỖI kịch bản (ví dụ: dọn dẹp, đóng kết nối...)
After(function (scenario) {
  // scenario.result.status: PASSED | FAILED | SKIPPED | ...
  if (scenario.result && scenario.result.status === 'FAILED') {
    console.log(`❌ Kịch bản thất bại: ${scenario.pickle.name}`);
  }
});

// Chạy MỘT lần sau toàn bộ test
AfterAll(function () {
  console.log('✅ Đã chạy xong toàn bộ test.');
});
