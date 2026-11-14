// Ví dụ 3: locator (getByRole, filter, xâu chuỗi) và cách chờ element đúng cách, không dùng sleep.
// Trang Sản phẩm gọi API có độ trễ ~400ms và ô tìm kiếm có debounce 300ms, nên mọi thứ đều bất đồng bộ.
// Chạy: npm run test:03
import { test, expect, type Page } from '@playwright/test';

// Locator chỉ là "cách tìm", chưa truy vấn DOM. Mỗi lần dùng nó tìm lại từ đầu nên luôn thấy DOM mới nhất.
const productCards = (page: Page) => page.getByRole('list', { name: 'Danh sách sản phẩm' }).getByRole('listitem');

test.describe('Danh sách sản phẩm', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/products');
  });

  test('chờ danh sách tải xong bằng assertion, không dùng sleep', async ({ page }) => {
    // SAI:  await page.waitForTimeout(1000)  → thừa thời gian khi máy nhanh, vẫn lỗi khi máy chậm.
    // ĐÚNG: assertion tự thử lại tới khi đúng hoặc hết timeout (mặc định 5 giây).
    await expect(productCards(page)).toHaveCount(8);
    await expect(page.getByText('Hiển thị 8 sản phẩm')).toBeVisible();
    await expect(page.getByText('Đang tải sản phẩm...')).toBeHidden();
  });

  test('lọc theo nội dung rồi xâu chuỗi xuống phần tử con', async ({ page }) => {
    // Thẻ nào cũng có nút "Thêm vào giỏ": chọn đúng thẻ trước, rồi mới tìm nút bên trong thẻ đó
    const sunscreen = productCards(page).filter({ hasText: 'Kem chống nắng SPF50+' });
    await expect(sunscreen.getByText('329.000đ')).toBeVisible();
    await sunscreen.getByRole('button', { name: 'Thêm vào giỏ' }).click();

    // Thông báo hiện ra rồi tự ẩn sau 2 giây: toBeHidden() tự chờ tới lúc đó
    const toast = page.getByRole('status');
    await expect(toast).toHaveText('Đã thêm Kem chống nắng SPF50+ 50ml vào giỏ');
    await expect(toast).toBeHidden();
    await expect(page.getByRole('link', { name: /Giỏ hàng/ })).toHaveText('Giỏ hàng (1)');
  });

  test('lọc theo phần tử con với { has } và kiểm tra nút bị vô hiệu hoá', async ({ page }) => {
    const clayMask = productCards(page).filter({ has: page.getByRole('heading', { name: 'Mặt nạ đất sét' }) });
    await expect(clayMask.getByRole('button')).toHaveText('Hết hàng');
    await expect(clayMask.getByRole('button')).toBeDisabled();
  });

  test('tìm kiếm có debounce: kiểm tra nội dung mới, kể cả khi gõ không dấu', async ({ page }) => {
    const search = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });
    const titles = productCards(page).getByRole('heading');

    await search.fill('kem');
    // Truyền mảng cho toHaveText: kiểm tra cả số lượng, thứ tự lẫn nội dung từng thẻ
    await expect(titles).toHaveText(['Kem dưỡng ẩm phục hồi 50ml', 'Kem chống nắng SPF50+ 50ml']);
    await expect(page).toHaveURL(/\?q=kem$/);

    // Kết quả mới cũng có 2 thẻ: chỉ kiểm tra toHaveCount(2) sẽ pass ngay với danh sách CŨ.
    // Luôn kiểm tra phần nội dung thay đổi.
    await search.fill('chong nang');
    await expect(titles).toHaveText(['Kem chống nắng SPF50+ 50ml', 'Xịt chống nắng SPF50 150ml']);

    await search.fill('khong co san pham nay');
    await expect(productCards(page)).toHaveCount(0);
    await expect(page.getByText('Không tìm thấy sản phẩm phù hợp')).toBeVisible();
  });

  test('chờ response của API bằng waitForResponse', async ({ page }) => {
    // Đăng ký chờ TRƯỚC hành động gây ra request, nếu không có thể bỏ lỡ response
    const responsePromise = page.waitForResponse(
      (res) =>
        res.url().includes('/api/products') && new URL(res.url()).searchParams.get('category') === 'Chống nắng',
    );
    await page.getByLabel('Danh mục').selectOption('Chống nắng');
    const response = await responsePromise;

    expect(response.status()).toBe(200);
    const body = await response.json();
    expect(body.total).toBe(2);
    await expect(productCards(page)).toHaveCount(body.total);
  });

  test('chờ trạng thái nằm ngoài DOM bằng expect.poll', async ({ page }) => {
    await productCards(page).filter({ hasText: 'Toner' }).getByRole('button', { name: 'Thêm vào giỏ' }).click();
    // localStorage không phải element nên không dùng toHaveText được: expect.poll gọi lại hàm tới khi khớp
    await expect
      .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mini-shop-cart') ?? '[]')))
      .toEqual([{ id: 3, name: 'Toner cân bằng ẩm 200ml', price: 245000, quantity: 1 }]);
  });
});

test.describe('Giả lập API bằng page.route', () => {
  test('API lỗi: hiện thông báo, bấm "Thử lại" thì tải được', async ({ page }) => {
    // Chặn request tới API và trả về lỗi 500. Phải đăng ký TRƯỚC khi mở trang.
    await page.route('**/api/products*', (route) => route.fulfill({ status: 500, json: { error: 'Lỗi giả lập' } }));
    await page.goto('/products');

    const alert = page.getByRole('alert');
    await expect(alert).toContainText('Không tải được danh sách sản phẩm');
    await expect(productCards(page)).toHaveCount(0);

    // Gỡ route để request tiếp theo đi tới server thật
    await page.unroute('**/api/products*');
    await alert.getByRole('button', { name: 'Thử lại' }).click();
    await expect(alert).toBeHidden();
    await expect(productCards(page)).toHaveCount(8);
  });

  test('trả dữ liệu giả để kiểm tra giao diện với dữ liệu tuỳ ý', async ({ page }) => {
    await page.route('**/api/products*', (route) =>
      route.fulfill({
        json: { items: [{ id: 99, name: 'Sản phẩm giả lập', category: 'Test', price: 1000, inStock: true }], total: 1 },
      }),
    );
    await page.goto('/products');
    await expect(productCards(page)).toHaveCount(1);
    await expect(productCards(page)).toContainText(['Sản phẩm giả lập']);
    await expect(productCards(page).getByText('1.000đ')).toBeVisible();
  });
});
