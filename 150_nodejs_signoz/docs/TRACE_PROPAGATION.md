# Truyền trace id và span cha giữa các service

Tài liệu này giải thích cách demo nối span của order-service và payment-service vào **cùng một trace**:
trong một process nhờ AsyncLocalStorage, giữa hai service nhờ header W3C `traceparent`. Kèm dữ liệu thật
lấy từ ClickHouse và các lệnh để tự kiểm chứng. Tổng quan kiến trúc xem [ARCHITECTURE.md](ARCHITECTURE.md)
(mục 4.3 là bản tóm tắt của tài liệu này), thuật ngữ xem [GLOSSARY.md](GLOSSARY.md).

- Đường dẫn file tính từ thư mục `150_nodejs_signoz/`. Số dòng ứng với mã nguồn ngày 10/11/2026; sửa code
  thì số dòng có thể lệch.
- Trace id, span id trong tài liệu lấy từ lần chạy thử ngày 10/11/2026 (SigNoz v0.149). Chạy lại sẽ ra id
  khác.

## Mục lục

1. [Tóm tắt](#1-tóm-tắt)
2. [Cấu tạo header `traceparent`](#2-cấu-tạo-header-traceparent)
3. [Ai làm việc gì](#3-ai-làm-việc-gì)
4. [Đường đi thật của một đơn hàng](#4-đường-đi-thật-của-một-đơn-hàng)
5. [Thí nghiệm: tự gửi `traceparent`](#5-thí-nghiệm-tự-gửi-traceparent)
6. [Khi trace bị đứt](#6-khi-trace-bị-đứt)
7. [Kiểm tra tự động](#7-kiểm-tra-tự-động)
8. [Tham khảo](#8-tham-khảo)

## 1. Tóm tắt

- **Giữa hai service:** khi gọi payment-service, order-service gửi kèm header `traceparent`. Header mang
  trace id và id của span bên gọi; payment-service đọc header rồi tạo span của mình làm **con** của span đó.
- **Trong một service:** "span đang active" được giữ qua các lần `await` nhờ AsyncLocalStorage, nên span tạo
  sau (truy vấn DB, `fetch`) tự thành con của span đang chạy.
- **Code của app không có dòng nào đọc hay ghi header này.** instrumentation-undici chèn header khi gọi
  `fetch`; instrumentation-http đọc header khi nhận request. Điều kiện: OpenTelemetry SDK phải khởi động
  trước code của app (demo dùng cờ `--require ./src/tracing.js`).

## 2. Cấu tạo header `traceparent`

Header order-service đã gửi sang payment-service cho đơn `ORD-000098` (trace `0f78c946…`):

```text
traceparent: 00-0f78c946d90a193216eebb5eaf0e449d-46ccffbfd50c0d9a-01
```

| Phần | Giá trị | Ý nghĩa |
|---|---|---|
| version | `00` | Phiên bản định dạng |
| trace-id | `0f78c946d90a193216eebb5eaf0e449d` | 32 ký tự hex. Id của cả trace, giữ nguyên qua mọi service |
| parent-id | `46ccffbfd50c0d9a` | 16 ký tự hex. Id của span bên gọi (span CLIENT của `fetch`); bên nhận lấy làm span cha |
| trace-flags | `01` | `01` = sampled: trace này được ghi lại |

**Trace id đi suốt trace, còn parent-id đổi ở mỗi chặng:** chặng nào cũng ghi id của span ngay trước nó bên
gọi. Nhờ vậy SigNoz ghép span của nhiều service thành một cây.

Cùng chuẩn W3C còn có header `tracestate` (thông tin riêng của từng hệ thống, không bắt buộc) và header
`baggage` (các cặp key=value đi kèm request). Code của demo không dùng hai thứ này.

## 3. Ai làm việc gì

| Việc | Ai làm | Ở đâu trong demo |
|---|---|---|
| Giữ span đang active qua các lần `await` | `AsyncLocalStorageContextManager`, NodeSDK bật mặc định | `withSpan()` gọi `tracer.startActiveSpan` (`src/lib/telemetry.js:42`). Lấy span hiện tại bằng `trace.getActiveSpan()` (`src/lib/middlewares.js:20`, `src/payment-service.js:50`) |
| Bên gửi: tạo span CLIENT, chèn `traceparent` | instrumentation-undici (`fetch` của Node chạy trên undici) | `fetch()` ở `src/lib/payment-client.js:30` |
| Bên nhận: đọc `traceparent`, tạo span SERVER làm con | instrumentation-http | Mọi request vào order-service (cổng 3400) và payment-service (cổng 3401) |
| Chọn định dạng header | Propagator. Không đặt `OTEL_PROPAGATORS` thì NodeSDK dùng W3C `tracecontext` + `baggage` | `docker-compose.yml` không đặt biến này |

Đổi định dạng bằng biến `OTEL_PROPAGATORS`; NodeSDK nhận các giá trị `tracecontext`, `baggage`, `b3`,
`b3multi`, `none`. Hai đầu phải dùng cùng định dạng, nếu không trace bị tách làm hai.

## 4. Đường đi thật của một đơn hàng

Cây span rút gọn của đơn `ORD-000098` (trace `0f78c946…`, 18 span), lấy từ ClickHouse. Các span middleware
và span DB của order-service (`SELECT shop.products`, `UPDATE …`, `INSERT shop.orders`) được lược bớt.

```text
order-service
POST /api/orders                        SERVER     d0bb73e2…         span gốc, không có cha
└─ request handler - /api/orders        INTERNAL   df2e75c6…         span đang active lúc gọi fetch()
   └─ POST                              CLIENT     46ccffbfd50c0d9a  span của fetch, chèn header:
        traceparent: 00-0f78c946d90a193216eebb5eaf0e449d-46ccffbfd50c0d9a-01
─────────────────────────────────── HTTP ───────────────────────────────────
payment-service
      └─ POST /payments                 SERVER     17371904…         cha = 46ccffbfd50c0d9a, lấy từ header
         └─ request handler - /payments INTERNAL   fff3f399…
            ├─ fraud.check              INTERNAL
            └─ bank.authorize           CLIENT
```

Muốn xem đủ 18 span: dùng câu truy vấn ở mục 5, thay trace id và bỏ điều kiện `name LIKE 'POST%'`.

## 5. Thí nghiệm: tự gửi `traceparent`

Gửi một request kèm `traceparent` do mình tự đặt, rồi xem trace id và span cha có được truyền tiếp không.
Các lệnh chạy trong bash (trên Windows: Git Bash hoặc WSL), khi SigNoz và app đang chạy.

```bash
# 1. Tự tạo trace id (32 ký tự hex) và span id (16 ký tự hex)
TRACE_ID=$(openssl rand -hex 16)
SPAN_ID=$(openssl rand -hex 8)
echo "Gửi đi: traceparent: 00-$TRACE_ID-$SPAN_ID-01"

# 2. Tạo một đơn hàng kèm header traceparent, in header X-Trace-Id trả về
curl -s -o /dev/null -D - -H "traceparent: 00-$TRACE_ID-$SPAN_ID-01" \
  -H 'Content-Type: application/json' \
  -d '{"productId":"p-1002","quantity":1,"customerId":"cus_traceparent_demo"}' \
  http://localhost:3400/api/orders | grep -i '^x-trace-id'
```

Kết quả lần chạy thử:

```text
Gửi đi: traceparent: 00-cf4139a2f9ec3a170689a0ca94fb09d7-47c4835074eb3f85-01
X-Trace-Id: cf4139a2f9ec3a170689a0ca94fb09d7
```

`X-Trace-Id` trùng trace id đã gửi: order-service không mở trace mới mà đi tiếp trace của bên gọi. Header
`X-Trace-Id` chỉ là header phản hồi do demo tự thêm để tra cứu trace (`src/lib/middlewares.js:20-21`); việc
truyền trace giữa các service chỉ dùng `traceparent`.

Đợi khoảng 10–20 giây cho span được ghi vào ClickHouse, rồi xem mối nối giữa các span:

```bash
docker exec signoz-telemetrystore-clickhouse-0-0 clickhouse-client -q "
  SELECT serviceName, name, kind_string, span_id, parent_span_id
  FROM signoz_traces.distributed_signoz_index_v3
  WHERE trace_id = '$TRACE_ID' AND name LIKE 'POST%'
  ORDER BY timestamp
  FORMAT PrettyCompact"
```

```text
   ┌─serviceName─────┬─name─────────────┬─kind_string─┬─span_id──────────┬─parent_span_id───┐
1. │ order-service   │ POST /api/orders │ Server      │ 0213e2197713b975 │ 47c4835074eb3f85 │
2. │ order-service   │ POST             │ Client      │ 73392ec38dfa72e1 │ 56a9425f5a34c18a │
3. │ payment-service │ POST /payments   │ Server      │ 4377dab67db6898d │ 73392ec38dfa72e1 │
   └─────────────────┴──────────────────┴─────────────┴──────────────────┴──────────────────┘
```

Cách đọc:

- Dòng 1: span SERVER của order-service có cha `47c4835074eb3f85`, chính là span id đã gửi trong header.
- Dòng 2: span CLIENT của `fetch` có cha `56a9425f…`, là span `request handler - /api/orders` (không hiện
  vì bị điều kiện `name LIKE 'POST%'` lọc mất).
- Dòng 3: span SERVER của payment-service có cha `73392ec38dfa72e1`, là span CLIENT ở dòng 2. order-service đã
  chèn header mới: `traceparent: 00-cf4139a2…09d7-73392ec38dfa72e1-01`.

Trace id giữ nguyên qua 3 chặng (curl → order-service → payment-service), còn span cha đổi theo từng chặng.

Trace tạo theo cách này **không có span gốc**: 18 span, không span nào có `parent_span_id` rỗng, vì span
`47c48350…` của curl không được gửi lên SigNoz. Hệ thống thật cũng gặp đúng như vậy khi gateway hay frontend
truyền `traceparent` mà chưa gắn OpenTelemetry.

## 6. Khi trace bị đứt

| Dấu hiệu | Nguyên nhân thường gặp |
|---|---|
| Span của payment-service nằm ở một trace riêng, không nối với order-service | Request sang payment-service không mang `traceparent`: order-service chạy không có `tracing.js` hoặc đặt `OTEL_SDK_DISABLED=true` (`src/tracing.js:49-52`); hai service đặt `OTEL_PROPAGATORS` khác nhau; hoặc proxy ở giữa bỏ mất header |
| Trace không có span gốc | Bên gọi truyền `traceparent` nhưng không gửi span của chính nó: curl ở mục 5, hoặc gateway/frontend chưa gắn OpenTelemetry |
| Trace chỉ có span của order-service, span CLIENT `POST` không có con | Header vẫn được gửi, nhưng payment-service không gửi được span tới SigNoz. Xem [README mục 12](README.md#12-xử-lý-sự-cố) |

## 7. Kiểm tra tự động

Hai bộ kiểm tra của demo đều kiểm tra mối nối này:

- **`npm test`**: test "order thành công: một trace đi qua cả 2 service, cha-con nối đúng qua traceparent"
  (`test/telemetry.test.js:236`). Dùng OTLP receiver giả, không cần SigNoz.
- **`npm run verify`**: check "traceparent: span của payment-service là con của span fetch bên order-service"
  (`scripts/verify.js:170`). Chạy trên SigNoz thật.

## 8. Tham khảo

- W3C Trace Context (`traceparent`): https://www.w3.org/TR/trace-context/
- OpenTelemetry — Context propagation: https://opentelemetry.io/docs/concepts/context-propagation/
- Biến môi trường của SDK (có `OTEL_PROPAGATORS`): https://opentelemetry.io/docs/specs/otel/configuration/sdk-environment-variables/
