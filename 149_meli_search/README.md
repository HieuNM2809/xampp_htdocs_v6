# Meilisearch với Node.js và Docker

Ví dụ chạy được về **Meilisearch** — một search engine mã nguồn mở viết bằng Rust, chạy từ một
container duy nhất. README đi lần lượt từng bước: tạo index, khai báo searchable / filterable /
sortable attributes, tìm kiếm cơ bản, typo tolerance, filter, facet, phân trang, highlight, xoá
document, rồi tới phần API key và bảo mật.

```
          Node.js app (meilisearch 0.62)
                 │  HTTP REST, cổng 7700
                 ▼
          ┌──────────────────────┐
          │   Meilisearch 1.54   │  một binary Rust, không JVM, không cụm
          │  index "products"    │  24 document mẫu
          └──────────┬───────────┘
                     │
            volume meili_data → /meili_data/data.ms   (LMDB, còn nguyên khi xoá container)

  Mini-dashboard để thử tay: http://localhost:7700  (chỉ bật khi MEILI_ENV=development)
```

Cần có: **Docker** (Docker Desktop trên Windows / macOS). Muốn chạy app Node ngoài container thì
thêm **Node.js >= 20.19**.

---

## Mục lục

1. [Chạy nhanh](#1-chạy-nhanh)
2. [Meilisearch là gì](#2-meilisearch-là-gì)
3. [Kiến trúc và các khái niệm chính](#3-kiến-trúc-và-các-khái-niệm-chính)
4. [So sánh với Elasticsearch và Algolia](#4-so-sánh-với-elasticsearch-và-algolia)
5. [Chạy bằng Docker](#5-chạy-bằng-docker)
6. [Bước 1: Tạo index, primary key và nạp dữ liệu](#6-bước-1-tạo-index-primary-key-và-nạp-dữ-liệu)
7. [Bước 2: Searchable, filterable, sortable attributes](#7-bước-2-searchable-filterable-sortable-attributes)
8. [Bước 3: Tìm kiếm cơ bản, typo tolerance, ranking rules](#8-bước-3-tìm-kiếm-cơ-bản-typo-tolerance-ranking-rules)
9. [Bước 4: Filter và sort](#9-bước-4-filter-và-sort)
10. [Bước 5: Faceted search](#10-bước-5-faceted-search)
11. [Bước 6: Phân trang](#11-bước-6-phân-trang)
12. [Bước 7: Highlight và crop](#12-bước-7-highlight-và-crop)
13. [Bước 8: Thêm, sửa, xoá document](#13-bước-8-thêm-sửa-xoá-document)
14. [Master key, API key và bảo mật](#14-master-key-api-key-và-bảo-mật)
15. [Cấu trúc thư mục](#15-cấu-trúc-thư-mục)
16. [Output mẫu](#16-output-mẫu)
17. [Kiểm thử](#17-kiểm-thử)
18. [Lưu ý khi đưa lên production](#18-lưu-ý-khi-đưa-lên-production)
19. [Xử lý sự cố](#19-xử-lý-sự-cố)
20. [Tham khảo](#20-tham-khảo)

---

## 1. Chạy nhanh

### Cách A — chạy tất cả trong Docker

```bash
cp .env.example .env     # Windows CMD: copy .env.example .env
docker compose up        # dựng Meilisearch, chờ healthcheck, rồi chạy app
```

App chạy hết 6 bước demo và thoát với mã 0; Meilisearch vẫn chạy tiếp ở foreground, bấm `Ctrl+C` để
dừng. Muốn compose tự dừng ngay khi app xong:

```bash
docker compose up --abort-on-container-exit --exit-code-from app
```

### Cách B — Meilisearch trong Docker, app chạy trên máy

Dễ sửa code và chạy lại hơn:

```bash
cp .env.example .env
npm install
npm run infra:up         # docker compose up -d meilisearch
npm run setup            # tạo index, khai báo settings, nạp 24 sản phẩm mẫu
npm run demo             # chạy 6 bước minh hoạ
```

Mở **http://localhost:7700** để thử tay trên Mini-dashboard. Khi được hỏi API key, dán giá trị
`MEILI_MASTER_KEY` trong `.env`.

Kiểm tra toàn bộ hành vi một cách tự động (53 check chạy trên Meilisearch thật):

```bash
npm run verify
```

Xem phần API key và tenant token (chạy ngay sau `npm run setup` để thấy rõ tác dụng của tenant token):

```bash
npm run keys
```

Dừng lại:

```bash
npm run infra:down       # giữ dữ liệu trong volume
npm run infra:clean      # docker compose down -v, xoá luôn dữ liệu
```

| Cổng | Thành phần |
|---|---|
| 7700 | Meilisearch: REST API và Mini-dashboard |

---

## 2. Meilisearch là gì

Meilisearch là một **search engine** — phần mềm chuyên lo việc "người dùng gõ vài chữ vào ô tìm kiếm
và mong thấy đúng thứ cần tìm". Nó không thay thế cơ sở dữ liệu; nó nhận một bản sao dữ liệu từ DB,
đánh chỉ mục lại theo kiểu riêng, và phục vụ truy vấn tìm kiếm nhanh hơn `LIKE '%...%'` rất nhiều.

Vì sao `LIKE` không đủ:

| Người dùng gõ | `LIKE '%...%'` | Meilisearch |
|---|---|---|
| `cerav` (thiếu chữ) | không ra gì | ra sản phẩm CeraVe, nhờ typo tolerance |
| `kem chong nang` (không dấu) | không ra gì | ra "Kem Chống Nắng", nhờ chuẩn hoá bỏ dấu |
| `srm` (viết tắt) | không ra gì | ra "Sữa Rửa Mặt", nhờ synonyms |
| `serum vitamin` | khớp chuỗi liên tục | khớp từng từ, xếp hạng theo độ liên quan |
| cần đếm "có bao nhiêu sản phẩm mỗi hãng" | `GROUP BY` thêm một query nữa | trả kèm ngay trong một lần gọi, nhờ facet |

Điểm riêng của Meilisearch so với các search engine khác:

- **Một binary, không phụ thuộc gì.** Viết bằng Rust, không cần JVM, không ZooKeeper, không cụm.
  Container khoảng 480 MB, `docker run` một dòng là chạy.
- **Mặc định đã hợp lý.** Typo tolerance, tìm theo tiền tố (search-as-you-type), bỏ dấu, xếp hạng
  theo độ liên quan — tất cả bật sẵn, không phải cấu hình analyzer.
- **API đơn giản.** Tham số JSON phẳng, không có query DSL nhiều tầng.
- **Mã nguồn mở, giấy phép MIT**, tự host thoải mái; hãng có bán thêm bản Cloud.

Đổi lại, Meilisearch **không** làm: aggregation phức tạp kiểu histogram / nested / pipeline, lưu trữ
log, join giữa các index, hay làm nguồn dữ liệu chính (nó là bản sao để tìm kiếm, mất thì nạp lại).

---

## 3. Kiến trúc và các khái niệm chính

### Cách Meilisearch vận hành

```
  ghi  ─► POST /indexes/products/documents ─► hàng đợi task ─► đánh chỉ mục ─► LMDB
          trả về ngay {"taskUid": 3}          (bất đồng bộ)                    data.ms
                                                                                 │
  đọc  ─► POST /indexes/products/search ──────────────────────────────────────► │
          trả về hits ngay (đồng bộ)                                             ▼
```

Một instance giữ nhiều **index**; mỗi index có settings và dữ liệu riêng, hoàn toàn độc lập. Dữ liệu
nằm trong LMDB (qua thư viện `heed`) ở thư mục `/meili_data/data.ms`.

Điểm dễ vấp nhất với người mới: **mọi thao tác ghi đều bất đồng bộ**. `addDocuments` trả về ngay một
`taskUid`, dữ liệu chưa chắc đã tìm được. Thư viện Node cho sẵn `.waitTask()` để chờ:

```js
const task = await index.addDocuments(documents).waitTask();
console.log(task.status); // "succeeded" hoặc "failed"
```

### Các khái niệm

| Khái niệm | Là gì | Trong ví dụ này |
|---|---|---|
| **Index** | Một tập document cùng loại, có settings riêng. Tương đương một bảng. | `products` |
| **Document** | Một bản ghi JSON. Không cần khai báo schema trước. | Một sản phẩm mỹ phẩm |
| **Primary key** | Trường định danh duy nhất của document. Không khai báo thì Meilisearch tự tìm trường tên `id` hoặc kết thúc bằng `Id`. Đã đặt rồi thì không đổi được, phải tạo lại index. | `id` |
| **Searchable attributes** | Các trường được đánh chỉ mục để tìm. **Thứ tự chính là độ ưu tiên**: khớp ở trường đứng trước được xếp hạng cao hơn. | `name` → `brand` → `category` → `tags` → `description` |
| **Filterable attributes** | Các trường dùng được trong `filter` và trong `facets`. Không khai báo thì lọc sẽ báo lỗi `invalid_search_filter`. | `brand`, `category`, `tags`, `price`, `rating`, `inStock`, `releaseYear` |
| **Sortable attributes** | Các trường dùng được trong `sort`. Khai báo thừa làm index to thêm và chậm đi. | `price`, `rating`, `reviewCount` |
| **Displayed attributes** | Các trường được trả về trong kết quả. Mặc định `["*"]`. | mặc định |
| **Ranking rules** | Chuỗi tiêu chí xếp hạng, áp dụng lần lượt; tiêu chí sau chỉ phân xử khi tiêu chí trước hoà. | 7 rule mặc định + `rating:desc` |
| **Typo tolerance** | Cho phép gõ sai vài ký tự. Ngưỡng theo độ dài từ. | sai 1 ký tự từ 4 ký tự, sai 2 từ 8 ký tự |
| **Faceted search** | Trả kèm số lượng kết quả theo từng nhóm, để dựng bộ lọc có số đếm. | `brand`, `category`, `tags` |
| **Stop words** | Những từ quá phổ biến, bỏ qua khi tìm. | `và`, `cho`, `của`, `với` |
| **Synonyms** | Các từ coi như tương đương nhau. | `srm` ↔ `sữa rửa mặt` |
| **Task** | Một thao tác ghi đang hoặc đã chạy, có `uid` và `status`. | xem `GET /tasks` |

### Ranking rules

Mặc định của Meilisearch 1.54 gồm 7 rule, chạy theo đúng thứ tự này:

| # | Rule | Ưu tiên document nào |
|---|---|---|
| 1 | `words` | khớp được nhiều từ trong query hơn |
| 2 | `typo` | sai chính tả ít hơn |
| 3 | `proximity` | các từ khớp nằm gần nhau hơn |
| 4 | `attributeRank` | khớp ở searchable attribute đứng trước trong danh sách |
| 5 | `sort` | theo tham số `sort` của query (nếu có) |
| 6 | `wordPosition` | từ khớp nằm gần đầu trường hơn |
| 7 | `exactness` | khớp nguyên từ, không phải chỉ khớp tiền tố |

> Bản Meilisearch cũ gộp `attributeRank` và `wordPosition` thành một rule tên `attribute`. Tên cũ vẫn
> được chấp nhận, nhưng nên dùng tên mới.

Thêm **custom ranking rule** dạng `<trường>:asc` hoặc `<trường>:desc` để chen tiêu chí riêng vào.
Trong [`src/setup.js`](src/setup.js), `rating:desc` được đặt ở cuối, nên nó chỉ phân xử khi mọi tiêu
chí liên quan đã hoà — đúng ý "cùng độ liên quan thì hàng được đánh giá cao lên trước". Đặt nó lên
trên `words` thì ngược lại: sản phẩm rating cao luôn đứng đầu dù chẳng liên quan gì tới từ khoá.

---

## 4. So sánh với Elasticsearch và Algolia

| | Meilisearch | Elasticsearch / OpenSearch | Algolia |
|---|---|---|---|
| Mô hình | Mã nguồn mở (MIT), tự host hoặc Cloud của hãng | Nguồn mở có điều kiện (AGPL v3 / SSPL / Elastic License; OpenSearch là Apache 2.0) | SaaS đóng, chỉ dùng dịch vụ |
| Công sức vận hành | Một container, không cấu hình bắt buộc | Cụm JVM: heap, node, shard, replica | Không có gì để vận hành |
| Thiên về | Tìm kiếm cho người dùng cuối | Tìm kiếm + log + metric + phân tích | Tìm kiếm cho người dùng cuối |
| Typo tolerance | Bật sẵn | Tự cấu hình `fuzziness` | Bật sẵn |
| Truy vấn | Tham số JSON phẳng | Query DSL nhiều tầng, rất mạnh | Tham số JSON phẳng |
| Aggregation | Chỉ facet và facetStats | Đầy đủ: histogram, nested, pipeline… | Chỉ facet |
| Quy mô dữ liệu | Hợp từ vài nghìn tới vài chục triệu document trên một máy | Hàng tỷ document, chia nhiều node | Theo gói dịch vụ |
| Chi phí | Tiền hạ tầng | Tiền hạ tầng, cụm ăn nhiều RAM | Trả theo số request và số bản ghi |

### Nên chọn gì

**Chọn Meilisearch khi** cần một ô tìm kiếm cho người dùng cuối — sản phẩm, bài viết, tài liệu nội bộ
— với dữ liệu cỡ vài nghìn tới vài triệu document, muốn dựng xong trong một buổi và không muốn nuôi
một cụm Elasticsearch. Đây là trường hợp phổ biến nhất của các site thương mại điện tử cỡ vừa.

**Chọn Elasticsearch / OpenSearch khi** cần aggregation phức tạp, gom log và metric, dữ liệu lớn tới
mức phải chia shard trên nhiều node, hoặc cần can thiệp sâu vào analyzer và công thức tính điểm.

**Chọn Algolia khi** không muốn vận hành bất cứ hạ tầng nào, cần hạ tầng toàn cầu có sẵn, và chấp
nhận chi phí tăng theo lưu lượng.

**Chưa cần search engine nào cả khi** dữ liệu chỉ vài nghìn dòng và `LIKE` hoặc full-text index của
MySQL / PostgreSQL vẫn đáp ứng được. Thêm một thành phần hạ tầng là thêm một thứ phải đồng bộ, phải
sao lưu, phải theo dõi.

---

## 5. Chạy bằng Docker

### Chạy nhanh nhất, không cần file nào

```bash
docker run -d --name meilisearch \
  -p 7700:7700 \
  -e MEILI_MASTER_KEY=MASTER_KEY_DEMO_DOI_TRUOC_KHI_LEN_PROD \
  -e MEILI_ENV=development \
  -v meili_data:/meili_data \
  getmeili/meilisearch:v1.54.3
```

Kiểm tra:

```bash
curl http://localhost:7700/health
# {"status":"available"}
```

### docker-compose.yml của ví dụ

[`docker-compose.yml`](docker-compose.yml) khai báo hai service:

```yaml
services:
  meilisearch:
    image: getmeili/meilisearch:v1.54.3
    environment:
      MEILI_MASTER_KEY: ${MEILI_MASTER_KEY:-MASTER_KEY_DEMO_DOI_TRUOC_KHI_LEN_PROD}
      MEILI_ENV: ${MEILI_ENV:-development}
      MEILI_NO_ANALYTICS: "true"
      MEILI_LOG_LEVEL: ${MEILI_LOG_LEVEL:-WARN}
    ports:
      - "7700:7700"
    volumes:
      - meili_data:/meili_data
    healthcheck:
      test: ["CMD", "curl", "-fsS", "http://localhost:7700/health"]

  app:
    build: .
    depends_on:
      meilisearch:
        condition: service_healthy    # chờ healthcheck PASS rồi mới chạy
    environment:
      MEILI_HOST: http://meilisearch:7700   # tên service = tên host trong mạng compose
```

Ba điểm đáng chú ý:

- **Volume `meili_data:/meili_data`.** Meilisearch ghi vào `/meili_data`, bên trong có `data.ms/`
  (dữ liệu) và `dumps/`. Không mount volume thì xoá container là mất sạch index. Với volume,
  `docker compose down` rồi `up` lại vẫn còn nguyên dữ liệu; chỉ `docker compose down -v` mới xoá.
- **`condition: service_healthy`.** Meilisearch mất vài giây để mở index. Không chờ thì app Node
  chạy trước và chết vì `ECONNREFUSED`. Image dựa trên Alpine và có sẵn `curl` nên healthcheck
  dùng thẳng `curl` được.
- **`MEILI_NO_ANALYTICS: "true"`.** Mặc định Meilisearch gửi số liệu sử dụng ẩn danh về hãng. Biến
  này tắt hẳn.
- **`MEILI_LOG_LEVEL: WARN`.** Mức mặc định `INFO` ghi một dòng cho *mỗi* request HTTP, chạy
  `docker compose up` là log của Meilisearch lấp hết output của app. Cần soi thì đặt
  `MEILI_LOG_LEVEL=DEBUG` trong `.env`.

### Các biến môi trường hay dùng

| Biến | Mặc định | Ý nghĩa |
|---|---|---|
| `MEILI_MASTER_KEY` | không có | Khoá toàn quyền. Bắt buộc khi `MEILI_ENV=production`, tối thiểu 16 byte |
| `MEILI_ENV` | `development` | `development` bật Mini-dashboard ở `/`; `production` tắt nó và siết master key |
| `MEILI_DB_PATH` | `/meili_data/data.ms` | Nơi ghi dữ liệu |
| `MEILI_NO_ANALYTICS` | `false` | `true` để không gửi số liệu về hãng |
| `MEILI_HTTP_ADDR` | `0.0.0.0:7700` | Địa chỉ lắng nghe |
| `MEILI_MAX_INDEXING_MEMORY` | 2/3 RAM máy | Trần RAM cho việc đánh chỉ mục |
| `MEILI_LOG_LEVEL` | `INFO` | `INFO` ghi một dòng cho **mỗi** request HTTP nên rất nhiễu; ví dụ này đặt `WARN`. `DEBUG` khi cần soi |

### Các lệnh Docker cần thiết

```bash
docker compose up -d meilisearch      # chỉ bật Meilisearch
docker compose up                     # bật Meilisearch rồi chạy app (Ctrl+C để dừng sau khi app xong)
docker compose up --abort-on-container-exit --exit-code-from app   # tự dừng khi app xong
docker compose run --rm app npm run demo     # chạy lại riêng phần demo trong container
docker compose ps                     # xem trạng thái, cột STATUS hiện (healthy)
docker compose logs -f meilisearch    # xem log
docker compose down                   # dừng, GIỮ dữ liệu trong volume
docker compose down -v                # dừng và XOÁ luôn volume
docker volume ls | grep meili         # kiểm tra volume còn không
```

### Giao diện web

Mở **http://localhost:7700** khi `MEILI_ENV=development`: đó là **Mini-dashboard**, gõ API key vào
rồi chọn index là thử truy vấn ngay được, thấy luôn JSON trả về. Rất tiện để đối chiếu với kết quả
mà code in ra.

Khi `MEILI_ENV=production`, địa chỉ đó chỉ trả về JSON:

```json
{"status":"Meilisearch is running"}
```

Đây là hành vi cố ý: Mini-dashboard không có trên production.

---

## 6. Bước 1: Tạo index, primary key và nạp dữ liệu

Cài thư viện chính thức:

```bash
npm install meilisearch@^0.62.0
```

> Thư viện này **chỉ có bản ESM**. Dự án phải đặt `"type": "module"` trong `package.json` và dùng
> `import`. Và từ bản 0.60, class được export tên là `Meilisearch` (chữ `s` thường) — code cũ viết
> `MeiliSearch` sẽ báo `does not provide an export named 'MeiliSearch'`.

[`src/client.js`](src/client.js):

```js
import { Meilisearch } from 'meilisearch';

export const client = new Meilisearch({
  host: config.host,     // http://localhost:7700
  apiKey: config.apiKey, // master key, hoặc API key hẹp quyền hơn
});

export const index = client.index(config.indexUid);
```

`client.index(uid)` chỉ tạo một đối tượng trong bộ nhớ, không gọi mạng. Index thật được tạo ở bước
sau (hoặc tự sinh ra khi lần đầu thêm document).

[`src/setup.js`](src/setup.js) làm 4 việc:

```js
// 1. Xoá index cũ để script chạy lại được nhiều lần.
//    Xoá index không tồn tại vẫn được NHẬN (HTTP 202) — lỗi chỉ lộ ra ở kết quả task.
const deleteTask = await client.deleteIndex(uid).waitTask();
deleteTask.status === 'succeeded'   // false kèm error.code = "index_not_found" nếu chưa có

// 2. Tạo index và chốt primary key.
await client.createIndex(uid, { primaryKey: 'id' }).waitTask();

// 3. Khai báo settings (xem mục 7).
await index.updateSettings(settings).waitTask();

// 4. Nạp dữ liệu từ data/products.json.
const task = await index.addDocuments(documents).waitTask();
task.details.indexedDocuments   // 24
```

Vài điểm cần nhớ:

- **Primary key chốt một lần.** Đã đặt rồi thì muốn đổi phải xoá và tạo lại index. Không chỉ định thì
  Meilisearch tự tìm trường tên `id` hoặc có hậu tố `Id`; không tìm thấy thì task nạp dữ liệu hỏng.
- **Khai báo settings trước khi nạp dữ liệu lớn.** Mỗi lần đổi settings là Meilisearch đánh chỉ mục
  lại toàn bộ index.
- **`client.deleteIndexIfExists()` luôn trả về `true`**, kể cả khi index không tồn tại — nó chỉ chờ
  bước *nhận* task chứ không chờ task chạy xong. Muốn biết thật sự có xoá được không thì
  `.waitTask()` rồi xem `task.status` như trên.
- **Dữ liệu lớn thì chia lô**: `index.addDocumentsInBatches(documents, 10000)` trả về một mảng
  `EnqueuedTaskPromise`, chờ cả mảng bằng `client.tasks.waitForTasks(...)`.

Dữ liệu mẫu nằm ở [`data/products.json`](data/products.json) — 24 sản phẩm mỹ phẩm:

```json
{
  "id": 1,
  "name": "Sữa Rửa Mặt CeraVe Sạch Sâu Cho Da Thường Đến Da Dầu 473ml",
  "brand": "CeraVe",
  "category": "Sữa rửa mặt",
  "description": "Gel rửa mặt chứa 3 loại ceramide thiết yếu và niacinamide, …",
  "price": 385000,
  "rating": 4.8,
  "reviewCount": 1243,
  "inStock": true,
  "tags": ["da dầu", "làm sạch sâu", "không hương liệu", "ceramide"],
  "releaseYear": 2019
}
```

Chạy:

```bash
npm run setup
```

```
Meilisearch: http://localhost:7700   index: products
Đã kết nối, server phiên bản 1.54.3
1. Đã xoá index cũ
2. Đã tạo index "products" (primary key: id, task #67)
3. Đã cập nhật settings (task #68, PT0.020537542S)
4. Đã nạp 24/24 document (task #69, PT0.105960199S)
   Index đang giữ 24 document, 245760 byte trên đĩa
```

---

## 7. Bước 2: Searchable, filterable, sortable attributes

Ba danh sách này quyết định index làm được gì. Khai báo trong một lần gọi `updateSettings`
([`src/setup.js`](src/setup.js)):

```js
await index.updateSettings({
  // Trường nào được tìm, và THỨ TỰ ưu tiên khi xếp hạng.
  searchableAttributes: ['name', 'brand', 'category', 'tags', 'description'],

  // Trường nào dùng được trong filter và facets.
  filterableAttributes: ['brand', 'category', 'tags', 'price', 'rating', 'inStock', 'releaseYear'],

  // Trường nào dùng được trong sort.
  sortableAttributes: ['price', 'rating', 'reviewCount'],
}).waitTask();
```

| | Không khai báo thì | Khai báo thừa thì |
|---|---|---|
| `searchableAttributes` | Trường đó không tìm được, nhưng vẫn trả về trong kết quả | Index to hơn, và nhiễu: khớp ở `description` cũng được tính |
| `filterableAttributes` | `filter` ném `invalid_search_filter` kèm danh sách trường hợp lệ | Index to hơn, nạp dữ liệu chậm hơn |
| `sortableAttributes` | `sort` ném `invalid_search_sort` | Index to hơn, nạp dữ liệu chậm hơn |

Giá trị mặc định của một index mới:

```
searchableAttributes  ["*"]     mọi trường đều tìm được
displayedAttributes   ["*"]     mọi trường đều được trả về
filterableAttributes  []        KHÔNG trường nào lọc được
sortableAttributes    []        KHÔNG trường nào sắp xếp được
```

Nghĩa là tìm kiếm chạy ngay không cần cấu hình gì, còn filter và sort thì **luôn** phải khai báo tay.

Đặt `name` đứng đầu `searchableAttributes` là có chủ ý: sản phẩm có từ khoá trong **tên** sẽ được xếp
trên sản phẩm chỉ có từ khoá trong **mô tả**. Đó là việc của ranking rule `attributeRank`.

Khai báo chi tiết hơn cũng được, khi cần bật tắt riêng từng tính năng cho từng nhóm trường:

```js
filterableAttributes: [
  'brand',
  {
    attributePatterns: ['price', 'rating'],
    features: { facetSearch: false, filter: { equality: true, comparison: true } },
  },
],
```

Các settings khác dùng trong ví dụ:

```js
typoTolerance: {
  enabled: true,
  minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 },  // mặc định là 5 và 9
},
faceting: {
  maxValuesPerFacet: 20,                 // mặc định 100
  sortFacetValuesBy: { '*': 'count' },   // mặc định 'alpha'
},
pagination: { maxTotalHits: 1000 },      // cũng là mặc định
stopWords: ['và', 'cho', 'của', 'với'],
synonyms: {
  srm: ['sữa rửa mặt'],
  kcn: ['kem chống nắng'],
  sunscreen: ['chống nắng'],
},
```

---

## 8. Bước 3: Tìm kiếm cơ bản, typo tolerance, ranking rules

Xem [`src/steps/01-basic-search.js`](src/steps/01-basic-search.js). Dạng gọn nhất:

```js
const result = await index.search('kem chống nắng', { limit: 3 });
result.hits;                // mảng document
result.estimatedTotalHits;  // 9
result.processingTimeMs;    // 2
```

### Bỏ dấu

Meilisearch chuẩn hoá và bỏ dấu khi đánh chỉ mục, nên gõ không dấu vẫn ra đúng kết quả:

```js
await index.search('kem chong nang');   // cùng danh sách hit với 'kem chống nắng'
```

Rất đáng kể với tiếng Việt: người dùng gõ nhanh trên điện thoại gần như luôn bỏ dấu.

### matchingStrategy

Mặc định là `"last"`: nếu không đủ kết quả khớp hết mọi từ, Meilisearch bỏ dần các từ **cuối** câu
cho tới khi có kết quả. Vì vậy `"kem chống nắng"` ra 9 hit, trong đó có cả những sản phẩm chỉ khớp
chữ "kem".

```js
await index.search('kem chống nắng');                             // 9 hit
await index.search('kem chống nắng', { matchingStrategy: 'all' }); // 4 hit, bắt buộc khớp đủ
```

Dùng `"last"` cho ô tìm kiếm thông thường (thà ra kết quả gần đúng còn hơn trả về trang trắng), dùng
`"all"` khi truy vấn do hệ thống sinh ra và cần chính xác.

### Typo tolerance

Ngưỡng theo độ dài từ. Với `minWordSizeForTypos: { oneTypo: 4, twoTypos: 8 }`:

```js
await index.search('cerav');       // ra CeraVe
await index.search('niacinamid');  // ra serum Niacinamide
await index.search('tonr');        // 4 ký tự, sai 1 → vẫn ra Toner
await index.search('tnr');         // 3 ký tự → 0 hit, dưới ngưỡng nên không được tha
```

Tắt typo cho những trường không nên đoán mò — mã sản phẩm, SKU, mã đơn:

```js
typoTolerance: {
  disableOnAttributes: ['sku'],
  disableOnWords: ['CeraVe'],
  disableOnNumbers: true,
}
```

Typo tolerance có mặt trái: tìm `"lỗ chân lông"` thì `"cân bằng"` và `"tinh chất"` cũng có thể được
tính là khớp, vì `chân` ↔ `chất` ↔ `cân` chỉ lệch một ký tự. Thấy highlight ra những chỗ lạ thì
thường là vì lý do này.

### Synonyms và stop words

```js
await index.search('srm');   // 4 hit sữa rửa mặt
await index.search('kcn');   // 4 hit kem chống nắng

// "cho" nằm trong stopWords nên bị bỏ qua, hai query dưới đây cho cùng kết quả:
await index.search('kem dưỡng cho da khô');
await index.search('kem dưỡng da khô');
```

### Lấy ít trường cho nhẹ

```js
await index.search('serum', {
  limit: 20,
  attributesToRetrieve: ['id', 'name', 'price'],  // chỉ lấy 3 trường
});
```

Query rỗng `index.search('')` trả về toàn bộ index theo thứ tự ranking mặc định — dùng để hiện danh
sách lúc người dùng chưa gõ gì.

---

## 9. Bước 4: Filter và sort

Xem [`src/steps/02-filter.js`](src/steps/02-filter.js).

### Cú pháp filter

Toán tử: `=` `!=` `>` `>=` `<` `<=` `TO` `IN` `EXISTS` `IS EMPTY` `IS NULL` `NOT` `AND` `OR`, kèm
ngoặc đơn.

```js
// Chuỗi, viết thẳng như SQL
await index.search('', { filter: 'category = "Serum" AND price < 300000' });

// TO là khoảng ĐÓNG hai đầu: gồm cả 300000 lẫn 500000
await index.search('kem', { filter: ['price 300000 TO 500000', 'inStock = true'] });

// Mảng = AND. Mảng lồng trong mảng = OR.
// → (brand = CeraVe OR brand = Bioderma) AND rating >= 4.5
await index.search('', {
  filter: [['brand = "CeraVe"', 'brand = "Bioderma"'], 'rating >= 4.5'],
});

// IN gọn hơn khi so nhiều giá trị của cùng một trường. Chạy được trên cả trường mảng.
await index.search('', { filter: 'tags IN ["da mụn", "da dầu"] AND rating > 4.4' });
```

Filter **không** tham gia vào việc tính điểm — nó chỉ cắt bớt tập kết quả, nên rất nhanh.

### Sort

```js
await index.search('', { sort: ['price:asc'] });                  // rẻ nhất trước
await index.search('', { sort: ['rating:desc', 'price:asc'] });   // nhiều cấp
```

`sort` của query và ranking rule `sort` liên quan với nhau: rule `sort` nằm ở vị trí thứ 5 trong danh
sách mặc định, nên bốn tiêu chí độ liên quan phía trên (`words`, `typo`, `proximity`,
`attributeRank`) vẫn được xét trước. Muốn "sắp xếp theo giá, chấm hết" thì đẩy `sort` lên đầu
`rankingRules`.

Lỗi hay gặp:

```js
await index.search('', { filter: 'description = "x"' });
// MeilisearchApiError, cause.code = "invalid_search_filter"
// "Attribute `description` is not filterable. Available filterable attribute patterns are: …"

await index.search('', { sort: ['brand:asc'] });
// cause.code = "invalid_search_sort"
```

Cách bắt lỗi:

```js
import { MeilisearchApiError } from 'meilisearch';

try {
  await index.search(q, { filter });
} catch (error) {
  if (error instanceof MeilisearchApiError && error.cause.code === 'invalid_search_filter') {
    // filter do người dùng dựng bị sai → trả 400 chứ không phải 500
  }
  throw error;
}
```

---

## 10. Bước 5: Faceted search

Xem [`src/steps/03-facet.js`](src/steps/03-facet.js). Facet là cái cột bộ lọc bên trái mọi trang
danh mục thương mại điện tử: *Thương hiệu — CeraVe (2), Bioderma (2)…*

```js
const result = await index.search('', {
  facets: ['brand', 'category', 'tags'],
  limit: 0,   // chỉ cần số đếm, không cần hit
});

result.facetDistribution.category;
// { "Serum": 7, "Sữa rửa mặt": 4, "Kem dưỡng": 4, "Tẩy trang": 3, ... }
```

Trường dùng trong `facets` bắt buộc phải nằm trong `filterableAttributes`.

### facetStats cho trường số

```js
const result = await index.search('', { facets: ['price', 'rating'], limit: 0 });
result.facetStats;
// { price: { min: 185000, max: 1150000 }, rating: { min: 4.2, max: 4.9 } }
```

Vừa đủ để dựng thanh kéo chọn khoảng giá mà không phải query riêng.

### Điểm quan trọng nhất: facet được tính trên tập đã lọc

```js
const result = await index.search('', {
  filter: 'category = "Serum"',
  facets: ['brand'],
  limit: 0,
});
result.facetDistribution.brand;
// { "The Ordinary": 3, "Vichy": 1, "Paula's Choice": 1, "Klairs": 1, "Cocoon": 1 }
// Anessa biến mất — hãng này không có serum nào.
```

Nhờ vậy người dùng không bao giờ bấm trúng một bộ lọc rồi nhận về trang trắng.

> Muốn đếm *tất cả* giá trị của một facet trong khi vẫn lọc theo facet khác (kiểu "vẫn thấy mọi hãng
> dù đang lọc hãng"), dùng `client.multiSearch()` với nhiều query: một query lấy hit, một query lấy
> facet không kèm filter của chính facet đó.

### searchForFacetValues

Khi một facet có hàng trăm giá trị, thêm ô "tìm trong bộ lọc":

```js
const result = await index.searchForFacetValues({ facetName: 'brand', facetQuery: 'cera' });
result.facetHits;   // [{ value: 'CeraVe', count: 2 }]
```

---

## 11. Bước 6: Phân trang

Xem [`src/steps/04-pagination.js`](src/steps/04-pagination.js). Meilisearch có **hai kiểu**, chọn sai
là giao diện hiển thị sai.

### Kiểu 1 — `offset` / `limit`

```js
const result = await index.search('', { offset: 10, limit: 5 });
result.estimatedTotalHits;  // 24 — ƯỚC TÍNH
result.totalPages;          // undefined
```

Nhanh, vì Meilisearch không phải đếm hết. Nhưng chỉ có con số **ước tính**, không có tổng số trang.
Hợp với nút "Xem thêm" và cuộn vô hạn.

### Kiểu 2 — `page` / `hitsPerPage`

```js
const result = await index.search('', { page: 2, hitsPerPage: 10 });
result.totalHits;   // 24 — CHÍNH XÁC
result.totalPages;  // 3
result.page;        // 2
```

Chậm hơn một chút vì phải đếm thật, đổi lại hiện được "Trang 2 / 3" và dãy số trang.

| | `offset` / `limit` | `page` / `hitsPerPage` |
|---|---|---|
| Tổng số hit | `estimatedTotalHits` (ước tính) | `totalHits` (chính xác) |
| Tổng số trang | không có | `totalPages` |
| Tốc độ | nhanh hơn | chậm hơn chút |
| Hợp với | "Xem thêm", cuộn vô hạn | dãy số trang |

Hai kiểu **không trộn được** trong cùng một query.

### Trần phân trang

Settings `pagination.maxTotalHits` (mặc định 1000) chặn không cho đi quá sâu. Xin trang vượt quá thì
nhận mảng rỗng chứ không phải lỗi:

```js
const result = await index.search('', { page: 99, hitsPerPage: 10 });
result.hits;   // []
```

Trần này có lý do: đi tới trang 50.000 vừa vô nghĩa với người dùng vừa là cách dễ nhất để bot rút
sạch dữ liệu. Nâng nó lên thì đổi `pagination.maxTotalHits` trong settings.

---

## 12. Bước 7: Highlight và crop

Xem [`src/steps/05-highlight.js`](src/steps/05-highlight.js). Meilisearch trả thêm trường
`_formatted` cho mỗi hit; **trường gốc giữ nguyên**, không bị chèn thẻ.

```js
const result = await index.search('cerave', { attributesToHighlight: ['name'] });

result.hits[0].name;
// "Kem Dưỡng Ẩm CeraVe Moisturising Cream 454g"
result.hits[0]._formatted.name;
// "Kem Dưỡng Ẩm <em>CeraVe</em> Moisturising Cream 454g"
```

Mặc định bọc bằng `<em>`. Đổi được:

```js
await index.search('hyaluronic acid', {
  attributesToHighlight: ['name', 'description'],
  highlightPreTag: '<mark class="hl">',
  highlightPostTag: '</mark>',
});
```

> Nhớ escape HTML ở phía frontend trước khi render `_formatted`, nếu không thì nội dung document trở
> thành một đường XSS. An toàn hơn: dùng cặp thẻ không phải HTML (ví dụ `«` và `»`) rồi tự thay bằng
> phần tử DOM, hoặc dùng `_matchesPosition` ở dưới.

### Crop

Mô tả dài thì cắt lấy đoạn quanh từ khoá thay vì in cả đoạn:

```js
await index.search('salicylic acid', {
  attributesToCrop: ['description'],
  cropLength: 12,     // số từ giữ lại
  cropMarker: '…',    // mặc định cũng là '…'
});
// "Dung dịch salicylic acid 2% tan trong dầu, len vào lỗ chân…"
```

### showMatchesPosition

Muốn tự dựng giao diện highlight mà không nhận chuỗi có thẻ:

```js
const result = await index.search('vitamin', { showMatchesPosition: true });
result.hits[0]._matchesPosition;
// {
//   "name":        [{ "start": 28, "length": 7 }],
//   "description": [{ "start": 12, "length": 7 }],
//   "tags":        [{ "start": 0,  "length": 7, "indices": [0] }]
// }
```

`start` và `length` tính theo **byte**, không phải ký tự — với tiếng Việt có dấu, cắt chuỗi theo con
số này trong JavaScript phải chuyển qua `Buffer` hoặc `TextEncoder` trước.

---

## 13. Bước 8: Thêm, sửa, xoá document

Xem [`src/steps/06-documents.js`](src/steps/06-documents.js).

```js
// Thêm, hoặc GHI ĐÈ toàn bộ document trùng primary key.
await index.addDocuments([{ id: 99, name: 'Serum Demo', price: 199000, /* … */ }]).waitTask();

// Chỉ cập nhật các trường được gửi, giữ nguyên phần còn lại.
await index.updateDocuments([{ id: 99, price: 149000 }]).waitTask();

// Đọc một document theo primary key.
await index.getDocument(99);

// Xoá một document.
const task = await index.deleteDocument(99).waitTask();
task.details.deletedDocuments;   // 1

// Xoá nhiều document theo danh sách id.
await index.deleteDocuments([1, 2, 3]).waitTask();

// Xoá theo filter — trường phải nằm trong filterableAttributes.
await index.deleteDocuments({ filter: 'inStock = false' }).waitTask();

// Xoá sạch, giữ lại index và settings.
await index.deleteAllDocuments().waitTask();
```

Khác nhau giữa `addDocuments` và `updateDocuments`:

| | `addDocuments` | `updateDocuments` |
|---|---|---|
| Document chưa có | tạo mới | tạo mới |
| Document đã có | **ghi đè toàn bộ**, trường không gửi sẽ mất | chỉ ghi trường được gửi |
| Dùng khi | đồng bộ lại cả bản ghi từ DB | cập nhật lẻ một vài trường, ví dụ giá hay tồn kho |

Đọc một document đã xoá thì thư viện ném lỗi:

```js
try {
  await index.getDocument(99);
} catch (error) {
  error.cause.code;   // "document_not_found"
}
```

Kết quả chạy:

```
addDocuments: thêm 1 sản phẩm mới (id = 99)
  task #14 succeeded, indexedDocuments=1
  getDocument(99) → Serum Demo Để Xoá 30ml, 199.000đ

updateDocuments: chỉ đổi price, các trường khác giữ nguyên
  → Serum Demo Để Xoá 30ml, 149.000đ (name vẫn còn, rating = 3.9)

deleteDocument(99): xoá theo primary key
  task #16 succeeded, deletedDocuments=1
  getDocument(99) → ném lỗi document_not_found

deleteDocuments({ filter }): xoá mọi sản phẩm hết hàng
  sắp xoá 1: #5 Nước Tẩy Trang La Roche-Posay Micellar Water Ultra 400ml
  task #17 succeeded, deletedDocuments=1
```

---

## 14. Master key, API key và bảo mật

Xem [`src/keys.js`](src/keys.js), chạy bằng `npm run keys`.

### Master key

Master key đặt qua `MEILI_MASTER_KEY` lúc khởi động. Nó **toàn quyền** trên instance: đọc, ghi, xoá
index, tạo và huỷ API key.

```bash
# Sinh một khoá đủ mạnh
openssl rand -base64 32
```

Hành vi phụ thuộc `MEILI_ENV`:

| | `MEILI_ENV=development` | `MEILI_ENV=production` |
|---|---|---|
| Master key | không bắt buộc; không đặt thì **API mở toang** | **bắt buộc**, tối thiểu 16 byte |
| Mini-dashboard ở `/` | có | không, chỉ trả JSON `{"status":"Meilisearch is running"}` |

Thiếu master key ở chế độ production thì Meilisearch **không khởi động**, và tiện tay sinh sẵn cho
một khoá hợp lệ:

```
Error: You must provide a master key to secure your instance in a production environment.
We generated a new secure master key for you (you can safely use this token):
>> --master-key heqJxxQvoVUGp8dOeN-9folz5jRiR_C_tvWaPFKGjkI <<
```

Khoá ngắn hơn 16 byte cũng bị từ chối với thông báo tương tự.

### API key

Ngay lần chạy đầu có master key, Meilisearch tự sinh 4 key mặc định:

```
Default Search API Key           actions=["search"]                  indexes=["*"]
Default Admin API Key            actions=["*"]                       indexes=["*"]
Default Read-Only Admin API Key  actions=["*.get","keys.get"]        indexes=["*"]
Default Chat API Key             actions=["chatCompletions","search"] indexes=["*"]
```

Master key **không** nằm trong danh sách này và không đọc lại được qua API — mất là phải khởi động
lại instance với khoá khác.

Tạo key hẹp quyền cho từng nơi dùng:

```js
const searchKey = await client.createKey({
  name: 'Frontend search key',
  description: 'Chỉ search trên index products',
  actions: ['search'],              // chỉ hành động này
  indexes: ['products'],            // chỉ index này
  expiresAt: new Date(Date.now() + 3600_000),   // null = không hết hạn
});
searchKey.key;   // chuỗi để gửi kèm header Authorization
searchKey.uid;   // định danh để update / delete key
```

Key đó search được nhưng ghi thì bị chặn:

```
search → OK, 7 hit
addDocuments → bị chặn: invalid_api_key
```

> Kiểu TypeScript khai báo `Key.expiresAt` là `Date`, nhưng lúc chạy API trả về **chuỗi** RFC3339.
> Gọi `.toISOString()` lên nó sẽ ném `TypeError`.

### Tenant token: mỗi người dùng chỉ thấy phần của mình

Khi nhiều khách hàng dùng chung một index, tenant token nhúng sẵn filter vào một JWT ký bằng API key.
Client cầm token nhưng không gỡ được filter ra:

```js
import { generateTenantToken } from 'meilisearch/token';

const token = await generateTenantToken({
  apiKey: searchKey.key,
  apiKeyUid: searchKey.uid,
  searchRules: { products: { filter: 'inStock = true' } },
  expiresAt: new Date(Date.now() + 3600_000),
});

// Client dùng token này thay cho API key, và chỉ thấy phần dữ liệu đã bị ép filter.
const tenant = new Meilisearch({ host, apiKey: token });
await tenant.index('products').search('');   // 23 hit, thay vì 24
```

**Luôn sinh tenant token ở backend.** Sinh ở trình duyệt là lộ API key dùng để ký.

### Danh sách kiểm tra trước khi lên production

- [ ] `MEILI_ENV=production` và `MEILI_MASTER_KEY` >= 16 byte, sinh bằng `openssl rand -base64 32`.
- [ ] Master key nằm trong secret manager (Vault, AWS Secrets Manager, Docker secret…), **không**
      nằm trong Git, không nằm trong image.
- [ ] Frontend chỉ cầm **search-only key**, phạm vi đúng một index. Không bao giờ nhúng master key
      hay admin key vào JavaScript phía client.
- [ ] Backend dùng admin key riêng, không dùng master key cho việc hằng ngày.
- [ ] Cổng 7700 **không** mở ra Internet. Đặt sau reverse proxy có TLS, hoặc chỉ cho truy cập trong
      mạng nội bộ. Trong compose, bỏ hẳn phần `ports` nếu chỉ có service khác trong cùng mạng gọi tới.
- [ ] Rate limit ở tầng proxy — endpoint search không có hạn mức sẵn.
- [ ] Multi-tenant thì dùng tenant token, sinh ở backend, có `expiresAt`.
- [ ] `MEILI_NO_ANALYTICS=true` nếu chính sách nội bộ không cho gửi số liệu ra ngoài.
- [ ] Không đẩy dữ liệu nhạy cảm (mật khẩu, token, số thẻ, thông tin cá nhân không cần cho tìm kiếm)
      vào index. Cần lưu mà không cần tìm thì bỏ trường đó khỏi `searchableAttributes` và khỏi
      `displayedAttributes`.
- [ ] Xoay key định kỳ: `client.updateKey()` / `client.deleteKey()` rồi phát lại cho client.

---

## 15. Cấu trúc thư mục

```
149_meli_search/
├── README.md
├── package.json, package-lock.json
├── docker-compose.yml                  Meilisearch (volume + master key) và service app
├── Dockerfile                          image cho app Node.js
├── .env.example                        mẫu biến môi trường, copy thành .env
├── .dockerignore, .gitignore
├── data/
│   └── products.json                   24 sản phẩm mẫu để import
├── src/
│   ├── config.js                       đọc .env và biến môi trường
│   ├── client.js                       khởi tạo Meilisearch client, chờ server sẵn sàng
│   ├── setup.js                        tạo index, khai báo settings, nạp dữ liệu
│   ├── demo.js                         chạy lần lượt 6 bước minh hoạ
│   ├── keys.js                         API key, tenant token, phần bảo mật
│   ├── lib/print.js                    helper in kết quả ra terminal
│   └── steps/
│       ├── 01-basic-search.js          query, bỏ dấu, matchingStrategy, typo, synonyms
│       ├── 02-filter.js                filter, toán tử, AND/OR, IN, sort
│       ├── 03-facet.js                 facetDistribution, facetStats, searchForFacetValues
│       ├── 04-pagination.js            offset/limit và page/hitsPerPage
│       ├── 05-highlight.js             _formatted, pre/post tag, crop, _matchesPosition
│       └── 06-documents.js             add, update, delete theo id và theo filter
└── scripts/
    └── verify.js                       53 check tự động chạy trên Meilisearch thật
```

| Lệnh npm | Làm gì |
|---|---|
| `npm run infra:up` | `docker compose up -d meilisearch` |
| `npm run infra:down` | dừng, giữ dữ liệu |
| `npm run infra:clean` | dừng và xoá volume |
| `npm run infra:logs` | theo dõi log của Meilisearch |
| `npm run setup` | tạo index, khai báo settings, nạp dữ liệu |
| `npm run demo` | chạy 6 bước minh hoạ |
| `npm start` | `setup` rồi `demo` |
| `npm run verify` | 53 check tự động |
| `npm run keys` | phần API key và tenant token |
| `npm run docker:demo` | chạy `npm start` bên trong container |

---

## 16. Output mẫu

### `npm run setup`

```
Meilisearch: http://localhost:7700   index: products
Đã kết nối, server phiên bản 1.54.3
1. Đã xoá index cũ
2. Đã tạo index "products" (primary key: id, task #67)
3. Đã cập nhật settings (task #68, PT0.020537542S)
4. Đã nạp 24/24 document (task #69, PT0.105960199S)
   Index đang giữ 24 document, 245760 byte trên đĩa
```

### `npm run demo` — bước 1, tìm kiếm cơ bản

```
── 1. Tìm kiếm cơ bản
index.search("kem chống nắng", { limit: 3 })
  #13 Kem Chống Nắng Anessa Perfect UV Sunscreen Skincare Milk SPF50+ 60ml
      Anessa · Kem chống nắng · 565.000đ · ★ 4.9 (2890 đánh giá)
  # 4 Kem Chống Nắng La Roche-Posay Anthelios UVMune 400 SPF50+ 50ml
      La Roche-Posay · Kem chống nắng · 465.000đ · ★ 4.8 (1532 đánh giá)
  #23 Kem Chống Nắng Innisfree Daily UV Defense SPF50+ 50ml
      Innisfree · Kem chống nắng · 325.000đ · ★ 4.4 (1066 đánh giá)
  → 3 hit hiển thị / 9 tổng (ước tính), 2ms

matchingStrategy: "all" — bắt buộc khớp đủ mọi từ
  → 3 hit hiển thị / 4 tổng (ước tính), 0ms

Ngưỡng minWordSizeForTypos: "tonr" (4 ký tự) vs "tnr" (3 ký tự)
  "tonr" → 4 hit: Toner Klairs Supple Preparation Unscented 180ml | Toner Some By Mi AHA BHA PHA 30 Days Miracle 150ml
  "tnr" → 0 hit
```

### `npm run demo` — bước 3, facet

```
── 3. Facet (bộ lọc kèm số lượng)
facets: ["brand", "category", "tags"] trên toàn bộ index
  category
    Serum             7
    Sữa rửa mặt       4
    Kem dưỡng         4
    Tẩy trang         3
    Kem chống nắng    3
    Toner             2
    Mặt nạ            1

facetStats cho trường số: ["price", "rating"]
  price : 185.000đ – 1.150.000đ
  rating: 4.2 – 4.9

Sau khi chọn category = "Serum", facet brand thu hẹp theo
  brand (trong Serum)
    The Ordinary      3
    Vichy             1
    Paula's Choice    1
    Klairs            1
    Cocoon            1

searchForFacetValues: gõ "cera" trong danh sách brand
  CeraVe (2)
```

### `npm run demo` — bước 4, phân trang

```
── 4. Phân trang
offset / limit → estimatedTotalHits (ước tính), không có tổng số trang
  offset= 0 limit=5 → id [20, 12, 6, 7, 21]  estimatedTotalHits=24
  offset= 5 limit=5 → id [11, 8, 22, 23, 19]  estimatedTotalHits=24
  offset=10 limit=5 → id [9, 1, 5, 10, 24]  estimatedTotalHits=24

page / hitsPerPage → totalHits và totalPages (chính xác)
  offset/limit  → estimatedTotalHits=24, totalPages=undefined
  page/hitsPerPage → totalHits=24, totalPages=5

Duyệt hết các trang với page/hitsPerPage = 10
  trang 1/3  (10 hit)  id [20, 12, 6, 7, 21, 11, 8, 22, 23, 19]
  trang 2/3  (10 hit)  id [9, 1, 5, 10, 24, 18, 2, 4, 3, 13]
  trang 3/3  (4 hit)  id [15, 14, 16, 17]
```

### `npm run demo` — bước 5, highlight

```
── 5. Highlight và crop kết quả
attributesToHighlight mặc định dùng thẻ <em>
  Kem Dưỡng Ẩm <em>CeraVe</em> Moisturising Cream 454g
  Sữa Rửa Mặt <em>CeraVe</em> Sạch Sâu Cho Da Thường Đến Da Dầu 473ml

attributesToCrop + cropLength: chỉ lấy 12 từ quanh chỗ khớp
  Tinh Chất Paula's Choice BHA 2% Skin Perfecting Liquid Exfoliant 118ml
      Dung dịch salicylic acid 2% tan trong dầu, len vào lỗ chân…

showMatchesPosition: toạ độ khớp để tự render
  Serum Klairs Freshly Juiced Vitamin C 35ml
  _matchesPosition = {"description":[{"start":12,"length":7}],"name":[{"start":28,"length":7}],"tags":[{"start":0,"length":7,"indices":[0]}]}
```

### `npm run keys`

```
── A. Các key có sẵn
  Default Search API Key           actions=["search"] indexes=["*"]
  Default Admin API Key            actions=["*"] indexes=["*"]
  Default Read-Only Admin API Key  actions=["*.get","keys.get"] indexes=["*"]
  Default Chat API Key             actions=["chatCompletions","search"] indexes=["*"]

── B. Tạo search-only key, chỉ cho một index
  uid      : af375e2a-3cf1-438b-8ba6-f3e8f0784a3d
  key      : 6ce7c59a2a7b3087987529d406612575a8c4eda6511825c12ea04a7ec1495475
  expiresAt: 2026-10-09T07:24:00.907Z

── C. Key đó search được nhưng không ghi được
  search → OK, 7 hit
  addDocuments → bị chặn: invalid_api_key

── D. Tenant token: giới hạn dữ liệu theo từng người dùng
  token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzZWFyY2h…
  qua tenant token → 23 hit (đã bị ép filter inStock = true)
  qua master key   → 24 hit (toàn bộ index)

── E. Dọn dẹp
  đã xoá key af375e2a-3cf1-438b-8ba6-f3e8f0784a3d
```

---

## 17. Kiểm thử

```bash
npm run verify
```

Script [`scripts/verify.js`](scripts/verify.js) tự nạp lại dữ liệu rồi chạy 53 assertion trên
Meilisearch **thật** — không mock. Sau khi chạy xong nó nạp lại index về trạng thái ban đầu.

```
PASS  setup        nạp đủ 24 document
PASS  setup        primary key là "id"
PASS  setup        rankingRules kết thúc bằng custom rule rating:desc
PASS  search       gõ không dấu ra cùng kết quả
PASS  search       matchingStrategy "all" thu hẹp kết quả so với mặc định
PASS  typo         "tonr" (4 ký tự) vẫn ra Toner
PASS  typo         "tnr" (3 ký tự) không được tha lỗi vì dưới ngưỡng oneTypo
PASS  synonym      "srm" ra 4 sữa rửa mặt
PASS  stopword     stop word "cho" bị bỏ qua, kết quả không đổi
PASS  filter       mảng lồng nhau hoạt động như OR
PASS  filter       lọc trường ngoài filterableAttributes bị từ chối
PASS  sort         sắp xếp trường ngoài sortableAttributes bị từ chối
PASS  facet        facetDistribution tính trên tập đã lọc
PASS  facet        facetStats trả về min/max của price
PASS  paging       page/hitsPerPage trả totalHits chính xác
PASS  paging       xin trang vượt quá thì trả mảng rỗng, không lỗi
PASS  highlight    trường gốc không bị đổi, chỉ _formatted mới có thẻ
PASS  highlight    cropMarker xuất hiện ở chỗ bị cắt
PASS  document     updateDocuments chỉ sửa trường được gửi
PASS  document     deleteDocuments theo filter xoá 1 sản phẩm hết hàng
PASS  auth         gọi API không kèm key bị chặn
PASS  auth         search-only key không ghi được
…

Kết quả: 53/53 check PASS
```

Danh sách đầy đủ chia theo nhóm: `setup` (6), `search` (4), `typo` (4), `synonym` (1), `stopword` (1),
`filter` (6), `sort` (3), `facet` (6), `paging` (7), `highlight` (6), `document` (6), `auth` (3).

---

## 18. Lưu ý khi đưa lên production

### Đồng bộ dữ liệu từ DB sang Meilisearch

Meilisearch là **bản sao để tìm kiếm**, không phải nguồn sự thật. Dữ liệu gốc vẫn ở MySQL /
PostgreSQL. Ba cách giữ cho hai bên khớp nhau:

| Cách | Cơ chế | Đánh đổi |
|---|---|---|
| Ghi kép | Ghi DB xong thì gọi luôn Meilisearch | Đơn giản nhất; lệch nhau khi một trong hai lỗi |
| Hàng đợi | Ghi DB xong thì đẩy một message, worker nạp vào Meilisearch | Chịu lỗi tốt, thử lại được; thêm một thành phần |
| Nạp lại định kỳ | Cron quét toàn bộ hoặc theo `updated_at` | Chắc chắn nhất; dữ liệu trễ |

Thực tế thường kết hợp: hàng đợi cho cập nhật tức thời, cộng một job nạp lại hằng đêm để chữa lệch.

Nạp lại toàn bộ mà **không** làm gián đoạn tìm kiếm: nạp vào index tạm rồi hoán đổi nguyên tử.

```js
await client.index('products_new').addDocuments(all).waitTask();
await client.swapIndexes([{ indexes: ['products', 'products_new'] }]).waitTask();
await client.deleteIndex('products_new');
```

### Hiệu năng

- **Chia lô khi nạp**: `addDocumentsInBatches(documents, 10000)`. Một request khổng lồ dễ bị timeout.
- **Khai báo đúng những gì cần.** Mỗi trường trong `filterableAttributes` và `sortableAttributes` là
  thêm cấu trúc phụ trên đĩa và thêm thời gian đánh chỉ mục.
- **`MEILI_MAX_INDEXING_MEMORY`** mặc định lấy 2/3 RAM máy. Chạy chung máy với service khác thì nên
  đặt cứng, ví dụ `MEILI_MAX_INDEXING_MEMORY=2Gb`.
- **`attributesToRetrieve`** để khỏi kéo cả document về khi giao diện chỉ hiện tên và giá.
- **`searchCutoffMs`** đặt trần thời gian truy vấn; quá hạn thì Meilisearch trả về kết quả chưa hoàn
  chỉnh thay vì bắt người dùng chờ. Settings mặc định là `null`, tức dùng ngưỡng 1500 ms có sẵn.
- **Đổi settings = đánh chỉ mục lại toàn bộ index.** Đừng gọi `updateSettings` trong luồng xử lý
  request.

### Sao lưu

```bash
# Dump: toàn bộ instance, dùng để khôi phục hoặc chuyển sang máy khác
curl -X POST http://localhost:7700/dumps -H "Authorization: Bearer $MEILI_MASTER_KEY"

# Snapshot: nhanh hơn, phụ thuộc phiên bản, hợp để sao lưu định kỳ
curl -X POST http://localhost:7700/snapshots -H "Authorization: Bearer $MEILI_MASTER_KEY"
```

Cả hai ghi vào `/meili_data`. Dump chạy được giữa các phiên bản Meilisearch khác nhau nên là cách
nâng cấp chính thức; snapshot thì không. Dù sao, luôn có thể nạp lại từ DB gốc.

### Nâng cấp phiên bản

Meilisearch **không** đọc được thư mục dữ liệu của bản khác. Quy trình: tạo dump bằng bản đang chạy,
dựng container bản mới với `meilisearch --import-dump <file>`, kiểm tra, rồi mới chuyển tải. Vì vậy
hãy ghim phiên bản cụ thể (`getmeili/meilisearch:v1.54.3`) chứ đừng dùng `latest` — một lần
`docker compose pull` vô ý là instance không khởi động lại được.

### Vận hành

- **Healthcheck**: `GET /health` trả `{"status":"available"}`. Dùng cho Docker, Kubernetes, load balancer.
- **Theo dõi**: `GET /stats` cho số document và dung lượng mỗi index; `GET /tasks?statuses=failed` cho
  các task hỏng. Nên có cảnh báo khi số task `failed` tăng.
- **Log**: `MEILI_LOG_LEVEL=DEBUG` khi cần soi, nhưng rất nhiều dòng.
- **Nhân bản**: Meilisearch không có replica tự động như Elasticsearch. Muốn chịu lỗi thì chạy nhiều
  instance độc lập, mỗi instance nhận cùng một luồng ghi, rồi cân tải phía trước.

---

## 19. Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| `does not provide an export named 'MeiliSearch'` | Từ bản 0.60, tên export là `Meilisearch` (chữ `s` thường) | `import { Meilisearch } from 'meilisearch'` |
| `Error [ERR_REQUIRE_ESM]: require() of ES Module` | Thư viện chỉ có bản ESM | Đặt `"type": "module"` trong `package.json` và dùng `import` |
| `npm warn EBADENGINE` khi `npm install` | `meilisearch` khai báo cần Node `^20.19.0 \|\| >=22.12.0`, máy đang chạy Node cũ hơn (ví dụ 22.11) | Chỉ là cảnh báo, ví dụ vẫn chạy. Nâng Node lên 22.12+ là hết |
| `Request to http://localhost:7700/... has failed` | Meilisearch chưa chạy, hoặc sai cổng | `docker compose ps`, kiểm tra `MEILI_HOST`. Trong compose phải là `http://meilisearch:7700`, không phải `localhost` |
| `missing_authorization_header` | Client không gửi API key | Đặt `MEILI_MASTER_KEY` hoặc `MEILI_API_KEY` trong `.env` |
| `invalid_api_key` | Sai khoá, khoá hết hạn, hoặc khoá không có quyền cho hành động đó | Đối chiếu `.env` với biến của container; `npm run keys` để xem quyền từng key |
| `index_not_found` | Chưa tạo index, hoặc sai `MEILI_INDEX` | Chạy `npm run setup` |
| `invalid_search_filter` | Trường chưa nằm trong `filterableAttributes` | Thêm vào settings rồi chạy lại `npm run setup`. Thông báo lỗi có liệt kê các trường hợp lệ |
| `invalid_search_sort` | Trường chưa nằm trong `sortableAttributes` | Như trên |
| `document_not_found` | Document đã bị xoá hoặc chưa từng tồn tại | Bình thường sau bước 8; chạy `npm run setup` để nạp lại |
| Thêm document xong search không thấy | Việc ghi là bất đồng bộ, task chưa chạy xong | Dùng `.waitTask()`, hoặc kiểm tra `GET /tasks/<uid>` |
| `task.status === "failed"` mà không thấy exception | Lỗi của task không ném ra thành exception | Đọc `task.error.code` và `task.error.message` |
| `deleteIndexIfExists()` trả `true` dù index không tồn tại | Hàm chỉ chờ bước *nhận* task | Dùng `deleteIndex(uid).waitTask()` rồi xem `task.status` |
| `searchKey.expiresAt.toISOString is not a function` | Kiểu TS ghi là `Date` nhưng API trả về chuỗi | Dùng thẳng chuỗi, hoặc `new Date(key.expiresAt)` |
| Mở http://localhost:7700 chỉ thấy `{"status":"Meilisearch is running"}` | Đang chạy `MEILI_ENV=production`, Mini-dashboard bị tắt | Đổi sang `MEILI_ENV=development` cho môi trường dev |
| `docker compose ps` hiện `Restarting (1)`, log báo `You must provide a master key` hoặc `The master key must be at least 16 bytes` | `MEILI_ENV=production` mà thiếu master key, hoặc khoá ngắn hơn 16 byte. Meilisearch thoát ngay, `restart: unless-stopped` khởi động lại liên tục | Đặt `MEILI_MASTER_KEY` đủ dài trong `.env` rồi `docker compose up -d meilisearch`; log có in sẵn một khoá hợp lệ để dùng luôn |
| `docker compose up` báo cổng 7700 bị chiếm | Đã có tiến trình khác giữ cổng đó | Đổi cổng bên trái trong `ports`, ví dụ `17700:7700`, rồi sửa `MEILI_HOST` theo |
| Xoá container xong mất sạch dữ liệu | Không mount volume, hoặc đã chạy `docker compose down -v` | Giữ `meili_data:/meili_data`; `docker volume ls` để kiểm tra |
| Dữ liệu cũ vẫn còn sau khi sửa dữ liệu mẫu | Volume vẫn giữ index cũ | `npm run setup` nạp lại, hoặc `npm run infra:clean` xoá sạch rồi dựng lại |
| Highlight sáng cả những từ chẳng liên quan | Typo tolerance coi các từ lệch 1 ký tự là khớp (`chân` ↔ `chất`) | Nâng `minWordSizeForTypos`, hoặc `disableOnAttributes` cho trường đó |
| Kết quả nhiều hơn mong đợi | `matchingStrategy` mặc định là `"last"`, bỏ dần từ cuối câu | Dùng `matchingStrategy: 'all'` |
| `totalPages` là `undefined` | Đang dùng `offset`/`limit` | Đổi sang `page`/`hitsPerPage` |
| Xin trang sâu thì trả mảng rỗng | Vượt `pagination.maxTotalHits` (mặc định 1000) | Nâng trần trong settings, hoặc chặn ở giao diện |
| Nạp dữ liệu rất chậm | Khai báo thừa `filterableAttributes` / `sortableAttributes`, hoặc gửi một lô quá lớn | Bớt trường, và dùng `addDocumentsInBatches()` |

Soi sâu hơn:

```bash
docker compose logs -f meilisearch                      # log của server
curl http://localhost:7700/tasks?statuses=failed \
  -H "Authorization: Bearer $MEILI_MASTER_KEY"          # các task hỏng kèm lý do
curl http://localhost:7700/indexes/products/settings \
  -H "Authorization: Bearer $MEILI_MASTER_KEY"          # settings đang áp dụng thật sự
```

---

## 20. Tham khảo

- [Tài liệu Meilisearch](https://www.meilisearch.com/docs/getting_started/overview)
- [Tham chiếu REST API: xác thực](https://www.meilisearch.com/docs/reference/api/authorization)
- [Tham số tìm kiếm](https://www.meilisearch.com/docs/reference/api/search/search-with-post)
- [Settings của index](https://www.meilisearch.com/docs/reference/api/settings/list-all-settings)
- [Ranking rules](https://www.meilisearch.com/docs/capabilities/full_text_search/relevancy/ranking_rules)
- [Cú pháp filter](https://www.meilisearch.com/docs/capabilities/filtering_sorting_faceting/advanced/filter_expression_syntax)
- [Faceted search](https://www.meilisearch.com/docs/capabilities/filtering_sorting_faceting/how_to/filter_with_facets)
- [Bảo mật và API key](https://www.meilisearch.com/docs/resources/self_hosting/security/basic_security)
- [Tenant token](https://www.meilisearch.com/docs/capabilities/security/advanced/tenant_token_payload)
- [Biến môi trường và tham số dòng lệnh](https://www.meilisearch.com/docs/resources/self_hosting/configuration/overview)
- [Thư viện `meilisearch` cho JavaScript](https://github.com/meilisearch/meilisearch-js)
- [Image Docker `getmeili/meilisearch`](https://hub.docker.com/r/getmeili/meilisearch)
