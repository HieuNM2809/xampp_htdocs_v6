// Trang Liên hệ: kiểm tra dữ liệu phía client, gửi lên /api/contact, hiện thông báo thành công.
import { setFieldError, showFieldErrors } from './common.js';

const form = document.getElementById('contact-form');
const submitButton = form.querySelector('button[type="submit"]');
const failure = document.getElementById('contact-failure');
const success = document.getElementById('contact-success');

function validate(data) {
  const errors = {};
  if (!data.name) errors.name = 'Vui lòng nhập họ và tên';
  if (!data.email) errors.email = 'Vui lòng nhập email';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) errors.email = 'Email không hợp lệ';
  // Số điện thoại chỉ bắt buộc khi khách chọn liên hệ lại qua điện thoại
  if (data.contactMethod === 'phone' && !data.phone) errors.phone = 'Vui lòng nhập số điện thoại để chúng tôi gọi lại';
  else if (data.phone && !/^0\d{9}$/.test(data.phone)) errors.phone = 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0';
  if (!data.topic) errors.topic = 'Vui lòng chọn chủ đề';
  if (data.message.length < 10) errors.message = 'Nội dung cần ít nhất 10 ký tự';
  if (!data.agree) errors.agree = 'Bạn cần đồng ý trước khi gửi';
  return errors;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const data = {
    name: formData.get('name').trim(),
    email: formData.get('email').trim(),
    phone: formData.get('phone').trim(),
    topic: formData.get('topic'),
    contactMethod: formData.get('contactMethod'),
    message: formData.get('message').trim(),
    agree: formData.get('agree') === 'on',
  };
  if (showFieldErrors(form, validate(data))) return;

  submitButton.disabled = true;
  submitButton.textContent = 'Đang gửi...';
  failure.hidden = true;
  try {
    const response = await fetch('/api/contact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    success.querySelector('[data-name]').textContent = data.name;
    form.hidden = true;
    success.hidden = false;
  } catch {
    failure.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Gửi liên hệ';
  }
});

// Sửa lại ô đang báo lỗi thì ẩn lỗi của ô đó
form.addEventListener('input', (event) => {
  if (event.target.getAttribute('aria-invalid') === 'true') setFieldError(event.target, null);
});
