// Ví dụ 2: tương tác với form: điền ô nhập, chọn dropdown, radio, checkbox, gửi và kiểm tra lỗi.
// Chạy: npm run test:02
import { test, expect } from '@playwright/test';

test.describe('Form liên hệ', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/contact');
  });

  test('gửi thành công khi điền đủ thông tin', async ({ page }) => {
    // getByLabel tìm ô nhập qua <label>, đúng như cách người dùng nhìn form
    await page.getByLabel('Họ và tên').fill('Nguyễn Văn An');
    // Radio "Email" cũng có nhãn "Email" → getByLabel('Email') khớp 2 phần tử và báo lỗi strict mode.
    // Thêm role để chỉ lấy ô nhập văn bản.
    await page.getByRole('textbox', { name: 'Email' }).fill('an.nguyen@example.com');
    await page.getByLabel('Số điện thoại').fill('0901234567');
    // selectOption nhận value hoặc nhãn hiển thị của <option>
    await page.getByLabel('Chủ đề').selectOption({ label: 'Tư vấn sản phẩm' });
    await page.getByRole('radio', { name: 'Điện thoại' }).check();
    await page.getByLabel('Nội dung').fill('Da dầu nên dùng kem chống nắng nào?');
    await page.getByRole('checkbox', { name: 'Tôi đồng ý' }).check();

    // Kiểm tra trạng thái các ô trước khi gửi
    await expect(page.getByLabel('Chủ đề')).toHaveValue('product');
    await expect(page.getByRole('radio', { name: 'Điện thoại' })).toBeChecked();
    await expect(page.getByRole('radio', { name: 'Email' })).not.toBeChecked();

    await page.getByRole('button', { name: 'Gửi liên hệ' }).click();

    // API trả lời sau ~400ms. Assertion tự chờ nên không cần sleep.
    await expect(page.getByRole('status')).toContainText('Cảm ơn Nguyễn Văn An!');
    await expect(page.getByRole('form', { name: 'Form liên hệ' })).toBeHidden();
  });

  test('báo lỗi khi bỏ trống các trường bắt buộc', async ({ page }) => {
    await page.getByRole('button', { name: 'Gửi liên hệ' }).click();

    const name = page.getByLabel('Họ và tên');
    await expect(name).toHaveAttribute('aria-invalid', 'true');
    // Thông báo lỗi gắn với ô qua aria-describedby nên đọc được bằng "accessible description"
    await expect(name).toHaveAccessibleDescription('Vui lòng nhập họ và tên');
    await expect(page.getByText('Vui lòng nhập email')).toBeVisible();
    await expect(page.getByText('Vui lòng chọn chủ đề')).toBeVisible();
    await expect(page.getByText('Nội dung cần ít nhất 10 ký tự')).toBeVisible();
    await expect(page.getByText('Bạn cần đồng ý trước khi gửi')).toBeVisible();
    // Ô lỗi đầu tiên được focus để người dùng sửa ngay
    await expect(name).toBeFocused();
    // Liên hệ qua email (mặc định) thì số điện thoại không bắt buộc
    await expect(page.getByLabel('Số điện thoại')).not.toHaveAttribute('aria-invalid');
  });

  test('báo lỗi email sai định dạng và ẩn lỗi khi sửa lại', async ({ page }) => {
    const email = page.getByRole('textbox', { name: 'Email' });
    await email.fill('an.nguyen@');
    await page.getByRole('button', { name: 'Gửi liên hệ' }).click();
    await expect(email).toHaveAccessibleDescription('Email không hợp lệ');

    // Gõ lại là lỗi biến mất (bắt sự kiện input), không cần bấm gửi lần nữa
    await email.fill('an.nguyen@example.com');
    await expect(email).not.toHaveAttribute('aria-invalid');
    await expect(page.getByText('Email không hợp lệ')).toBeHidden();
  });

  test('chọn liên hệ qua điện thoại thì bắt buộc nhập số', async ({ page }) => {
    await page.getByRole('radio', { name: 'Điện thoại' }).check();
    await page.getByRole('button', { name: 'Gửi liên hệ' }).click();
    await expect(page.getByLabel('Số điện thoại')).toHaveAccessibleDescription(
      'Vui lòng nhập số điện thoại để chúng tôi gọi lại',
    );
  });
});
