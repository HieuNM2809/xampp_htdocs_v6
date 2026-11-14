// Ví dụ 4: chụp màn hình: toàn trang, một element, che vùng dữ liệu động, đính kèm vào report,
// và so sánh hình ảnh (visual regression).
// Chạy: npm run test:04             ảnh lưu vào thư mục screenshots/<trình duyệt>/
//       npm run test:visual:update  lần đầu: tạo ảnh chuẩn cho nhóm @visual
//       npm run test:visual         các lần sau: so với ảnh chuẩn
import path from 'node:path';
import { test, expect } from '@playwright/test';

// Mỗi trình duyệt (project) một thư mục con để các test chạy song song không ghi đè ảnh của nhau
function shotPath(projectName: string, fileName: string) {
  return path.join(__dirname, '..', 'screenshots', projectName, fileName);
}

test('chụp toàn trang (fullPage)', async ({ page }, testInfo) => {
  await page.goto('/products');
  // Chờ dữ liệu hiện đủ rồi mới chụp, nếu không sẽ chụp phải trạng thái "Đang tải..."
  await expect(page.getByRole('listitem')).toHaveCount(8);
  await page.screenshot({ path: shotPath(testInfo.project.name, 'products-full.png'), fullPage: true });
});

test('chụp riêng một element', async ({ page }, testInfo) => {
  await page.goto('/products');
  // locator.screenshot tự chờ element xuất hiện và cuộn tới nó
  const card = page.getByRole('listitem').filter({ hasText: 'Serum vitamin C' });
  await card.screenshot({ path: shotPath(testInfo.project.name, 'serum-card.png') });
});

test('che vùng thay đổi mỗi lần tải bằng mask', async ({ page }, testInfo) => {
  await page.goto('/');
  // Giờ mở trang khác nhau mỗi lần: phủ một khối màu lên để ảnh không đổi giữa các lần chạy
  await page.screenshot({
    path: shotPath(testInfo.project.name, 'home-masked.png'),
    mask: [page.getByTestId('visit-time')],
    maskColor: '#ff00ff',
  });
});

test('đính kèm ảnh vào HTML report', async ({ page }, testInfo) => {
  await page.goto('/contact');
  await page.getByRole('button', { name: 'Gửi liên hệ' }).click();
  await expect(page.getByText('Vui lòng nhập họ và tên')).toBeVisible();
  // Không ghi ra file mà đính kèm vào report: xem bằng "npm run report"
  await testInfo.attach('form-bao-loi', { body: await page.screenshot(), contentType: 'image/png' });
});

// Tag @visual: "npm test" bỏ qua nhóm này vì ảnh chuẩn phụ thuộc hệ điều hành, font và trình duyệt của từng máy
test.describe('So sánh hình ảnh', { tag: '@visual' }, () => {
  test('trang chủ giữ nguyên giao diện', async ({ page }) => {
    await page.goto('/');
    // Lần đầu (--update-snapshots) Playwright lưu ảnh chuẩn, các lần sau so từng pixel với ảnh đó
    await expect(page).toHaveScreenshot('home.png', {
      fullPage: true,
      mask: [page.getByTestId('visit-time')],
    });
  });

  test('thẻ sản phẩm giữ nguyên giao diện', async ({ page }) => {
    await page.goto('/products');
    const card = page.getByRole('listitem').filter({ hasText: 'Serum vitamin C' });
    await expect(card).toHaveScreenshot('serum-card.png');
  });
});
