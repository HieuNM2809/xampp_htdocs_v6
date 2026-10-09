// Tìm kiếm cơ bản: chỉ cần một chuỗi query là đủ.
import { index } from '../client.js';
import { printHits, printStats, subtitle, title } from '../lib/print.js';

export const name = 'Tìm kiếm cơ bản';

export async function run() {
  title(1, name);

  // Dạng gọn nhất: index.search('từ khoá')
  subtitle('index.search("kem chống nắng", { limit: 3 })');
  const basic = await index.search('kem chống nắng', { limit: 3 });
  printHits(basic.hits);
  printStats(basic);

  // Meilisearch bỏ dấu khi so khớp, gõ không dấu vẫn ra đúng kết quả.
  subtitle('\nGõ không dấu: index.search("kem chong nang")');
  const noDiacritics = await index.search('kem chong nang', { limit: 3 });
  printHits(noDiacritics.hits);
  printStats(noDiacritics);

  // matchingStrategy mặc định là "last": document khớp một phần từ khoá vẫn được trả về,
  // các từ cuối câu được bỏ dần cho tới khi có đủ kết quả. "all" bắt buộc khớp mọi từ.
  subtitle('\nmatchingStrategy: "all" — bắt buộc khớp đủ mọi từ');
  const strict = await index.search('kem chống nắng', { limit: 3, matchingStrategy: 'all' });
  printHits(strict.hits);
  printStats(strict);

  // typoTolerance: sai chính tả vẫn ra kết quả (settings ở src/setup.js).
  subtitle('\nGõ sai chính tả: "cerav" và "niacinamid"');
  for (const query of ['cerav', 'niacinamid']) {
    const typo = await index.search(query, { limit: 2 });
    console.log(`  "${query}":`);
    printHits(typo.hits);
  }

  // minWordSizeForTypos.oneTypo = 4 nên từ ngắn hơn 4 ký tự không được tha lỗi.
  subtitle('\nNgưỡng minWordSizeForTypos: "tonr" (4 ký tự) vs "tnr" (3 ký tự)');
  for (const query of ['tonr', 'tnr']) {
    const result = await index.search(query, { limit: 2, attributesToRetrieve: ['id', 'name'] });
    console.log(
      `  "${query}" → ${result.estimatedTotalHits} hit` +
        (result.hits.length > 0 ? `: ${result.hits.map((h) => h.name).join(' | ')}` : ''),
    );
  }

  // synonyms: "srm" được khai báo đồng nghĩa với "sữa rửa mặt".
  subtitle('\nTừ viết tắt nhờ synonyms: "srm" và "kcn"');
  for (const query of ['srm', 'kcn']) {
    const synonym = await index.search(query, { limit: 2, attributesToRetrieve: ['id', 'name'] });
    console.log(`  "${query}" → ${synonym.estimatedTotalHits} hit: ${synonym.hits.map((h) => h.name).join(' | ')}`);
  }

  // Query rỗng = duyệt toàn bộ index theo thứ tự ranking mặc định.
  subtitle('\nQuery rỗng trả về toàn bộ index (dùng để hiện danh sách mặc định)');
  const all = await index.search('', { limit: 3, attributesToRetrieve: ['id', 'name'] });
  printStats(all);

  return { basic, strict, all };
}
