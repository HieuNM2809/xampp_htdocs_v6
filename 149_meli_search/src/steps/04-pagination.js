// Hai kiểu phân trang. Chọn đúng kiểu thì giao diện mới hiển thị đúng.
import { index } from '../client.js';
import { subtitle, title } from '../lib/print.js';

export const name = 'Phân trang';

export async function run() {
  title(4, name);

  // Kiểu 1 — offset/limit: nhanh, nhưng chỉ biết ƯỚC TÍNH tổng số hit
  // (estimatedTotalHits). Hợp với "xem thêm" / cuộn vô hạn.
  subtitle('offset / limit → estimatedTotalHits (ước tính), không có tổng số trang');
  for (const offset of [0, 5, 10]) {
    const page = await index.search('', {
      offset,
      limit: 5,
      sort: ['price:asc'],
      attributesToRetrieve: ['id', 'name'],
    });
    console.log(
      `  offset=${String(offset).padStart(2)} limit=5 → id [${page.hits.map((h) => h.id).join(', ')}]` +
        `  estimatedTotalHits=${page.estimatedTotalHits}`,
    );
  }

  // Kiểu 2 — page/hitsPerPage: Meilisearch đếm chính xác, trả về totalHits và
  // totalPages. Chậm hơn một chút nhưng hiện được "Trang 2/5".
  subtitle('\npage / hitsPerPage → totalHits và totalPages (chính xác)');
  const offsetBased = await index.search('', { offset: 0, limit: 5 });
  const pageBased = await index.search('', { page: 1, hitsPerPage: 5 });
  console.log(`  offset/limit  → estimatedTotalHits=${offsetBased.estimatedTotalHits}, totalPages=${offsetBased.totalPages}`);
  console.log(`  page/hitsPerPage → totalHits=${pageBased.totalHits}, totalPages=${pageBased.totalPages}`);

  subtitle('\nDuyệt hết các trang với page/hitsPerPage = 10');
  let page = 1;
  let totalPages = 1;
  do {
    const result = await index.search('', {
      page,
      hitsPerPage: 10,
      sort: ['price:asc'],
      attributesToRetrieve: ['id'],
    });
    totalPages = result.totalPages;
    console.log(
      `  trang ${result.page}/${result.totalPages}  (${result.hits.length} hit)  ` +
        `id [${result.hits.map((h) => h.id).join(', ')}]`,
    );
    page += 1;
  } while (page <= totalPages);

  // Trần phân trang nằm ở settings pagination.maxTotalHits (ví dụ đặt 1000).
  // Vượt quá trần, Meilisearch trả về mảng rỗng chứ không báo lỗi.
  const paginationSettings = await index.getPagination();
  console.log(`\n  pagination.maxTotalHits = ${paginationSettings.maxTotalHits} (trần phân trang của index)`);

  return { offsetBased, pageBased, totalPages };
}
