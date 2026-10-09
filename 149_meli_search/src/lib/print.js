// Helper in kết quả ra terminal cho dễ đọc. Không liên quan tới Meilisearch,
// tách riêng để các file demo chỉ còn phần code về search.

/** Thẻ highlight dạng mã màu ANSI, để kết quả nhìn rõ ngay trên terminal. */
export const ANSI_HIGHLIGHT = {
  pre: '\u001b[30;43m',
  post: '\u001b[0m',
};

const DIM = '\u001b[2m';
const BOLD = '\u001b[1m';
const RESET = '\u001b[0m';

export function title(step, text) {
  console.log(`\n${BOLD}── ${step}. ${text}${RESET}`);
}

export function subtitle(text) {
  console.log(`${DIM}${text}${RESET}`);
}

/** 385000 -> "385.000đ" */
export function vnd(amount) {
  return `${amount.toLocaleString('vi-VN')}đ`;
}

/**
 * In danh sách hit. Ưu tiên `_formatted` nếu có (phần highlight / crop do
 * Meilisearch trả về), nếu không thì in trường gốc.
 */
export function printHits(hits, { showDescription = false } = {}) {
  if (hits.length === 0) {
    console.log('  (không có kết quả)');
    return;
  }
  for (const hit of hits) {
    const source = hit._formatted ?? hit;
    console.log(
      `  #${String(hit.id).padStart(2)} ${source.name}\n` +
        `      ${DIM}${hit.brand} · ${hit.category} · ${vnd(hit.price)} · ★ ${hit.rating} (${hit.reviewCount} đánh giá)${RESET}`,
    );
    if (showDescription) {
      console.log(`      ${source.description}`);
    }
  }
}

/** In facetDistribution theo thứ tự số lượng giảm dần. */
export function printFacet(name, distribution) {
  console.log(`  ${BOLD}${name}${RESET}`);
  const entries = Object.entries(distribution ?? {}).sort((a, b) => b[1] - a[1]);
  if (entries.length === 0) {
    console.log('    (trống)');
    return;
  }
  const width = Math.max(...entries.map(([value]) => value.length));
  for (const [value, count] of entries) {
    console.log(`    ${value.padEnd(width)}  ${String(count).padStart(3)}`);
  }
}

export function printStats(response) {
  const total = response.estimatedTotalHits ?? response.totalHits;
  const label = response.totalHits === undefined ? 'ước tính' : 'chính xác';
  console.log(
    `${DIM}  → ${response.hits.length} hit hiển thị / ${total} tổng (${label}), ${response.processingTimeMs}ms${RESET}`,
  );
}
