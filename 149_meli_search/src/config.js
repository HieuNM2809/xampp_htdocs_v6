// Cấu hình chung, đọc từ biến môi trường.
//
// Có file .env cạnh package.json thì nạp luôn. process.loadEnvFile() KHÔNG ghi đè biến
// đã tồn tại trong môi trường, nên biến truyền từ docker compose hay từ shell vẫn thắng.
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

const envFile = join(projectRoot, '.env');
if (existsSync(envFile)) {
  process.loadEnvFile(envFile);
}

export const config = {
  host: process.env.MEILI_HOST || 'http://localhost:7700',
  // Ví dụ chấp nhận cả hai tên để chạy được ngay sau khi copy .env.example.
  apiKey: process.env.MEILI_API_KEY || process.env.MEILI_MASTER_KEY || '',
  indexUid: process.env.MEILI_INDEX || 'products',
  dataFile: join(projectRoot, 'data', 'products.json'),
};
