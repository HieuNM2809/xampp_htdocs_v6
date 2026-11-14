// Ví dụ 1: mở trang, kiểm tra tiêu đề, heading và điều hướng qua menu.
// Chạy: npm run test:01
import { test, expect } from '@playwright/test';

test.describe('Trang chủ', () => {
  test.beforeEach(async ({ page }) => {
    // baseURL đặt trong playwright.config.ts nên chỉ cần đường dẫn tương đối
    await page.goto('/');
  });

  test('có tiêu đề đúng', async ({ page }) => {
    // toHaveTitle tự thử lại tới khi khớp (mặc định tối đa 5 giây).
    // Tránh viết expect(await page.title()).toBe(...): chỉ đọc đúng một lần, không chờ.
    await expect(page).toHaveTitle('Mini Shop — Playwright Demo');
  });

  test('hiển thị heading chính và nút xem sản phẩm', async ({ page }) => {
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Chào mừng đến Mini Shop');
    await expect(page.getByRole('link', { name: 'Xem sản phẩm' })).toHaveAttribute('href', '/products');
  });

  test('chuyển sang trang Sản phẩm qua menu', async ({ page }) => {
    // Trang còn link "Xem sản phẩm" cũng chứa chữ "sản phẩm" (getByRole so khớp một phần, không phân biệt hoa thường).
    // Giới hạn trong menu để locator chỉ khớp đúng một link; cách khác là thêm { exact: true }.
    const menu = page.getByRole('navigation', { name: 'Menu chính' });
    await menu.getByRole('link', { name: 'Sản phẩm' }).click();

    await expect(page).toHaveURL(/\/products$/);
    await expect(page).toHaveTitle('Sản phẩm — Mini Shop');
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sản phẩm');
    // Link của trang hiện tại được đánh dấu aria-current="page"
    await expect(menu.getByRole('link', { name: 'Sản phẩm' })).toHaveAttribute('aria-current', 'page');
  });
});

test('đường dẫn không tồn tại trả về trang 404', async ({ page }) => {
  // page.goto không ném lỗi với mã 4xx/5xx mà trả về response để tự kiểm tra
  const response = await page.goto('/khong-co-trang-nay');
  expect(response?.status()).toBe(404);
  await expect(page.getByRole('heading', { name: 'Không tìm thấy trang' })).toBeVisible();
});
