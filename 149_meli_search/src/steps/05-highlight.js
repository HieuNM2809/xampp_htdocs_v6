// Highlight và crop: Meilisearch trả thêm trường `_formatted` cho mỗi hit.
import { index } from '../client.js';
import { ANSI_HIGHLIGHT, printHits, subtitle, title } from '../lib/print.js';

export const name = 'Highlight và crop kết quả';

export async function run() {
  title(5, name);

  // Mặc định thẻ bọc là <em>...</em>, hợp để nhúng thẳng vào HTML.
  subtitle('attributesToHighlight mặc định dùng thẻ <em>');
  const html = await index.search('cerave', {
    attributesToHighlight: ['name'],
    limit: 2,
    attributesToRetrieve: ['id', 'name'],
  });
  for (const hit of html.hits) {
    console.log(`  ${hit._formatted.name}`);
  }

  // Đổi thẻ bằng highlightPreTag / highlightPostTag. Ở đây dùng mã màu ANSI
  // để nhìn thấy ngay trên terminal; trên web thì để <mark> hoặc <span class="...">.
  subtitle('\nĐổi thẻ sang mã màu ANSI, highlight cả name lẫn description');
  const highlighted = await index.search('hyaluronic acid', {
    attributesToHighlight: ['name', 'description'],
    highlightPreTag: ANSI_HIGHLIGHT.pre,
    highlightPostTag: ANSI_HIGHLIGHT.post,
    limit: 3,
  });
  printHits(highlighted.hits, { showDescription: true });

  // Crop: cắt description quanh từ khoá thay vì in cả đoạn dài.
  subtitle('\nattributesToCrop + cropLength: chỉ lấy 12 từ quanh chỗ khớp');
  const cropped = await index.search('salicylic acid', {
    attributesToCrop: ['description'],
    cropLength: 12,
    cropMarker: '…',
    attributesToHighlight: ['description'],
    highlightPreTag: ANSI_HIGHLIGHT.pre,
    highlightPostTag: ANSI_HIGHLIGHT.post,
    limit: 2,
  });
  for (const hit of cropped.hits) {
    console.log(`  ${hit.name}\n      ${hit._formatted.description}`);
  }

  // showMatchesPosition: vị trí khớp (byte offset + độ dài) nếu muốn tự tô màu.
  subtitle('\nshowMatchesPosition: toạ độ khớp để tự render');
  const positions = await index.search('vitamin', {
    showMatchesPosition: true,
    limit: 1,
    attributesToRetrieve: ['id', 'name'],
  });
  console.log(`  ${positions.hits[0].name}`);
  console.log(`  _matchesPosition = ${JSON.stringify(positions.hits[0]._matchesPosition)}`);

  return { html, highlighted, cropped, positions };
}
