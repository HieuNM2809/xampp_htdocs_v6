// Lọc kết quả bằng `filter`. Trường muốn lọc phải nằm trong filterableAttributes.
import { index } from '../client.js';
import { printHits, printStats, subtitle, title, vnd } from '../lib/print.js';

export const name = 'Filter và sort';

export async function run() {
  title(2, name);

  // Toán tử: = != > >= < <= IN TO EXISTS IS EMPTY IS NULL NOT AND OR, và ngoặc đơn.
  subtitle('filter: \'category = "Serum" AND price < 300000\'');
  const cheapSerum = await index.search('', {
    filter: 'category = "Serum" AND price < 300000',
    limit: 10,
  });
  printHits(cheapSerum.hits);
  printStats(cheapSerum);

  // TO là khoảng đóng hai đầu: 300000 TO 500000 gồm cả hai mốc.
  subtitle('\nQuery + filter: "kem" với giá 300.000đ – 500.000đ và còn hàng');
  const inRange = await index.search('kem', {
    filter: ['price 300000 TO 500000', 'inStock = true'],
    limit: 10,
  });
  printHits(inRange.hits);
  printStats(inRange);

  // Mảng filter được nối bằng AND; mảng lồng trong mảng thì nối bằng OR.
  // Dưới đây: (brand = CeraVe OR brand = Bioderma) AND rating >= 4.5
  subtitle('\nMảng lồng nhau = OR: (CeraVe HOẶC Bioderma) VÀ rating >= 4.5');
  const orFilter = await index.search('', {
    filter: [['brand = "CeraVe"', 'brand = "Bioderma"'], 'rating >= 4.5'],
    limit: 10,
  });
  printHits(orFilter.hits);
  printStats(orFilter);

  // IN gọn hơn khi so nhiều giá trị của cùng một trường.
  subtitle('\nIN cho mảng tags: tags IN ["da mụn", "da dầu"] AND rating > 4.4');
  const tagFilter = await index.search('', {
    filter: 'tags IN ["da mụn", "da dầu"] AND rating > 4.4',
    limit: 10,
    attributesToRetrieve: ['id', 'name', 'brand', 'category', 'price', 'rating', 'reviewCount'],
  });
  printHits(tagFilter.hits);
  printStats(tagFilter);

  // sort: trường phải nằm trong sortableAttributes.
  subtitle('\nsort: ["price:asc"] — rẻ nhất trước');
  const cheapest = await index.search('', { sort: ['price:asc'], limit: 5 });
  console.log(cheapest.hits.map((h) => `  ${vnd(h.price).padStart(11)}  ${h.name}`).join('\n'));

  subtitle('\nsort nhiều cấp: ["rating:desc", "price:asc"]');
  const best = await index.search('', { sort: ['rating:desc', 'price:asc'], limit: 5 });
  console.log(best.hits.map((h) => `  ★ ${h.rating}  ${vnd(h.price).padStart(11)}  ${h.name}`).join('\n'));

  return { cheapSerum, inRange, orFilter, tagFilter, cheapest, best };
}
