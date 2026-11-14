// Cấu hình Playwright Test. Tài liệu: https://playwright.dev/docs/test-configuration
import { defineConfig, devices } from '@playwright/test';

// Cổng của web app mẫu (src/server.js). Đặt biến môi trường PORT nếu cổng 3151 đã bị chiếm.
const PORT = Number(process.env.PORT) || 3151;
const BASE_URL = `http://localhost:${PORT}`;

export default defineConfig({
  testDir: './tests',
  // Chạy song song mọi test, kể cả các test trong cùng một file
  fullyParallel: true,
  // Trên CI: chặn test.only bị quên commit, thử lại test lỗi 2 lần, chạy tuần tự cho ổn định
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  // list: in kết quả ra terminal; html: báo cáo chi tiết, mở bằng "npm run report"
  reporter: [['list'], ['html', { open: 'never' }]],

  use: {
    // Cho phép viết page.goto('/products') thay vì URL đầy đủ
    baseURL: BASE_URL,
    // Chỉ giữ trace và ảnh chụp của test lỗi. Xem trace: npx playwright show-trace <file trace.zip>
    // Muốn có cả video thì thêm: video: 'retain-on-failure'
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Cố định ngôn ngữ và múi giờ để định dạng số, giờ giống nhau trên mọi máy
    locale: 'vi-VN',
    timezoneId: 'Asia/Ho_Chi_Minh',
  },

  // Mỗi project là một trình duyệt. Chạy riêng một cái: npx playwright test --project=chromium
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],

  // Tự bật web app mẫu trước khi chạy test và tắt khi xong.
  // Đang chạy sẵn "npm run serve" thì dùng lại server đó (trừ trên CI).
  webServer: {
    command: 'node src/server.js',
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: !process.env.CI,
    env: { PORT: String(PORT) },
  },
});
