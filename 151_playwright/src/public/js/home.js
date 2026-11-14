// Trang chủ: hiện giờ mở trang. Phần tử này đổi mỗi lần tải, dùng để minh hoạ `mask` khi chụp màn hình.
import './common.js';

const time = document.querySelector('[data-testid="visit-time"] time');
const now = new Date();
time.dateTime = now.toISOString();
time.textContent = now.toLocaleTimeString('vi-VN');
