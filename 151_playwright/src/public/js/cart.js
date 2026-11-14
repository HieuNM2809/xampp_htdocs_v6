// Trang Giỏ hàng: đổi số lượng, xoá (có hộp thoại xác nhận), nhập thông tin giao hàng và đặt hàng.
import { formatVnd, readCart, saveCart, setFieldError, showFieldErrors } from './common.js';

const MAX_QUANTITY = 10;

const emptyMessage = document.getElementById('cart-empty');
const content = document.getElementById('cart-content');
const tbody = document.querySelector('#cart-table tbody');
const totalCell = document.querySelector('[data-testid="cart-total"]');
const form = document.getElementById('checkout-form');
const submitButton = form.querySelector('button[type="submit"]');
const orderError = document.getElementById('order-error');
const success = document.getElementById('order-success');
const rowTemplate = document.getElementById('cart-row');

function render() {
  const items = readCart();
  emptyMessage.hidden = items.length > 0;
  content.hidden = items.length === 0;
  tbody.replaceChildren(...items.map(createRow));
  totalCell.textContent = formatVnd(items.reduce((sum, item) => sum + item.price * item.quantity, 0));
}

function createRow(item) {
  const row = rowTemplate.content.firstElementChild.cloneNode(true);
  row.querySelector('.name').textContent = item.name;
  row.querySelector('.price').textContent = formatVnd(item.price);
  row.querySelector('[data-testid="quantity"]').textContent = String(item.quantity);
  row.querySelector('.line-total').textContent = formatVnd(item.price * item.quantity);

  // Nút chỉ có ký hiệu "−" "+" nên cần aria-label để trình đọc màn hình (và Playwright) biết nút làm gì
  const decrease = row.querySelector('.decrease');
  const increase = row.querySelector('.increase');
  const remove = row.querySelector('.remove');
  decrease.setAttribute('aria-label', `Giảm số lượng ${item.name}`);
  increase.setAttribute('aria-label', `Tăng số lượng ${item.name}`);
  remove.setAttribute('aria-label', `Xoá ${item.name} khỏi giỏ`);
  decrease.disabled = item.quantity <= 1;
  increase.disabled = item.quantity >= MAX_QUANTITY;

  decrease.addEventListener('click', () => changeQuantity(item.id, -1));
  increase.addEventListener('click', () => changeQuantity(item.id, 1));
  remove.addEventListener('click', () => {
    // Hộp thoại gốc của trình duyệt. Playwright mặc định tự bấm "Huỷ" nếu test không xử lý dialog.
    if (!confirm(`Xoá ${item.name} khỏi giỏ hàng?`)) return;
    saveCart(readCart().filter((i) => i.id !== item.id));
    render();
  });
  return row;
}

function changeQuantity(id, delta) {
  const items = readCart();
  const item = items.find((i) => i.id === id);
  item.quantity = Math.min(MAX_QUANTITY, Math.max(1, item.quantity + delta));
  saveCart(items);
  render();
}

function validate(customer) {
  const errors = {};
  if (!customer.name) errors.name = 'Vui lòng nhập tên người nhận';
  if (!/^0\d{9}$/.test(customer.phone)) errors.phone = 'Số điện thoại gồm 10 chữ số, bắt đầu bằng 0';
  if (customer.address.length < 10) errors.address = 'Địa chỉ cần ít nhất 10 ký tự';
  return errors;
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(form);
  const customer = {
    name: formData.get('name').trim(),
    phone: formData.get('phone').trim(),
    address: formData.get('address').trim(),
  };
  if (showFieldErrors(form, validate(customer))) return;

  submitButton.disabled = true;
  submitButton.textContent = 'Đang đặt hàng...';
  orderError.hidden = true;
  try {
    // Chỉ gửi id và số lượng, server tự tính tiền theo giá của nó
    const items = readCart().map(({ id, quantity }) => ({ id, quantity }));
    const response = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer, paymentMethod: formData.get('paymentMethod'), items }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error ?? `HTTP ${response.status}`);

    saveCart([]);
    content.hidden = true;
    success.querySelector('[data-testid="order-id"]').textContent = body.orderId;
    success.querySelector('[data-testid="order-total"]').textContent = formatVnd(body.total);
    success.hidden = false;
  } catch (error) {
    orderError.textContent = `Đặt hàng không thành công: ${error.message}`;
    orderError.hidden = false;
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Đặt hàng';
  }
});

form.addEventListener('input', (event) => {
  if (event.target.getAttribute('aria-invalid') === 'true') setFieldError(event.target, null);
});

render();
