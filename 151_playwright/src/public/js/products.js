// Trang Sản phẩm: tải danh sách qua API (có độ trễ), tìm kiếm có debounce, lọc danh mục, thêm vào giỏ.
import { addToCart, formatVnd } from './common.js';

const searchForm = document.getElementById('search-form');
const searchInput = document.getElementById('search');
const categorySelect = document.getElementById('category');
const summary = document.getElementById('list-summary');
const loadError = document.getElementById('load-error');
const list = document.getElementById('product-list');
const toast = document.getElementById('toast');
const cardTemplate = document.getElementById('product-card');

let controller;
let debounceTimer;
let toastTimer;

// Đọc từ khoá trên URL để mở thẳng /products?q=kem là thấy kết quả
const params = new URLSearchParams(location.search);
searchInput.value = params.get('q') ?? '';
categorySelect.value = params.get('category') ?? '';

async function loadProducts() {
  // Huỷ request cũ để kết quả về chậm không ghi đè kết quả mới hơn
  controller?.abort();
  const current = (controller = new AbortController());

  const query = new URLSearchParams();
  if (searchInput.value.trim()) query.set('q', searchInput.value.trim());
  if (categorySelect.value) query.set('category', categorySelect.value);
  history.replaceState(null, '', query.toString() ? `?${query}` : location.pathname);

  summary.textContent = 'Đang tải sản phẩm...';
  loadError.hidden = true;
  try {
    const response = await fetch(`/api/products?${query}`, { signal: current.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const { items } = await response.json();
    list.replaceChildren(...items.map(createCard));
    summary.textContent = items.length > 0 ? `Hiển thị ${items.length} sản phẩm` : 'Không tìm thấy sản phẩm phù hợp';
  } catch {
    if (current.signal.aborted) return;
    list.replaceChildren();
    summary.textContent = '';
    loadError.hidden = false;
  }
}

function createCard(product) {
  const card = cardTemplate.content.firstElementChild.cloneNode(true);
  card.querySelector('h2').textContent = product.name;
  card.querySelector('.category').textContent = product.category;
  card.querySelector('.price').textContent = formatVnd(product.price);

  const button = card.querySelector('button');
  if (product.inStock) {
    button.addEventListener('click', () => {
      addToCart(product);
      showToast(`Đã thêm ${product.name} vào giỏ`);
    });
  } else {
    button.disabled = true;
    button.textContent = 'Hết hàng';
  }
  return card;
}

// Thông báo tự ẩn sau 2 giây
function showToast(message) {
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 2000);
}

searchInput.addEventListener('input', () => {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(loadProducts, 300);
});
// Enter trong ô tìm kiếm: tải ngay, không reload trang
searchForm.addEventListener('submit', (event) => {
  event.preventDefault();
  clearTimeout(debounceTimer);
  loadProducts();
});
categorySelect.addEventListener('change', loadProducts);
document.getElementById('retry').addEventListener('click', loadProducts);

loadProducts();
