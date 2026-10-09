// Khởi tạo client Meilisearch dùng chung cho mọi script.
//
// Lưu ý: từ phiên bản 0.60 của thư viện, class được export tên là `Meilisearch`
// (chữ "s" thường). Các bài viết cũ dùng `MeiliSearch` sẽ báo lỗi
// "does not provide an export named 'MeiliSearch'".
import { Meilisearch } from 'meilisearch';
import { config } from './config.js';

export const client = new Meilisearch({
  host: config.host,
  apiKey: config.apiKey,
});

export const index = client.index(config.indexUid);

/**
 * Chờ Meilisearch sẵn sàng. Hữu ích khi app khởi động cùng lúc với container
 * Meilisearch và server còn đang mở index.
 */
export async function waitForMeilisearch({ retries = 30, delayMs = 1000 } = {}) {
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    try {
      await client.health();
      return;
    } catch (error) {
      if (attempt === retries) {
        throw new Error(
          `Không kết nối được Meilisearch ở ${config.host} sau ${retries} lần thử: ${error.message}`,
          { cause: error },
        );
      }
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
}
