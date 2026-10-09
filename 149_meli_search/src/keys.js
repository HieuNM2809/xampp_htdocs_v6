// Phần bảo mật: API key và tenant token.
// Chạy: npm run keys
//
// Script này cần master key (hoặc một key có quyền keys.*). Nó không sửa dữ liệu,
// chỉ tạo thêm một search-only key để minh hoạ, rồi tự xoá đi ở cuối.
import { Meilisearch } from 'meilisearch';
import { generateTenantToken } from 'meilisearch/token';
import { client, waitForMeilisearch } from './client.js';
import { config } from './config.js';
import { subtitle, title } from './lib/print.js';

const DEMO_KEY_NAME = 'Demo frontend search key';

await waitForMeilisearch();

title('A', 'Các key có sẵn');
// Meilisearch tự sinh 4 key mặc định từ master key ngay lần chạy đầu tiên.
// Master key KHÔNG nằm trong danh sách này và không lấy lại được qua API.
const { results: existing } = await client.getKeys();

// Dọn key demo còn sót lại nếu lần chạy trước bị ngắt giữa chừng.
for (const stale of existing.filter((key) => key.name === DEMO_KEY_NAME)) {
  await client.deleteKey(stale.uid);
}

const { results: keys } = await client.getKeys();
for (const key of keys) {
  console.log(
    `  ${(key.name ?? '(không tên)').padEnd(32)} actions=${JSON.stringify(key.actions)} indexes=${JSON.stringify(key.indexes)}`,
  );
}

title('B', 'Tạo search-only key, chỉ cho một index');
const searchKey = await client.createKey({
  name: DEMO_KEY_NAME,
  description: 'Chỉ được search trên index của ví dụ, hết hạn sau 1 giờ',
  actions: ['search'],
  indexes: [config.indexUid],
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
});
console.log(`  uid      : ${searchKey.uid}`);
console.log(`  key      : ${searchKey.key}`);
// Lưu ý: kiểu TypeScript khai báo expiresAt là Date, nhưng lúc chạy API trả về chuỗi RFC3339.
console.log(`  expiresAt: ${searchKey.expiresAt}`);

title('C', 'Key đó search được nhưng không ghi được');
const frontend = new Meilisearch({ host: config.host, apiKey: searchKey.key });
const result = await frontend.index(config.indexUid).search('serum', { limit: 1 });
console.log(`  search → OK, ${result.estimatedTotalHits} hit`);
try {
  await frontend.index(config.indexUid).addDocuments([{ id: 999, name: 'x' }]);
  console.log('  addDocuments → (không mong đợi) thành công');
} catch (error) {
  console.log(`  addDocuments → bị chặn: ${error.cause?.code ?? error.message}`);
}

title('D', 'Tenant token: giới hạn dữ liệu theo từng người dùng');
subtitle('  Token được ký bằng một API key, nhúng sẵn filter mà client không gỡ ra được.');
// Dùng cho multi-tenant: mỗi khách hàng chỉ thấy phần dữ liệu của mình.
// Ở đây minh hoạ bằng filter "chỉ thấy hàng còn bán".
const tenantToken = await generateTenantToken({
  apiKey: searchKey.key,
  apiKeyUid: searchKey.uid,
  searchRules: { [config.indexUid]: { filter: 'inStock = true' } },
  expiresAt: new Date(Date.now() + 60 * 60 * 1000),
});
console.log(`  token: ${tenantToken.slice(0, 48)}…`);

const tenant = new Meilisearch({ host: config.host, apiKey: tenantToken });
const tenantResult = await tenant.index(config.indexUid).search('', { limit: 0 });
const everything = await client.index(config.indexUid).search('', { limit: 0 });
console.log(`  qua tenant token → ${tenantResult.estimatedTotalHits} hit (đã bị ép filter inStock = true)`);
console.log(`  qua master key   → ${everything.estimatedTotalHits} hit (toàn bộ index)`);
if (tenantResult.estimatedTotalHits === everything.estimatedTotalHits) {
  console.log('  (hai số bằng nhau vì index đang không còn sản phẩm hết hàng —');
  console.log('   bước 6 của "npm run demo" đã xoá. Chạy "npm run setup" rồi thử lại để thấy chênh lệch.)');
}

title('E', 'Dọn dẹp');
await client.deleteKey(searchKey.uid);
console.log(`  đã xoá key ${searchKey.uid}`);
