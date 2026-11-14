# Playwright với Claude: điều khiển trình duyệt bằng MCP và viết test tự động

Thư mục gồm hai phần, dùng chung một web app mẫu chạy trên máy bạn:

1. **Playwright + Claude**: cấu hình [Playwright MCP](https://github.com/microsoft/playwright-mcp) cho Claude Code
   để Claude tự mở trình duyệt, click, điền form, chụp màn hình và đọc nội dung trang. Hướng dẫn đầy đủ và prompt
   mẫu nằm trong [`CLAUDE_MCP.md`](CLAUDE_MCP.md).
2. **Code Playwright**: 5 ví dụ `@playwright/test` viết bằng TypeScript, chạy được ngay: kiểm tra tiêu đề, form,
   locator và chờ element, screenshot, một kịch bản end-to-end.

Web app mẫu "Mini Shop" (`src/`) là một cửa hàng giả lập, không cần cài thêm gì. Nhờ vậy test không phụ thuộc
website bên ngoài, chạy được khi không có mạng và cho cùng kết quả mỗi lần chạy.

```
                Phần 1                                          Phần 2
  bạn ── prompt ──► Claude Code                   npm test ──► @playwright/test
                        │ MCP (stdio)                             │ tests/01..05.spec.ts
                        ▼                                         │ Chromium · Firefox · WebKit
               npx @playwright/mcp ── Chrome ──┐      ┌───────────┘
                                               ▼      ▼
                                ┌────────────────────────────────────┐
                                │ Mini Shop (src/server.js)          │  http://localhost:3151
                                │ trang tĩnh + API giả lập trễ 400ms │
                                └────────────────────────────────────┘
```

Kiểm chứng trên Ubuntu 26.04 với Node.js 22.22, @playwright/test 1.65.1, @playwright/mcp 0.0.85, Claude Code 2.1.318.

---

## Mục lục

1. [Chạy nhanh](#1-chạy-nhanh)
2. [Cài đặt](#2-cài-đặt)
3. [Web app mẫu](#3-web-app-mẫu)
4. [Phần 1 — Playwright + Claude](#4-phần-1--playwright--claude)
5. [Phần 2 — Ví dụ code Playwright](#5-phần-2--ví-dụ-code-playwright)
6. [Best practice đã áp dụng](#6-best-practice-đã-áp-dụng)
7. [Xem kết quả và gỡ lỗi](#7-xem-kết-quả-và-gỡ-lỗi)
8. [Lệnh npm](#8-lệnh-npm)
9. [Cấu trúc thư mục](#9-cấu-trúc-thư-mục)
10. [Output mẫu](#10-output-mẫu)
11. [Xử lý sự cố](#11-xử-lý-sự-cố)
12. [Tham khảo](#12-tham-khảo)

---

## 1. Chạy nhanh

```bash
cd 151_playwright
npm install
npx playwright install      # tải Chromium, Firefox, WebKit
npm test                    # 23 test trên Chromium, tự bật web app mẫu và tắt khi xong
```

Mở web app để tự bấm thử, hoặc để Claude điều khiển (Phần 1):

```bash
npm run serve               # http://localhost:3151, Ctrl+C để dừng
```

---

## 2. Cài đặt

Cần **Node.js >= 20** (yêu cầu của Playwright 1.65). Phần 1 cần thêm Claude Code và Google Chrome.

```bash
npm install                 # @playwright/test, typescript, @types/node
npx playwright install      # trình duyệt cho cả 3 project trong playwright.config.ts
```

| Lệnh | Tải gì | Dung lượng sau khi giải nén (Linux) |
|---|---|---|
| `npx playwright install` | Chromium, Chromium headless shell, Firefox, WebKit, ffmpeg | khoảng 1,3 GB |
| `npx playwright install chromium` | Chromium và headless shell, đủ cho `npm test` | khoảng 700 MB |
| `npx playwright install --with-deps` | Như dòng đầu, kèm thư viện hệ thống (Linux, cần sudo) | |

Trình duyệt được lưu dùng chung cho mọi project: `~/.cache/ms-playwright` (Linux),
`%USERPROFILE%\AppData\Local\ms-playwright` (Windows), `~/Library/Caches/ms-playwright` (macOS). Mỗi bản
`@playwright/test` cần đúng một phiên bản trình duyệt, nên nâng cấp package xong thì chạy lại `npx playwright install`.

Trên Linux, Firefox và WebKit có thể cần thêm thư viện hệ thống. Nếu gặp `Host system is missing dependencies to run browsers`:

```bash
sudo npx playwright install-deps
# hoặc cài đúng các gói Playwright liệt kê trong thông báo, ví dụ WebKit trên Ubuntu 26.04:
sudo apt-get install libevent-2.1-7t64 libavif16 libmanette-0.2-0
```

---

## 3. Web app mẫu

`src/server.js` chỉ dùng module có sẵn của Node. Nó phục vụ các trang tĩnh trong `src/public/` và vài API giả lập.

| Đường dẫn | Có gì | Dùng ở |
|---|---|---|
| `/` | Trang chủ, menu, giờ mở trang (đổi mỗi lần tải) | Ví dụ 1, 4 |
| `/products` | Danh sách tải qua API, tìm kiếm (debounce 300ms, gõ không dấu vẫn ra), lọc danh mục, thêm vào giỏ, thông báo tự ẩn sau 2 giây, sản phẩm hết hàng | Ví dụ 3, 4, 5 |
| `/contact` | Form liên hệ có kiểm tra dữ liệu, lỗi hiện cạnh từng ô | Ví dụ 2 |
| `/cart` | Giỏ hàng (lưu trong localStorage): tăng/giảm số lượng, xoá có hộp thoại `confirm`, đặt hàng | Ví dụ 5 |
| `GET /api/products?q=&category=` | Danh sách sản phẩm, **trễ 400ms** có chủ đích | |
| `POST /api/contact` | Nhận form liên hệ | |
| `POST /api/orders` | Tạo đơn, tính lại tổng tiền theo giá trên server, trả mã `DH000001`, `DH000002`... | |
| `GET /api/health` | Playwright dùng để biết server đã sẵn sàng | |

| Biến môi trường | Mặc định | Ý nghĩa |
|---|---|---|
| `PORT` | `3151` | Cổng của web app. `playwright.config.ts` cũng đọc biến này |
| `API_DELAY_MS` | `400` | Độ trễ giả lập của API, đặt `0` để tắt |

Khi chạy test bạn không cần tự bật server: `webServer` trong `playwright.config.ts` tự chạy `node src/server.js`,
chờ `/api/health` trả về 200, rồi tắt khi test xong. Nếu đang chạy sẵn `npm run serve` thì test dùng lại server đó.

---

## 4. Phần 1 — Playwright + Claude

Thư mục đã có [`.mcp.json`](.mcp.json) khai báo Playwright MCP ở scope project:

```bash
npm run serve               # terminal 1
claude                      # terminal 2, mở ngay trong thư mục 151_playwright
```

Lần đầu, Claude Code hỏi có dùng server `playwright` trong `.mcp.json` không, chọn đồng ý. Sau đó chỉ cần gõ yêu cầu:

> Mở http://localhost:3151, vào trang Sản phẩm, tìm "kem", thêm "Kem chống nắng SPF50+ 50ml" vào giỏ rồi cho biết
> số trên link Giỏ hàng.

> Mở trang Liên hệ, điền form bằng dữ liệu giả rồi gửi. Chụp màn hình kết quả, lưu vào screenshots/mcp/contact.png.

> Dùng Playwright MCP đi qua luồng đặt hàng, rồi viết test tests/06-checkout.spec.ts theo phong cách các file
> tests/01..05 và chạy cho tới khi pass.

Với project khác, thêm server bằng một lệnh:

```bash
claude mcp add playwright -- npx @playwright/mcp@latest                 # chỉ project hiện tại
claude mcp add --scope user playwright -- npx @playwright/mcp@latest    # mọi project
```

[`CLAUDE_MCP.md`](CLAUDE_MCP.md) có đầy đủ:

- Scope và thứ tự ưu tiên
- Tuỳ chọn và file cấu hình
- Danh sách 25 tool
- Prompt mẫu cho từng việc: mở trang, click, điền form, chụp màn hình, lấy nội dung trang, console, network, hộp thoại
- Cách để Claude viết test
- Phân quyền, `claude -p`, bảo mật
- Playwright Test Agents
- Xử lý sự cố

---

## 5. Phần 2 — Ví dụ code Playwright

Mỗi file là một ví dụ độc lập, đọc từ trên xuống là hiểu. Chạy riêng từng file: `npm run test:01` ... `npm run test:05`.

### 5.1. Ví dụ 1 — Mở trang và kiểm tra tiêu đề

[`tests/01-title.spec.ts`](tests/01-title.spec.ts) · `npm run test:01`

- `page.goto('/')` dựa vào `baseURL` trong config, không phải lặp lại URL đầy đủ.
- `expect(page).toHaveTitle()` và `toHaveURL()` tự chờ tới khi đúng.
- Giới hạn locator trong một vùng (`getByRole('navigation')`) để không khớp nhiều phần tử.
- `page.goto()` trả về response nên kiểm tra được mã 404 mà không bị ném lỗi.

```ts
const menu = page.getByRole('navigation', { name: 'Menu chính' });
await menu.getByRole('link', { name: 'Sản phẩm' }).click();
await expect(page).toHaveURL(/\/products$/);
await expect(page).toHaveTitle('Sản phẩm — Mini Shop');
```

### 5.2. Ví dụ 2 — Tương tác với form

[`tests/02-form.spec.ts`](tests/02-form.spec.ts) · `npm run test:02`

- `fill`, `selectOption`, `check` trên các ô tìm bằng `getByLabel` / `getByRole`.
- Kiểm tra trạng thái: `toHaveValue`, `toBeChecked`, `toBeFocused`, `toHaveAttribute('aria-invalid', 'true')`.
- Đọc thông báo lỗi gắn với ô qua `aria-describedby` bằng `toHaveAccessibleDescription`.
- Bẫy hay gặp: `getByLabel('Email')` khớp cả ô Email lẫn radio "Email", nên phải thêm role để chỉ lấy ô nhập.

```ts
await page.getByLabel('Họ và tên').fill('Nguyễn Văn An');
await page.getByRole('textbox', { name: 'Email' }).fill('an.nguyen@example.com');
await page.getByLabel('Chủ đề').selectOption({ label: 'Tư vấn sản phẩm' });
await page.getByRole('radio', { name: 'Điện thoại' }).check();
await page.getByRole('button', { name: 'Gửi liên hệ' }).click();
await expect(page.getByRole('status')).toContainText('Cảm ơn Nguyễn Văn An!');
```

### 5.3. Ví dụ 3 — Locator và chờ element

[`tests/03-locators-waiting.spec.ts`](tests/03-locators-waiting.spec.ts) · `npm run test:03`

Trang Sản phẩm cố tình bất đồng bộ (API trễ 400ms, tìm kiếm debounce 300ms, thông báo tự ẩn sau 2 giây) để thấy
Playwright tự chờ ra sao. Cả file không có dòng `waitForTimeout` nào.

| Cần chờ | Dùng | Trong ví dụ |
|---|---|---|
| Element xuất hiện, biến mất, đổi nội dung | `await expect(locator).toBeVisible()`, `toBeHidden()`, `toHaveText()`, `toHaveCount()` | Danh sách tải xong, thông báo tự ẩn |
| Element sẵn sàng trước khi thao tác | Không cần làm gì: `click`, `fill`... tự chờ element hiện, được bật, đứng yên | Mọi thao tác |
| Response của một API | `page.waitForResponse()`, đăng ký **trước** hành động | Chọn danh mục "Chống nắng" |
| Giá trị nằm ngoài DOM | `expect.poll(() => ...)` | Nội dung localStorage |
| API lỗi hoặc dữ liệu tuỳ ý | `page.route()` + `route.fulfill()` | API trả 500, bấm "Thử lại" |
| ~~Chờ cố định~~ | ~~`page.waitForTimeout(1000)`~~ | Không dùng: thừa khi máy nhanh, vẫn lỗi khi máy chậm |

```ts
// Thẻ nào cũng có nút "Thêm vào giỏ": lọc đúng thẻ, rồi mới tìm nút bên trong
const sunscreen = page.getByRole('listitem').filter({ hasText: 'Kem chống nắng SPF50+' });
await sunscreen.getByRole('button', { name: 'Thêm vào giỏ' }).click();

// Lọc theo phần tử con
const clayMask = productCards(page).filter({ has: page.getByRole('heading', { name: 'Mặt nạ đất sét' }) });
await expect(clayMask.getByRole('button')).toBeDisabled();
```

File có chú thích một lỗi tinh vi: tìm "kem" ra 2 kết quả, đổi sang "chong nang" cũng ra 2 kết quả, nên
`toHaveCount(2)` pass ngay với danh sách **cũ**. Luôn kiểm tra phần nội dung thay đổi, ví dụ `toHaveText([...])`.

### 5.4. Ví dụ 4 — Chụp screenshot

[`tests/04-screenshot.spec.ts`](tests/04-screenshot.spec.ts) · `npm run test:04`, ảnh lưu trong `screenshots/<trình duyệt>/`

| Cách | Code |
|---|---|
| Toàn trang | `page.screenshot({ path, fullPage: true })` |
| Một element | `locator.screenshot({ path })` |
| Che vùng thay đổi mỗi lần tải | `page.screenshot({ path, mask: [page.getByTestId('visit-time')] })` |
| Đính kèm vào HTML report | `testInfo.attach('tên', { body: await page.screenshot(), contentType: 'image/png' })` |
| So sánh với ảnh chuẩn | `await expect(page).toHaveScreenshot('home.png')` |
| Tự chụp khi test lỗi | `screenshot: 'only-on-failure'` trong `playwright.config.ts` |

So sánh hình ảnh (visual regression) được gắn tag `@visual` và **không** chạy trong `npm test`. Lý do: ảnh chuẩn phụ
thuộc hệ điều hành, font và trình duyệt của từng máy (tên file có hậu tố, ví dụ `home-chromium-linux.png`).

```bash
npm run test:visual           # lần đầu: fail với "A snapshot doesn't exist ..., writing actual." là bình thường
npm run test:visual:update    # tạo ảnh chuẩn trong tests/04-screenshot.spec.ts-snapshots/
npm run test:visual           # các lần sau: so từng pixel với ảnh chuẩn
```

Ảnh chuẩn nằm trong `.gitignore`. Dự án thật thường tạo ảnh chuẩn trong Docker
(`mcr.microsoft.com/playwright:v1.65.1-noble`) hoặc trên CI để cả team dùng chung, rồi mới commit.

### 5.5. Ví dụ 5 — Test end-to-end

[`tests/05-e2e-checkout.spec.ts`](tests/05-e2e-checkout.spec.ts) · `npm run test:05`

Kịch bản "khách mua hàng" đi qua 4 trang, chia bước bằng `test.step`. Tên bước hiện trong terminal, report và trace.

1. Từ trang chủ vào trang Sản phẩm.
2. Tìm và thêm 2 sản phẩm vào giỏ.
3. Vào giỏ hàng, tăng số lượng, kiểm tra tổng tiền `1.117.000đ`.
4. Điền thông tin giao hàng, đặt hàng, kiểm tra cả **dữ liệu trình duyệt gửi lên server**:

   ```ts
   const orderResponse = page.waitForResponse(
     (res) => res.url().endsWith('/api/orders') && res.request().method() === 'POST',
   );
   await page.getByRole('button', { name: 'Đặt hàng' }).click();
   const response = await orderResponse;
   expect(response.status()).toBe(201);
   expect(response.request().postDataJSON()).toEqual({ customer: { ... }, paymentMethod: 'bank', items: [ ... ] });
   ```

5. Mã đơn đúng định dạng `/^DH\d{6}$/`, số trên link Giỏ hàng về 0.

File có thêm hai test ngắn:

- Xoá sản phẩm phải xác nhận hộp thoại `confirm`. Playwright mặc định tự bấm "Huỷ", nên phải đăng ký
  `page.once('dialog', ...)` **trước** khi click.
- Giỏ trống thì không hiện form đặt hàng.

---

## 6. Best practice đã áp dụng

| Nên | Tránh | Vì sao |
|---|---|---|
| `page.getByRole('button', { name: 'Đặt hàng' })` | `page.locator('#checkout-form > button.btn')` | Role và tên là thứ người dùng thấy. Đổi class, id, cấu trúc DOM là selector cứng gãy |
| `await expect(locator).toBeVisible()` | `expect(await locator.isVisible()).toBe(true)` | Cách sau chỉ kiểm tra đúng một lần, không chờ |
| `await expect(page).toHaveTitle('...')` | `expect(await page.title()).toBe('...')` | Như trên |
| `await expect(toast).toBeHidden()` | `await page.waitForTimeout(2000)` | Sleep cố định vừa chậm vừa dễ lỗi ngẫu nhiên |
| `.filter({ hasText })`, `.filter({ has })` | `.nth(3)` | Đổi thứ tự phần tử là test gãy |
| Đăng ký `waitForResponse` / `page.once('dialog')` trước hành động | Đăng ký sau khi click | Có thể bỏ lỡ sự kiện |
| `page.route()` để giả lập API lỗi | Tắt server thật để test trường hợp lỗi | Nhanh, ổn định, chạy song song được |
| Viết cứng giá trị mong đợi (`'1.117.000đ'`) | Đọc giá trị từ trang rồi so với chính nó | Test phải độc lập với code đang được test |
| `getByTestId` khi không có role hay nhãn phù hợp (`quantity`, `order-id`) | Gắn `data-testid` khắp nơi | Ưu tiên cách người dùng nhìn trang |

Thứ tự ưu tiên khi chọn locator theo tài liệu Playwright: `getByRole` → `getByLabel` → `getByPlaceholder` →
`getByText` → `getByAltText` / `getByTitle` → `getByTestId` → CSS / XPath (hạn chế).

Ngoài ra:

- Mỗi test chạy trong một browser context mới (cookie, localStorage riêng), nên chạy song song (`fullyParallel: true`)
  và theo thứ tự nào cũng được.
- Locale và múi giờ cố định trong config (`vi-VN`, `Asia/Ho_Chi_Minh`) để định dạng số và giờ giống nhau trên mọi máy.
- Playwright chạy thẳng file `.ts` nhưng **không kiểm tra kiểu**. Chạy `npm run typecheck` để bắt lỗi kiểu.
- Trên CI (`CI=true`): thử lại test lỗi 2 lần, 1 worker, chặn `test.only` bị quên.

---

## 7. Xem kết quả và gỡ lỗi

| Lệnh | Dùng khi |
|---|---|
| `npm run report` | Mở HTML report của lần chạy gần nhất: từng `test.step`, ảnh đính kèm, trace của test lỗi |
| `npx playwright show-trace test-results/<test>/trace.zip` | Tua lại từng thao tác của test lỗi, xem DOM, network, console ở mỗi bước |
| `npm run test:ui` | UI mode: chọn test để chạy, xem lại từng bước, tự chạy lại khi sửa file |
| `npm run test:headed` | Xem trình duyệt chạy thật (Chromium) |
| `npm run test:debug -- tests/02-form.spec.ts` | Playwright Inspector: chạy từng bước, thử locator |
| `npm run codegen` | Bạn thao tác trên web app (cần `npm run serve` đang chạy), Playwright ghi lại thành code |

Mỗi test lỗi còn có `test-results/<test>/error-context.md` chứa lỗi và snapshot của trang lúc lỗi. Có thể đưa thẳng
cho Claude phân tích (xem mục 6 trong `CLAUDE_MCP.md`).

---

## 8. Lệnh npm

| Lệnh | Làm gì |
|---|---|
| `npm run serve` | Chạy web app mẫu ở http://localhost:3151 |
| `npm test` | Toàn bộ test trên Chromium (bỏ qua nhóm `@visual`) |
| `npm run test:all-browsers` | Toàn bộ test trên Chromium, Firefox và WebKit |
| `npm run test:01` ... `test:05` | Từng ví dụ, trên Chromium |
| `npm run test:headed` | Như `npm test` nhưng hiện cửa sổ trình duyệt |
| `npm run test:ui` | UI mode |
| `npm run test:debug` | Playwright Inspector |
| `npm run test:visual` | So sánh hình ảnh với ảnh chuẩn |
| `npm run test:visual:update` | Tạo hoặc cập nhật ảnh chuẩn |
| `npm run report` | Mở HTML report |
| `npm run codegen` | Ghi thao tác thành code |
| `npm run typecheck` | Kiểm tra kiểu TypeScript (`tsc --noEmit`) |

`npm test` chỉ chạy Chromium cho nhanh và nhẹ máy. Chạy một trình duyệt khác: `npx playwright test --project=firefox`.
Truyền thêm tham số cho script npm thì đặt sau `--`, ví dụ `npm test -- --repeat-each=5` để chạy lặp và tìm test chập chờn.

---

## 9. Cấu trúc thư mục

```
151_playwright/
├── README.md                          bạn đang đọc
├── CLAUDE_MCP.md                      Phần 1: Playwright MCP + Claude Code, prompt mẫu
├── .mcp.json                          khai báo Playwright MCP cho Claude Code (scope project)
├── examples/
│   ├── mcp.headless.json              biến thể .mcp.json chạy ẩn (WSL, SSH, CI)
│   ├── mcp.config-file.json           biến thể .mcp.json đọc file cấu hình
│   ├── playwright-mcp.config.json     cấu hình MCP: chỉ cho phép localhost, bật tool pdf
│   └── settings.project.json          quyền dùng tool MCP trong Claude Code
├── package.json, package-lock.json
├── playwright.config.ts               baseURL, 3 trình duyệt, trace và ảnh khi lỗi, webServer
├── tsconfig.json                      cho npm run typecheck
├── .gitignore
├── src/                               WEB APP cần kiểm thử
│   ├── server.js                      server Node thuần: trang tĩnh + API giả lập
│   └── public/
│       ├── index.html, products.html, contact.html, cart.html, 404.html
│       ├── css/style.css
│       └── js/
│           ├── common.js              giỏ hàng (localStorage), định dạng tiền, hiện lỗi form
│           └── home.js, products.js, contact.js, cart.js
└── tests/                             Phần 2: TEST Playwright
    ├── 01-title.spec.ts               mở trang, tiêu đề, điều hướng, trang 404
    ├── 02-form.spec.ts                điền form, dropdown, radio, checkbox, lỗi kiểm tra dữ liệu
    ├── 03-locators-waiting.spec.ts    getByRole, filter, chờ đúng cách, waitForResponse, expect.poll, page.route
    ├── 04-screenshot.spec.ts          toàn trang, element, mask, đính kèm report, so sánh hình ảnh
    └── 05-e2e-checkout.spec.ts        tìm → thêm vào giỏ → đặt hàng, hộp thoại confirm
```

Các thư mục sinh ra khi chạy đều đã có trong `.gitignore`: `test-results/`, `playwright-report/`, `screenshots/`,
`tests/*-snapshots/`, `.playwright-mcp/`.

---

## 10. Output mẫu

`npm test`:

```
Running 23 tests using 4 workers

  ✓   1 [chromium] › tests/01-title.spec.ts:11:3 › Trang chủ › có tiêu đề đúng (961ms)
  ✓   4 [chromium] › tests/01-title.spec.ts:36:1 › đường dẫn không tồn tại trả về trang 404 (842ms)
  ✓   5 [chromium] › tests/02-form.spec.ts:10:3 › Form liên hệ › gửi thành công khi điền đủ thông tin (2.2s)
  ✓  12 [chromium] › tests/03-locators-waiting.spec.ts:41:3 › Danh sách sản phẩm › tìm kiếm có debounce: kiểm tra nội dung mới, kể cả khi gõ không dấu (2.9s)
  ✓  15 [chromium] › tests/03-locators-waiting.spec.ts:85:3 › Giả lập API bằng page.route › API lỗi: hiện thông báo, bấm "Thử lại" thì tải được (1.3s)
  ✓  17 [chromium] › tests/04-screenshot.spec.ts:14:1 › chụp toàn trang (fullPage) (1.3s)
  ✓  22 [chromium] › tests/05-e2e-checkout.spec.ts:86:1 › xoá sản phẩm phải xác nhận qua hộp thoại (1.8s)
  ✓  21 [chromium] › tests/05-e2e-checkout.spec.ts:12:1 › khách mua hàng từ đầu đến cuối (3.5s)
  …

  23 passed (12.1s)
```

Kết quả trên máy kiểm chứng:

| Lệnh | Kết quả |
|---|---|
| `npm test` (Chromium, 4 worker) | 23/23 pass, 12 giây |
| `npx playwright test --project=firefox --workers=1` | 23/23 pass, 2,5 phút (máy đang tải nặng lúc chạy) |
| `npx playwright test --project=webkit` | Không chạy được: máy thiếu thư viện hệ thống (mục 11) |
| `npm run test:visual:update` rồi `npm run test:visual` | 2/2 pass |
| `npm run typecheck` | Không có lỗi |

---

## 11. Xử lý sự cố

| Triệu chứng | Nguyên nhân | Cách sửa |
|---|---|---|
| `Executable doesn't exist at .../ms-playwright/chromium-1255/...` | Chưa tải trình duyệt, hoặc vừa nâng cấp `@playwright/test` | `npx playwright install` (hoặc `npx playwright install chromium`) |
| `Host system is missing dependencies to run browsers` | Linux thiếu thư viện, hay gặp với WebKit | `sudo npx playwright install-deps`, hoặc `sudo apt-get install` đúng các gói trong thông báo |
| Firefox / WebKit báo `Test timeout of 30000ms exceeded while running "beforeEach" hook` dù trang đã hiện đủ | Máy quá tải (nhiều trình duyệt chạy song song, ít RAM), sự kiện `load` đến quá muộn | Chạy ít worker hơn: `npx playwright test --project=firefox --workers=1`, đóng bớt ứng dụng nặng |
| Cổng 3151 đã bị chiếm | Ứng dụng khác dùng cổng này. Test có thể chạy nhầm vào ứng dụng đó vì `reuseExistingServer` | Đổi cổng: `PORT=3152 npm test` (bash) hoặc `$env:PORT=3152; npm test` (PowerShell) |
| `npm run serve` báo `Cổng 3151 đang bị chiếm` | Như trên | Như trên |
| `strict mode violation: ... resolved to 2 elements` | Locator khớp nhiều phần tử | Thu hẹp phạm vi (`menu.getByRole(...)`), thêm role, `{ exact: true }` hoặc `.filter()` |
| `A snapshot doesn't exist at ..., writing actual.` | Chạy `test:visual` khi chưa có ảnh chuẩn | `npm run test:visual:update` |
| Visual test fail trên máy khác dù giao diện không đổi | Hệ điều hành, font khác nên pixel khác | Mỗi máy tự tạo ảnh chuẩn, hoặc cùng chạy trong Docker image `mcr.microsoft.com/playwright:v1.65.1-noble` |
| Test treo ở bước click mở hộp thoại | Có listener `dialog` nhưng không gọi `accept()` / `dismiss()` | Listener nào cũng phải xử lý dialog (xem `05-e2e-checkout.spec.ts`) |
| Sai kiểu TypeScript mà test vẫn chạy | Playwright chỉ bỏ phần kiểu đi, không kiểm tra | `npm run typecheck` |
| Claude không thấy server `playwright` | Mở `claude` sai thư mục, hoặc chưa duyệt `.mcp.json` | Xem mục 10 trong [`CLAUDE_MCP.md`](CLAUDE_MCP.md) |

---

## 12. Tham khảo

- Playwright: [Bắt đầu](https://playwright.dev/docs/intro) · [Locators](https://playwright.dev/docs/locators) · [Best practices](https://playwright.dev/docs/best-practices) · [Auto-waiting](https://playwright.dev/docs/actionability) · [Assertions](https://playwright.dev/docs/test-assertions)
- [Screenshots](https://playwright.dev/docs/screenshots) · [So sánh hình ảnh](https://playwright.dev/docs/test-snapshots) · [Giả lập API](https://playwright.dev/docs/mock) · [Hộp thoại](https://playwright.dev/docs/dialogs)
- [Cấu hình test](https://playwright.dev/docs/test-configuration) · [webServer](https://playwright.dev/docs/test-webserver) · [TypeScript](https://playwright.dev/docs/test-typescript) · [Trình duyệt và install-deps](https://playwright.dev/docs/browsers) · [Docker](https://playwright.dev/docs/docker)
- [Trace viewer](https://playwright.dev/docs/trace-viewer) · [UI mode](https://playwright.dev/docs/test-ui-mode) · [Codegen](https://playwright.dev/docs/codegen)
- [Playwright MCP](https://github.com/microsoft/playwright-mcp) · [Claude Code: MCP](https://code.claude.com/docs/en/mcp) · [Playwright Test Agents](https://playwright.dev/docs/test-agents)
