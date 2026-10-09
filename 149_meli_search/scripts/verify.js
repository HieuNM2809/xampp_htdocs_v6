// Kiểm tra tự động toàn bộ ví dụ: nạp lại dữ liệu rồi assert từng hành vi.
// Chạy: npm run verify
//
// Script tự gọi setup() nên không cần chạy "npm run setup" trước.
// Sau khi chạy xong, index được nạp lại về trạng thái ban đầu.
import { client, index, waitForMeilisearch } from '../src/client.js';
import { config } from '../src/config.js';
import { setup, settings } from '../src/setup.js';

let passed = 0;
const failures = [];

function check(group, label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`PASS  ${group.padEnd(12)} ${label}`);
  } else {
    failures.push(`${group} / ${label}${detail ? ` — ${detail}` : ''}`);
    console.log(`FAIL  ${group.padEnd(12)} ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

const ids = (response) => response.hits.map((hit) => hit.id);

await waitForMeilisearch();
await setup({ log: () => {} });
console.log(`Meilisearch: ${config.host}   index: ${config.indexUid}\n`);

// ---------------------------------------------------------------- setup
{
  const stats = await index.getStats();
  check('setup', 'nạp đủ 24 document', stats.numberOfDocuments === 24, `có ${stats.numberOfDocuments}`);

  const primaryKey = await index.fetchPrimaryKey();
  check('setup', 'primary key là "id"', primaryKey === 'id', `có "${primaryKey}"`);

  const actual = await index.getSettings();
  check(
    'setup',
    'searchableAttributes đúng thứ tự đã khai báo',
    JSON.stringify(actual.searchableAttributes) === JSON.stringify(settings.searchableAttributes),
  );
  check(
    'setup',
    'filterableAttributes có đủ 7 trường',
    settings.filterableAttributes.every((field) => actual.filterableAttributes.includes(field)),
  );
  check(
    'setup',
    'sortableAttributes có đủ 3 trường',
    settings.sortableAttributes.every((field) => actual.sortableAttributes.includes(field)),
  );
  check(
    'setup',
    'rankingRules kết thúc bằng custom rule rating:desc',
    actual.rankingRules.at(-1) === 'rating:desc',
    `có "${actual.rankingRules.at(-1)}"`,
  );
}

// --------------------------------------------------------------- search
{
  const withDiacritics = await index.search('kem chống nắng');
  const withoutDiacritics = await index.search('kem chong nang');
  check('search', 'tìm được "kem chống nắng"', withDiacritics.hits.length > 0);
  check(
    'search',
    'gõ không dấu ra cùng kết quả',
    JSON.stringify(ids(withDiacritics)) === JSON.stringify(ids(withoutDiacritics)),
  );

  const strict = await index.search('kem chống nắng', { matchingStrategy: 'all' });
  check(
    'search',
    'matchingStrategy "all" thu hẹp kết quả so với mặc định',
    strict.estimatedTotalHits < withDiacritics.estimatedTotalHits,
    `all=${strict.estimatedTotalHits} last=${withDiacritics.estimatedTotalHits}`,
  );
  check(
    'search',
    'matchingStrategy "all" chỉ còn đúng 3 kem chống nắng',
    new Set(ids(strict)).size === strict.hits.length &&
      ids(strict).filter((id) => [4, 13, 23].includes(id)).length === 3,
  );

  const typo = await index.search('cerav');
  check('typo', '"cerav" ra sản phẩm CeraVe', typo.hits.some((hit) => hit.brand === 'CeraVe'));

  const longTypo = await index.search('niacinamid');
  check('typo', '"niacinamid" ra serum Niacinamide', ids(longTypo).includes(6));

  // minWordSizeForTypos.oneTypo = 4: từ ngắn hơn 4 ký tự không được tha lỗi chính tả.
  const shortTypo = await index.search('tonr'); // 4 ký tự, sai 1 → vẫn ra Toner
  const tooShort = await index.search('tnr'); // 3 ký tự, sai 1 → không ra gì
  check('typo', '"tonr" (4 ký tự) vẫn ra Toner', ids(shortTypo).includes(9) && ids(shortTypo).includes(11));
  check(
    'typo',
    '"tnr" (3 ký tự) không được tha lỗi vì dưới ngưỡng oneTypo',
    tooShort.estimatedTotalHits === 0,
    `có ${tooShort.estimatedTotalHits} hit`,
  );

  const synonym = await index.search('srm');
  check('synonym', '"srm" ra 4 sữa rửa mặt', synonym.estimatedTotalHits === 4, `có ${synonym.estimatedTotalHits}`);

  // "cho" nằm trong stopWords nên bị bỏ qua, hai query cho ra đúng cùng một kết quả.
  const withStopWord = await index.search('kem dưỡng cho da khô');
  const withoutStopWord = await index.search('kem dưỡng da khô');
  check(
    'stopword',
    'stop word "cho" bị bỏ qua, kết quả không đổi',
    JSON.stringify(ids(withStopWord)) === JSON.stringify(ids(withoutStopWord)),
    `${withStopWord.estimatedTotalHits} vs ${withoutStopWord.estimatedTotalHits}`,
  );
}

// --------------------------------------------------------------- filter
{
  const cheapSerum = await index.search('', { filter: 'category = "Serum" AND price < 300000', limit: 50 });
  check(
    'filter',
    'Serum dưới 300k đúng 4 sản phẩm',
    cheapSerum.hits.length === 4,
    `có ${cheapSerum.hits.length}`,
  );
  check(
    'filter',
    'mọi hit đều thoả điều kiện',
    cheapSerum.hits.every((hit) => hit.category === 'Serum' && hit.price < 300000),
  );

  const range = await index.search('', { filter: 'price 300000 TO 500000', limit: 50 });
  check('filter', 'TO là khoảng đóng hai đầu', range.hits.every((hit) => hit.price >= 300000 && hit.price <= 500000));

  const orFilter = await index.search('', {
    filter: [['brand = "CeraVe"', 'brand = "Bioderma"'], 'rating >= 4.5'],
    limit: 50,
  });
  check(
    'filter',
    'mảng lồng nhau hoạt động như OR',
    orFilter.hits.length === 4 && orFilter.hits.every((hit) => ['CeraVe', 'Bioderma'].includes(hit.brand)),
    `có ${orFilter.hits.length} hit`,
  );

  const inFilter = await index.search('', { filter: 'tags IN ["da mụn", "da dầu"]', limit: 50 });
  check(
    'filter',
    'IN khớp trên trường mảng',
    inFilter.hits.every((hit) => hit.tags.includes('da mụn') || hit.tags.includes('da dầu')),
  );

  let rejected = null;
  try {
    await index.search('', { filter: 'description = "x"' });
  } catch (error) {
    rejected = error.cause?.code ?? error.message;
  }
  check(
    'filter',
    'lọc trường ngoài filterableAttributes bị từ chối',
    rejected === 'invalid_search_filter',
    `nhận "${rejected}"`,
  );
}

// ----------------------------------------------------------------- sort
{
  const asc = await index.search('', { sort: ['price:asc'], limit: 50 });
  const prices = asc.hits.map((hit) => hit.price);
  check('sort', 'price:asc tăng dần', prices.every((price, i) => i === 0 || prices[i - 1] <= price));
  check('sort', 'rẻ nhất là Cocoon 185.000đ', asc.hits[0].price === 185000, `có ${asc.hits[0].price}`);

  let rejected = null;
  try {
    await index.search('', { sort: ['brand:asc'] });
  } catch (error) {
    rejected = error.cause?.code ?? error.message;
  }
  check('sort', 'sắp xếp trường ngoài sortableAttributes bị từ chối', rejected === 'invalid_search_sort', `nhận "${rejected}"`);
}

// ---------------------------------------------------------------- facet
{
  const all = await index.search('', { facets: ['brand', 'category'], limit: 0 });
  const totalFromFacet = Object.values(all.facetDistribution.category).reduce((sum, n) => sum + n, 0);
  check('facet', 'tổng facet category bằng số document', totalFromFacet === 24, `có ${totalFromFacet}`);
  check('facet', 'có 7 category', Object.keys(all.facetDistribution.category).length === 7);
  check('facet', 'The Ordinary có 3 sản phẩm', all.facetDistribution.brand['The Ordinary'] === 3);

  const stats = await index.search('', { facets: ['price'], limit: 0 });
  check(
    'facet',
    'facetStats trả về min/max của price',
    stats.facetStats.price.min === 185000 && stats.facetStats.price.max === 1150000,
    JSON.stringify(stats.facetStats.price),
  );

  const scoped = await index.search('', { filter: 'category = "Serum"', facets: ['brand'], limit: 0 });
  check(
    'facet',
    'facetDistribution tính trên tập đã lọc',
    scoped.facetDistribution.brand.Anessa === undefined && scoped.facetDistribution.brand['The Ordinary'] === 3,
  );

  const facetSearch = await index.searchForFacetValues({ facetName: 'brand', facetQuery: 'cera' });
  check(
    'facet',
    'searchForFacetValues("cera") ra CeraVe',
    facetSearch.facetHits.length === 1 && facetSearch.facetHits[0].value === 'CeraVe',
  );
}

// ------------------------------------------------------------ pagination
{
  const offsetBased = await index.search('', { offset: 0, limit: 5 });
  check('paging', 'offset/limit trả estimatedTotalHits', typeof offsetBased.estimatedTotalHits === 'number');
  check('paging', 'offset/limit không có totalPages', offsetBased.totalPages === undefined);

  const pageBased = await index.search('', { page: 1, hitsPerPage: 5 });
  check('paging', 'page/hitsPerPage trả totalHits chính xác', pageBased.totalHits === 24, `có ${pageBased.totalHits}`);
  check('paging', 'totalPages = ceil(24/5) = 5', pageBased.totalPages === 5, `có ${pageBased.totalPages}`);

  const page1 = await index.search('', { page: 1, hitsPerPage: 10, sort: ['price:asc'] });
  const page2 = await index.search('', { page: 2, hitsPerPage: 10, sort: ['price:asc'] });
  const page3 = await index.search('', { page: 3, hitsPerPage: 10, sort: ['price:asc'] });
  const seen = [...ids(page1), ...ids(page2), ...ids(page3)];
  check('paging', 'ba trang gộp lại đủ 24 document, không trùng', new Set(seen).size === 24 && seen.length === 24);
  check('paging', 'trang cuối chỉ còn 4 hit', page3.hits.length === 4, `có ${page3.hits.length}`);

  const beyond = await index.search('', { page: 99, hitsPerPage: 10 });
  check('paging', 'xin trang vượt quá thì trả mảng rỗng, không lỗi', beyond.hits.length === 0);
}

// ------------------------------------------------------------- highlight
{
  const html = await index.search('cerave', { attributesToHighlight: ['name'], limit: 1 });
  check('highlight', 'mặc định bọc bằng thẻ <em>', html.hits[0]._formatted.name.includes('<em>CeraVe</em>'), html.hits[0]._formatted.name);

  const custom = await index.search('hyaluronic acid', {
    attributesToHighlight: ['name', 'description'],
    highlightPreTag: '«',
    highlightPostTag: '»',
    limit: 1,
  });
  check('highlight', 'đổi được pre/post tag', custom.hits[0]._formatted.name.includes('«Hyaluronic»'), custom.hits[0]._formatted.name);
  check('highlight', 'trường gốc không bị đổi, chỉ _formatted mới có thẻ', !custom.hits[0].name.includes('«'));

  const cropped = await index.search('salicylic acid', {
    attributesToCrop: ['description'],
    cropLength: 12,
    cropMarker: '…',
    limit: 1,
  });
  const words = cropped.hits[0]._formatted.description.replace(/…/g, '').trim().split(/\s+/);
  check('highlight', 'cropLength 12 cắt bớt description', words.length <= 13, `có ${words.length} từ`);
  check('highlight', 'cropMarker xuất hiện ở chỗ bị cắt', cropped.hits[0]._formatted.description.includes('…'));

  const positions = await index.search('vitamin', { showMatchesPosition: true, limit: 1 });
  check('highlight', '_matchesPosition có toạ độ khớp', Array.isArray(positions.hits[0]._matchesPosition.name));
}

// ------------------------------------------------------------- documents
{
  const added = await index
    .addDocuments([{ id: 99, name: 'Serum Verify 30ml', brand: 'Demo Brand', category: 'Serum', price: 1000, rating: 3, reviewCount: 1, inStock: true, tags: ['demo'], releaseYear: 2026, description: 'tạm' }])
    .waitTask();
  check('document', 'addDocuments tạo 1 document', added.status === 'succeeded' && added.details.indexedDocuments === 1);

  await index.updateDocuments([{ id: 99, price: 2000 }]).waitTask();
  const updated = await index.getDocument(99);
  check('document', 'updateDocuments chỉ sửa trường được gửi', updated.price === 2000 && updated.name === 'Serum Verify 30ml');

  const deleted = await index.deleteDocument(99).waitTask();
  check('document', 'deleteDocument xoá đúng 1 document', deleted.details.deletedDocuments === 1);

  let notFound = null;
  try {
    await index.getDocument(99);
  } catch (error) {
    notFound = error.cause?.code ?? error.message;
  }
  check('document', 'document đã xoá thì getDocument báo document_not_found', notFound === 'document_not_found', `nhận "${notFound}"`);

  const byFilter = await index.deleteDocuments({ filter: 'inStock = false' }).waitTask();
  check('document', 'deleteDocuments theo filter xoá 1 sản phẩm hết hàng', byFilter.details.deletedDocuments === 1, `xoá ${byFilter.details.deletedDocuments}`);

  const stats = await index.getStats();
  check('document', 'còn lại 23 document', stats.numberOfDocuments === 23, `có ${stats.numberOfDocuments}`);
}

// ------------------------------------------------------------------ auth
{
  const anonymous = new (await import('meilisearch')).Meilisearch({ host: config.host });
  let code = null;
  try {
    await anonymous.index(config.indexUid).search('serum');
  } catch (error) {
    code = error.cause?.code ?? error.message;
  }
  check('auth', 'gọi API không kèm key bị chặn', code === 'missing_authorization_header', `nhận "${code}"`);

  const searchOnly = await client.createKey({
    name: 'verify search-only',
    actions: ['search'],
    indexes: [config.indexUid],
    expiresAt: null,
  });
  const restricted = new (await import('meilisearch')).Meilisearch({ host: config.host, apiKey: searchOnly.key });
  const ok = await restricted.index(config.indexUid).search('serum', { limit: 1 });
  check('auth', 'search-only key vẫn search được', ok.hits.length >= 0);

  let writeCode = null;
  try {
    await restricted.index(config.indexUid).addDocuments([{ id: 1000, name: 'x' }]);
  } catch (error) {
    writeCode = error.cause?.code ?? error.message;
  }
  check('auth', 'search-only key không ghi được', writeCode === 'invalid_api_key', `nhận "${writeCode}"`);
  await client.deleteKey(searchOnly.uid);
}

// Trả index về trạng thái ban đầu để lần chạy demo sau không bị thiếu dữ liệu.
await setup({ log: () => {} });

console.log(`\nKết quả: ${passed}/${passed + failures.length} check PASS`);
if (failures.length > 0) {
  console.log('\nCác check hỏng:');
  for (const failure of failures) {
    console.log(`  - ${failure}`);
  }
  process.exit(1);
}
