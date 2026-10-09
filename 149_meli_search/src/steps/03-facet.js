// Faceted search: vừa lấy kết quả, vừa lấy số lượng theo từng nhóm để dựng bộ lọc bên trái.
import { index } from '../client.js';
import { printFacet, printStats, subtitle, title, vnd } from '../lib/print.js';

export const name = 'Facet (bộ lọc kèm số lượng)';

export async function run() {
  title(3, name);

  // `facets` liệt kê các trường cần đếm. Trường phải nằm trong filterableAttributes.
  subtitle('facets: ["brand", "category", "tags"] trên toàn bộ index');
  const all = await index.search('', {
    facets: ['brand', 'category', 'tags'],
    limit: 0, // chỉ cần số đếm, không cần hit
  });
  printFacet('category', all.facetDistribution.category);
  printFacet('brand', all.facetDistribution.brand);

  // Trường số còn có facetStats (min/max) — tiện để dựng thanh kéo chọn khoảng giá.
  subtitle('\nfacetStats cho trường số: ["price", "rating"]');
  const stats = await index.search('', { facets: ['price', 'rating'], limit: 0 });
  console.log(`  price : ${vnd(stats.facetStats.price.min)} – ${vnd(stats.facetStats.price.max)}`);
  console.log(`  rating: ${stats.facetStats.rating.min} – ${stats.facetStats.rating.max}`);

  // Điểm quan trọng: facetDistribution được tính TRÊN tập đã lọc.
  // Chọn category = "Serum" thì danh sách brand chỉ còn các hãng có serum.
  subtitle('\nSau khi chọn category = "Serum", facet brand thu hẹp theo');
  const filtered = await index.search('', {
    filter: 'category = "Serum"',
    facets: ['brand', 'tags'],
    limit: 0,
  });
  printFacet('brand (trong Serum)', filtered.facetDistribution.brand);
  printStats(filtered);

  // searchForFacetValues: ô "tìm trong bộ lọc" khi facet có quá nhiều giá trị.
  subtitle('\nsearchForFacetValues: gõ "cera" trong danh sách brand');
  const facetSearch = await index.searchForFacetValues({ facetName: 'brand', facetQuery: 'cera' });
  for (const hit of facetSearch.facetHits) {
    console.log(`  ${hit.value} (${hit.count})`);
  }

  return { all, filtered, facetSearch };
}
