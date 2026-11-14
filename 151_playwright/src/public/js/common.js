// Phần dùng chung cho mọi trang: giỏ hàng (lưu trong localStorage), định dạng tiền, hiển thị lỗi form.

const CART_KEY = 'mini-shop-cart';
const priceFormat = new Intl.NumberFormat('vi-VN');

/** 329000 -> "329.000đ" */
export function formatVnd(amount) {
  return `${priceFormat.format(amount)}đ`;
}

export function readCart() {
  try {
    return JSON.parse(localStorage.getItem(CART_KEY)) ?? [];
  } catch {
    return [];
  }
}

export function saveCart(items) {
  localStorage.setItem(CART_KEY, JSON.stringify(items));
  renderCartCount();
}

export function addToCart(product) {
  const items = readCart();
  const existing = items.find((item) => item.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    items.push({ id: product.id, name: product.name, price: product.price, quantity: 1 });
  }
  saveCart(items);
}

/** Cập nhật số trên link "Giỏ hàng (n)" ở header. */
export function renderCartCount() {
  const count = readCart().reduce((sum, item) => sum + item.quantity, 0);
  for (const el of document.querySelectorAll('[data-cart-count]')) {
    el.textContent = String(count);
  }
}

/**
 * Hiện lỗi cạnh từng ô nhập. Quy ước markup:
 *   <input name="email" aria-describedby="email-error">  +  <p class="error" id="email-error" hidden>
 * `errors` là object { tên trường: thông báo }. Trả về true nếu có lỗi (đã focus ô lỗi đầu tiên).
 */
export function showFieldErrors(form, errors) {
  let firstInvalid = null;
  for (const field of form.querySelectorAll('[aria-describedby]')) {
    const message = errors[field.name];
    setFieldError(field, message);
    if (message && !firstInvalid) firstInvalid = field;
  }
  firstInvalid?.focus();
  return firstInvalid !== null;
}

export function setFieldError(field, message) {
  const errorEl = document.getElementById(field.getAttribute('aria-describedby'));
  if (!errorEl) return;
  errorEl.textContent = message ?? '';
  errorEl.hidden = !message;
  if (message) {
    field.setAttribute('aria-invalid', 'true');
  } else {
    field.removeAttribute('aria-invalid');
  }
}

renderCartCount();
// Mở nhiều tab: tab này cập nhật số lượng khi tab khác sửa giỏ hàng
window.addEventListener('storage', (event) => {
  if (event.key === CART_KEY) renderCartCount();
});
