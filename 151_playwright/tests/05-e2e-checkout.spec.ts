// Ví dụ 5: test end-to-end: tìm sản phẩm → thêm vào giỏ → đổi số lượng → đặt hàng.
// test.step chia kịch bản thành từng bước, tên bước hiện trong terminal, HTML report và trace.
// Chạy: npm run test:05
import { test, expect, type Page } from '@playwright/test';

// Hàm phụ cho thao tác lặp lại. Dự án lớn hơn có thể gom vào Page Object.
async function addToCart(page: Page, productName: string) {
  const card = page.getByRole('listitem').filter({ hasText: productName });
  await card.getByRole('button', { name: 'Thêm vào giỏ' }).click();
}

test('khách mua hàng từ đầu đến cuối', async ({ page }) => {
  const cartLink = page.getByRole('link', { name: /^Giỏ hàng/ });
  const search = page.getByRole('searchbox', { name: 'Tìm sản phẩm' });

  await test.step('Từ trang chủ vào trang Sản phẩm', async () => {
    await page.goto('/');
    await page.getByRole('link', { name: 'Xem sản phẩm' }).click();
    await expect(page).toHaveURL(/\/products$/);
  });

  await test.step('Tìm và thêm hai sản phẩm vào giỏ', async () => {
    await search.fill('chống nắng');
    await expect(page.getByRole('listitem')).toHaveCount(2);
    await addToCart(page, 'Kem chống nắng SPF50+ 50ml');
    await expect(cartLink).toHaveText('Giỏ hàng (1)');

    // Click tự chờ thẻ "Serum" xuất hiện sau khi kết quả tìm kiếm mới về
    await search.fill('serum');
    await addToCart(page, 'Serum vitamin C 30ml');
    await expect(cartLink).toHaveText('Giỏ hàng (2)');
  });

  await test.step('Vào giỏ hàng, tăng số lượng, kiểm tra tổng tiền', async () => {
    await cartLink.click();
    await expect(page).toHaveURL(/\/cart$/);

    // Dòng có nút "Xoá" là dòng sản phẩm (bỏ qua dòng tiêu đề và dòng tổng cộng)
    const productRows = page.getByRole('row').filter({ has: page.getByRole('button', { name: /^Xoá/ }) });
    await expect(productRows).toHaveCount(2);

    const sunscreenRow = page.getByRole('row', { name: /Kem chống nắng/ });
    await sunscreenRow.getByRole('button', { name: /^Tăng số lượng/ }).click();
    await expect(sunscreenRow.getByTestId('quantity')).toHaveText('2');
    await expect(sunscreenRow).toContainText('658.000đ');
    await expect(page.getByTestId('cart-total')).toHaveText('1.117.000đ');
    await expect(cartLink).toHaveText('Giỏ hàng (3)');
  });

  await test.step('Điền thông tin giao hàng và đặt hàng', async () => {
    await page.getByLabel('Người nhận').fill('Trần Thị Bình');
    await page.getByLabel('Số điện thoại').fill('0912345678');
    await page.getByLabel('Địa chỉ giao hàng').fill('12 Nguyễn Huệ, Quận 1, TP.HCM');
    await page.getByRole('radio', { name: 'Chuyển khoản ngân hàng' }).check();

    const orderResponse = page.waitForResponse(
      (res) => res.url().endsWith('/api/orders') && res.request().method() === 'POST',
    );
    await page.getByRole('button', { name: 'Đặt hàng' }).click();
    const response = await orderResponse;

    expect(response.status()).toBe(201);
    // Kiểm tra luôn dữ liệu trình duyệt gửi lên server
    expect(response.request().postDataJSON()).toEqual({
      customer: { name: 'Trần Thị Bình', phone: '0912345678', address: '12 Nguyễn Huệ, Quận 1, TP.HCM' },
      paymentMethod: 'bank',
      items: [
        { id: 6, quantity: 2 },
        { id: 4, quantity: 1 },
      ],
    });
  });

  await test.step('Thấy xác nhận đơn hàng và giỏ hàng được làm trống', async () => {
    await expect(page.getByRole('heading', { name: 'Đặt hàng thành công' })).toBeVisible();
    // Mã đơn do server sinh ra, mỗi lần một khác: kiểm tra định dạng bằng regex
    await expect(page.getByTestId('order-id')).toHaveText(/^DH\d{6}$/);
    await expect(page.getByTestId('order-total')).toHaveText('1.117.000đ');
    await expect(cartLink).toHaveText('Giỏ hàng (0)');

    await page.reload();
    await expect(page.getByText('Giỏ hàng đang trống')).toBeVisible();
  });
});

test('xoá sản phẩm phải xác nhận qua hộp thoại', async ({ page }) => {
  await page.goto('/products');
  await addToCart(page, 'Toner cân bằng ẩm 200ml');
  await addToCart(page, 'Serum vitamin C 30ml');
  await page.getByRole('link', { name: /^Giỏ hàng/ }).click();

  const serumRow = page.getByRole('row', { name: /Serum vitamin C/ });
  const removeSerum = serumRow.getByRole('button', { name: /^Xoá/ });

  // Không xử lý dialog thì Playwright tự bấm "Huỷ" → sản phẩm vẫn còn
  await removeSerum.click();
  await expect(serumRow).toBeVisible();

  // Đăng ký xử lý dialog TRƯỚC khi click
  let dialogMessage = '';
  page.once('dialog', async (dialog) => {
    dialogMessage = dialog.message();
    await dialog.accept();
  });
  await removeSerum.click();

  await expect(serumRow).toHaveCount(0);
  expect(dialogMessage).toBe('Xoá Serum vitamin C 30ml khỏi giỏ hàng?');
  await expect(page.getByTestId('cart-total')).toHaveText('245.000đ');
});

test('giỏ hàng trống thì không hiện form đặt hàng', async ({ page }) => {
  await page.goto('/cart');
  await expect(page.getByText('Giỏ hàng đang trống')).toBeVisible();
  await expect(page.getByRole('form', { name: 'Thông tin giao hàng' })).toBeHidden();
  await page.getByRole('link', { name: 'Xem sản phẩm' }).click();
  await expect(page).toHaveURL(/\/products$/);
});
