// Chạy lần lượt 6 bước minh hoạ. Cần chạy "npm run setup" trước.
// Chạy: npm run demo
import { config } from './config.js';
import { index, waitForMeilisearch } from './client.js';
import * as basicSearch from './steps/01-basic-search.js';
import * as filter from './steps/02-filter.js';
import * as facet from './steps/03-facet.js';
import * as pagination from './steps/04-pagination.js';
import * as highlight from './steps/05-highlight.js';
import * as documents from './steps/06-documents.js';

const steps = [basicSearch, filter, facet, pagination, highlight, documents];

await waitForMeilisearch();

// Bước 6 xoá bớt document, nên nếu index trống thì nhắc chạy setup trước.
// Chỉ coi index_not_found là "chưa setup"; lỗi khác (sai API key...) phải nổi lên nguyên vẹn.
const stats = await index.getStats().catch((error) => {
  if (error.cause?.code === 'index_not_found') return null;
  throw error;
});
if (!stats || stats.numberOfDocuments === 0) {
  console.error(
    `Index "${config.indexUid}" ở ${config.host} chưa có dữ liệu. Chạy "npm run setup" trước.`,
  );
  process.exit(1);
}

console.log(`Meilisearch: ${config.host}   index: ${config.indexUid}   ${stats.numberOfDocuments} document`);

for (const step of steps) {
  await step.run();
}

console.log('\nXong 6 bước. Chạy "npm run setup" để nạp lại dữ liệu về trạng thái ban đầu.');
