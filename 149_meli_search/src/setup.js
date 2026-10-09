// Bước chuẩn bị: tạo index, khai báo settings, nạp dữ liệu mẫu.
// Chạy: npm run setup
//
// Script xoá index cũ trước khi tạo lại để chạy bao nhiêu lần cũng ra cùng kết quả.
import { readFile } from 'node:fs/promises';
import { client, index, waitForMeilisearch } from './client.js';
import { config } from './config.js';

/**
 * Settings của index. Mỗi nhóm quyết định một chuyện khác nhau:
 *  - searchableAttributes: những trường được đánh chỉ mục để tìm, THỨ TỰ cũng là độ ưu tiên.
 *  - filterableAttributes: những trường dùng được trong `filter` và `facets`.
 *  - sortableAttributes  : những trường dùng được trong `sort`.
 * Trường không nằm trong 3 nhóm trên vẫn được trả về, chỉ là không tìm/lọc/sắp xếp được.
 */
export const settings = {
  // "name" đứng trước "description" nên khớp ở tên sản phẩm được xếp hạng cao hơn.
  searchableAttributes: ['name', 'brand', 'category', 'tags', 'description'],

  // Dạng chuỗi là đủ cho hầu hết trường hợp. Meilisearch còn nhận dạng chi tiết
  // { attributePatterns, features } nếu cần bật/tắt riêng facetSearch hay phép so sánh.
  filterableAttributes: ['brand', 'category', 'tags', 'price', 'rating', 'inStock', 'releaseYear'],

  sortableAttributes: ['price', 'rating', 'reviewCount'],

  // 7 rule mặc định của Meilisearch 1.54, giữ nguyên thứ tự, cộng thêm 1 custom rule
  // ở cuối: khi mọi tiêu chí trên hoà nhau thì sản phẩm có rating cao hơn thắng.
  // (Bản cũ gộp attributeRank + wordPosition thành một rule tên "attribute";
  //  tên cũ vẫn được chấp nhận nhưng nên dùng tên mới.)
  rankingRules: [
    'words',
    'typo',
    'proximity',
    'attributeRank',
    'sort',
    'wordPosition',
    'exactness',
    'rating:desc',
  ],

  typoTolerance: {
    enabled: true,
    minWordSizeForTypos: {
      oneTypo: 4, // từ >= 4 ký tự: cho sai 1 ký tự
      twoTypos: 8, // từ >= 8 ký tự: cho sai 2 ký tự
    },
  },

  faceting: {
    maxValuesPerFacet: 20,
    sortFacetValuesBy: { '*': 'count' },
  },

  // Trần số hit mà phân trang đi tới được. Mặc định cũng là 1000.
  pagination: { maxTotalHits: 1000 },

  stopWords: ['và', 'cho', 'của', 'với'],

  synonyms: {
    srm: ['sữa rửa mặt'],
    kcn: ['kem chống nắng'],
    sunscreen: ['chống nắng'],
  },
};

export async function setup({ log = console.log } = {}) {
  log(`Meilisearch: ${config.host}   index: ${config.indexUid}`);
  await waitForMeilisearch();

  const { pkgVersion } = await client.getVersion();
  log(`Đã kết nối, server phiên bản ${pkgVersion}`);

  // 1. Dọn index cũ để script chạy lại được nhiều lần.
  //    Xoá một index không tồn tại vẫn được nhận (HTTP 202), lỗi index_not_found chỉ
  //    lộ ra ở kết quả task. Vì vậy ở đây kiểm tra task.status thay vì bắt exception.
  //    (Cùng lý do, client.deleteIndexIfExists() luôn trả về true — nó chỉ chờ bước nhận task.)
  const deleteTask = await client.deleteIndex(config.indexUid).waitTask();
  log(
    deleteTask.status === 'succeeded'
      ? '1. Đã xoá index cũ'
      : `1. Chưa có index cũ (${deleteTask.error?.code}), bỏ qua bước xoá`,
  );

  // 2. Tạo index và chỉ định primary key.
  //    Không chỉ định thì Meilisearch tự đoán từ trường tên "id" hoặc có hậu tố "Id".
  //    Mọi thao tác ghi đều là task chạy nền; .waitTask() chờ task xong.
  const createTask = await client.createIndex(config.indexUid, { primaryKey: 'id' }).waitTask();
  log(`2. Đã tạo index "${config.indexUid}" (primary key: id, task #${createTask.uid})`);

  // 3. Khai báo settings. Đổi settings là Meilisearch đánh chỉ mục lại toàn bộ index,
  //    nên hãy làm bước này trước khi nạp dữ liệu lớn.
  const settingsTask = await index.updateSettings(settings).waitTask();
  log(`3. Đã cập nhật settings (task #${settingsTask.uid}, ${settingsTask.duration})`);

  // 4. Nạp dữ liệu. addDocuments ghi đè document trùng primary key,
  //    updateDocuments chỉ cập nhật các trường được gửi lên.
  const documents = JSON.parse(await readFile(config.dataFile, 'utf8'));
  const addTask = await index.addDocuments(documents).waitTask();
  if (addTask.status !== 'succeeded') {
    throw new Error(`Nạp dữ liệu thất bại: ${JSON.stringify(addTask.error)}`);
  }
  log(
    `4. Đã nạp ${addTask.details.indexedDocuments}/${addTask.details.receivedDocuments} document ` +
      `(task #${addTask.uid}, ${addTask.duration})`,
  );

  const stats = await index.getStats();
  log(`   Index đang giữ ${stats.numberOfDocuments} document, ${stats.indexSize} byte trên đĩa`);

  return stats;
}

// Chỉ chạy khi gọi trực tiếp file này, không chạy khi bị import.
if (import.meta.filename === process.argv[1]) {
  await setup();
}
