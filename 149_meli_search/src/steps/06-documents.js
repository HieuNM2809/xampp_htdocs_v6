// Thêm, sửa, xoá document. Mọi thao tác ghi đều là task chạy nền.
import { index } from '../client.js';
import { subtitle, title, vnd } from '../lib/print.js';

export const name = 'Thêm, sửa, xoá document';

export async function run() {
  title(6, name);

  const before = await index.getStats();
  console.log(`  Bắt đầu với ${before.numberOfDocuments} document`);

  // addDocuments GHI ĐÈ toàn bộ document trùng primary key.
  subtitle('\naddDocuments: thêm 1 sản phẩm mới (id = 99)');
  const added = await index
    .addDocuments([
      {
        id: 99,
        name: 'Serum Demo Để Xoá 30ml',
        brand: 'Demo Brand',
        category: 'Serum',
        description: 'Sản phẩm tạm dùng để minh hoạ thao tác thêm và xoá document.',
        price: 199000,
        rating: 3.9,
        reviewCount: 7,
        inStock: true,
        tags: ['demo'],
        releaseYear: 2026,
      },
    ])
    .waitTask();
  console.log(`  task #${added.uid} ${added.status}, indexedDocuments=${added.details.indexedDocuments}`);

  const created = await index.getDocument(99);
  console.log(`  getDocument(99) → ${created.name}, ${vnd(created.price)}`);

  // updateDocuments chỉ ghi các trường được gửi, giữ nguyên phần còn lại.
  subtitle('\nupdateDocuments: chỉ đổi price, các trường khác giữ nguyên');
  await index.updateDocuments([{ id: 99, price: 149000 }]).waitTask();
  const updated = await index.getDocument(99);
  console.log(`  → ${updated.name}, ${vnd(updated.price)} (name vẫn còn, rating = ${updated.rating})`);

  // deleteDocument: xoá theo primary key.
  subtitle('\ndeleteDocument(99): xoá theo primary key');
  const deletedOne = await index.deleteDocument(99).waitTask();
  console.log(`  task #${deletedOne.uid} ${deletedOne.status}, deletedDocuments=${deletedOne.details.deletedDocuments}`);

  // getDocument trên id vừa xoá sẽ ném lỗi document_not_found.
  try {
    await index.getDocument(99);
    console.log('  (không mong đợi: document 99 vẫn còn)');
  } catch (error) {
    console.log(`  getDocument(99) → ném lỗi ${error.cause?.code ?? error.code ?? error.message}`);
  }

  // deleteDocuments nhận một mảng id, hoặc một filter.
  subtitle('\ndeleteDocuments({ filter }): xoá mọi sản phẩm hết hàng');
  const outOfStock = await index.search('', { filter: 'inStock = false', limit: 50, attributesToRetrieve: ['id', 'name'] });
  console.log(`  sắp xoá ${outOfStock.hits.length}: ${outOfStock.hits.map((h) => `#${h.id} ${h.name}`).join(', ')}`);
  const deletedMany = await index.deleteDocuments({ filter: 'inStock = false' }).waitTask();
  console.log(`  task #${deletedMany.uid} ${deletedMany.status}, deletedDocuments=${deletedMany.details.deletedDocuments}`);

  const after = await index.getStats();
  console.log(`\n  Còn lại ${after.numberOfDocuments} document (chạy "npm run setup" để nạp lại từ đầu)`);

  return { before, after, deletedOne, deletedMany };
}
