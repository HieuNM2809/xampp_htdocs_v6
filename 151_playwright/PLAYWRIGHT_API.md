# Playwright: thuộc tính và hành động của Locator, Page

Tài liệu tra cứu nhanh các **action** (hành động: click, fill, hover...) và **property/assertion**
(thuộc tính, trạng thái: text, value, checked, visible...) hay dùng khi viết test `@playwright/test`. Bổ sung cho
[`README.md`](README.md) (5 ví dụ test chạy được) và [`CLAUDE_MCP.md`](CLAUDE_MCP.md) (điều khiển trình duyệt qua
Playwright MCP) — không lặp lại nội dung hai file đó, chỉ dẫn link khi cần.

Dựa trên `@playwright/test` 1.65.1 (bản khai báo trong `package.json` của thư mục này). Mọi ví dụ code lấy từ
`tests/01..05` để vừa đọc lý thuyết vừa đối chiếu code thật (mục 8).

---

## Mục lục

1. [Cách tạo locator](#1-cách-tạo-locator)
2. [Hành động trên locator](#2-hành-động-trên-locator)
3. [Thuộc tính và trạng thái của locator](#3-thuộc-tính-và-trạng-thái-của-locator)
4. [Actionability: Playwright tự chờ gì trước khi hành động](#4-actionability-playwright-tự-chờ-gì-trước-khi-hành-động)
5. [Assertions tự chờ với expect](#5-assertions-tự-chờ-với-expect)
6. [Bàn phím, chuột và cảm ứng](#6-bàn-phím-chuột-và-cảm-ứng)
7. [Hành động cấp trang](#7-hành-động-cấp-trang)
8. [Đối chiếu với code trong thư mục này](#8-đối-chiếu-với-code-trong-thư-mục-này)
9. [Tham khảo](#9-tham-khảo)

---

## 1. Cách tạo locator

`page.getByRole()`, `page.locator()`... chỉ **mô tả cách tìm**, chưa truy vấn DOM. Mỗi lần dùng nó để thao tác hay
assertion, Playwright tìm lại từ đầu nên luôn thấy DOM mới nhất — xem comment trong
[`tests/03-locators-waiting.spec.ts:6`](tests/03-locators-waiting.spec.ts).

| Cách tạo | Tìm theo | Ví dụ |
|---|---|---|
| `getByRole(role, { name })` | Vai trò ARIA + tên accessible — ưu tiên dùng trước tiên | `page.getByRole('button', { name: 'Đặt hàng' })` |
| `getByLabel(text)` | `<label>` gắn với ô nhập | `page.getByLabel('Họ và tên')` |
| `getByPlaceholder(text)` | Thuộc tính `placeholder` | `page.getByPlaceholder('Nhập email')` |
| `getByText(text)` | Nội dung chữ hiển thị | `page.getByText('Cảm ơn')` |
| `getByAltText(text)` / `getByTitle(text)` | `alt` của ảnh / `title` | `page.getByAltText('Ảnh sản phẩm')` |
| `getByTestId(id)` | `data-testid` (đổi tên qua `testIdAttribute`) | `page.getByTestId('cart-total')` |
| `locator(cssOrXPath)` | CSS hoặc `xpath=...` — hạn chế, dùng sau cùng | `page.locator('#checkout-form')` |
| `frameLocator(selector)` | Vào trong `<iframe>` rồi mới `.locator()` tiếp | `page.frameLocator('#payment').getByRole('button')` |

Thứ tự ưu tiên đầy đủ và lý do chọn: mục 6 trong [`README.md`](README.md#6-best-practice-đã-áp-dụng).

Thu hẹp hoặc kết hợp locator (không phải hành động, chỉ đổi **tập phần tử** sẽ thao tác):

| Phương thức | Tác dụng |
|---|---|
| `.filter({ hasText })` / `.filter({ hasNotText })` | Giữ lại phần tử có / không có đoạn chữ này |
| `.filter({ has: locator })` / `.filter({ hasNot: locator })` | Giữ lại phần tử chứa / không chứa locator con này |
| `.and(locator)` / `.or(locator)` | Giao / hợp hai locator |
| `.first()` / `.last()` / `.nth(i)` | Phần tử đầu / cuối / thứ `i` (đánh số từ 0) — tránh dùng nếu thứ tự phần tử có thể đổi |
| `.locator(selector)` | Tìm tiếp bên trong, ví dụ `card.getByRole('button')` |

```ts
// tests/03-locators-waiting.spec.ts
const sunscreen = productCards(page).filter({ hasText: 'Kem chống nắng SPF50+' });
const clayMask = productCards(page).filter({ has: page.getByRole('heading', { name: 'Mặt nạ đất sét' }) });
```

---

## 2. Hành động trên locator

Mọi hành động bên dưới (trừ `scrollIntoViewIfNeeded`, `focus`, `blur`, `highlight`) đều tự chờ actionability
(mục 4) trước khi thao tác — không cần tự viết chờ trước đó.

| Nhóm | Phương thức | Làm gì |
|---|---|---|
| Chuột | `click(options?)` | Click chuột trái. Tuỳ chọn hay dùng: `button: 'left'\|'right'\|'middle'`, `clickCount`, `modifiers: ['Shift'\|'Control'\|'Alt'\|'Meta']`, `position: {x,y}`, `delay`, `force`, `trial` |
| | `dblclick(options?)` | Double click |
| | `hover(options?)` | Di chuột tới, không click |
| | `tap(options?)` | Chạm, cần context/device giả lập cảm ứng (`hasTouch: true`) |
| Nhập liệu | `fill(value)` | Xoá hết rồi điền giá trị mới **ngay lập tức** — nhanh, nhưng không bắn đủ sự kiện bàn phím |
| | `pressSequentially(text, options?)` | Gõ **từng ký tự** thật (đủ `keydown`/`keyup`), dùng khi trang xử lý theo từng phím (autocomplete...). Thay cho `type()` đã deprecated |
| | `press(key)` | Nhấn một phím hoặc tổ hợp, ví dụ `'Enter'`, `'Control+A'` |
| | `clear()` | Xoá nội dung input/textarea |
| | `selectText(options?)` | Bôi đen toàn bộ text trong ô |
| Chọn | `check(options?)` / `uncheck(options?)` | Tick / bỏ tick checkbox, radio — bỏ qua nếu đã đúng trạng thái |
| | `setChecked(checked, options?)` | Đặt thẳng `true`/`false`, tự gọi `check()` hoặc `uncheck()` |
| | `selectOption(values, options?)` | Chọn option trong `<select>`: nhận `value`, `{ label }`, `{ index }` hoặc mảng (multi-select) |
| File | `setInputFiles(files, options?)` | Gán file cho `<input type="file">`: đường dẫn, mảng đường dẫn, `{ name, mimeType, buffer }`, hoặc `[]` để xoá lựa chọn |
| Kéo thả | `dragTo(target, options?)` | Kéo phần tử này rồi thả vào locator `target` |
| Khác | `focus()` / `blur()` | Đưa / bỏ focus bàn phím, không cần phần tử đang hiển thị |
| | `scrollIntoViewIfNeeded()` | Cuộn tới phần tử nếu đang ngoài viewport — hiếm khi cần gọi tay vì action nào cũng tự cuộn trước khi thao tác |
| | `highlight()` | Khoanh đỏ phần tử trên trình duyệt thật — chỉ để debug lúc viết test, không dùng trong test chạy thật |

```ts
// tests/02-form.spec.ts — selectOption, check
await page.getByLabel('Chủ đề').selectOption({ label: 'Tư vấn sản phẩm' });
await page.getByRole('radio', { name: 'Điện thoại' }).check();

// tests/05-e2e-checkout.spec.ts — click, lấy đúng nút bằng tên thay vì vị trí
await sunscreenRow.getByRole('button', { name: /^Tăng số lượng/ }).click();
```

`force: true` bỏ qua mọi actionability check (trừ "Attached") — chỉ dùng khi chắc chắn, vì dễ che giấu bug thật
(phần tử bị khuất, bị vô hiệu hoá). `trial: true` chỉ kiểm tra điều kiện sẵn sàng, **không** thật sự thao tác —
dùng để chờ mà chưa muốn bấm.

Phiên bản cũ của Playwright có `page.click(selector)`, `page.fill(selector, value)`... gọi thẳng trên `Page`/`Frame`
không qua `Locator`. Vẫn chạy được nhưng Playwright khuyên dùng `Locator` (`page.locator(...).click()`) vì mỗi lần
thao tác tự tìm lại phần tử, tránh giữ tham chiếu tới phần tử đã biến mất khỏi DOM (stale).

---

## 3. Thuộc tính và trạng thái của locator

Hai cách đọc trạng thái một phần tử, khác nhau ở chỗ **có tự chờ hay không**:

- **Đọc một lần** (`isVisible()`, `textContent()`...): trả về ngay giá trị hiện tại, không thử lại. Hợp để tính
  toán, log, hoặc rẽ nhánh `if` trong test.
- **Assertion** (`expect(locator).toBeVisible()`, `toHaveText()`...): tự thử lại tới khi đúng hoặc hết timeout
  (mặc định 5 giây). **Luôn ưu tiên cách này khi mục đích là kiểm tra**, như comment trong
  [`tests/01-title.spec.ts:12-13`](tests/01-title.spec.ts) đã nhắc: tránh `expect(await page.title()).toBe(...)`
  vì chỉ đọc đúng một lần, không chờ.

| Phương thức đọc một lần | Trả về | Assertion tương ứng (mục 5) |
|---|---|---|
| `textContent()` | `string \| null` — toàn bộ text kể cả phần tử con đang ẩn | `toHaveText()`, `toContainText()` |
| `innerText()` | `string` — text như mắt người thấy (theo CSS render) | `toHaveText()` |
| `innerHTML()` | `string` | — |
| `inputValue()` | `string` — value của `input`/`textarea`/`select` | `toHaveValue()`, `toHaveValues()` |
| `getAttribute(name)` | `string \| null` — thuộc tính HTML, ví dụ `href`, `aria-invalid` | `toHaveAttribute()` |
| `isVisible()` / `isHidden()` | `boolean` | `toBeVisible()` / `toBeHidden()` |
| `isEnabled()` / `isDisabled()` | `boolean` | `toBeEnabled()` / `toBeDisabled()` |
| `isEditable()` | `boolean` | `toBeEditable()` |
| `isChecked()` | `boolean` | `toBeChecked()` |
| `count()` | `number` — số phần tử khớp **ngay lúc gọi** | `toHaveCount()` |
| `all()` | `Locator[]` — một locator cho mỗi phần tử khớp, để `for` lặp qua | — |
| `boundingBox()` | `{x, y, width, height} \| null` (toạ độ trang) | — |
| `ariaSnapshot()` | `string` (YAML cây accessibility của phần tử) — cùng định dạng Playwright MCP trả về, xem mục 5 trong [`CLAUDE_MCP.md`](CLAUDE_MCP.md#5-prompt-mẫu) | `toMatchAriaSnapshot()` |
| `page()` | `Page` chứa locator này | — |

```ts
// tests/03-locators-waiting.spec.ts:78-80 — giá trị nằm ngoài DOM (localStorage) không đọc được qua locator,
// nhưng cùng tinh thần "đọc rồi tự so sánh, tự thử lại" như các assertion ở trên
await expect
  .poll(() => page.evaluate(() => JSON.parse(localStorage.getItem('mini-shop-cart') ?? '[]')))
  .toEqual([{ id: 3, name: 'Toner cân bằng ẩm 200ml', price: 245000, quantity: 1 }]);
```

---

## 4. Actionability: Playwright tự chờ gì trước khi hành động

Trước mỗi hành động, Playwright chờ phần tử đạt đủ các điều kiện sau. Không có giới hạn thời gian riêng cho từng
action trong project này (`actionTimeout` mặc định là 0 — không giới hạn riêng), nên bị chặn bởi timeout chung của
cả test (mặc định 30 giây).

| Điều kiện | Nghĩa là |
|---|---|
| Attached | Đã gắn vào DOM |
| Visible | Có kích thước khác 0, không `visibility: hidden` / `display: none` |
| Stable | Không còn animation — hai khung hình liên tiếp có cùng vị trí |
| Receives Events | Là phần tử nằm trên cùng tại điểm thao tác (không bị phần tử khác che) |
| Enabled | Không có thuộc tính/`aria-disabled` vô hiệu hoá |
| Editable | `Enabled` và không `readonly` |

Mỗi hành động đòi hỏi một tập điều kiện khác nhau (theo [playwright.dev/docs/actionability](https://playwright.dev/docs/actionability),
bản mới của Playwright có thể đổi đôi chút). ✓ = Playwright chờ điều kiện đó; để trống = không cần:

| Hành động | Attached | Visible | Stable | Receives Events | Enabled | Editable |
|---|---|---|---|---|---|---|
| `click`, `dblclick`, `tap`, `check`, `uncheck`, `setChecked`, `dragTo` | ✓ | ✓ | ✓ | ✓ | ✓ | |
| `hover` | ✓ | ✓ | ✓ | ✓ | | |
| `fill`, `selectText`, `pressSequentially`, `clear` | ✓ | ✓ | | | ✓ | ✓ |
| `selectOption` | ✓ | ✓ | | | ✓ | |
| `press`, `focus`, `setInputFiles`, `scrollIntoViewIfNeeded` | ✓ | | | | | |

`page.screenshot()` / `locator.screenshot()` chỉ cần Attached + Visible + Stable (không thao tác nên không cần
Enabled/Receives Events).

Hết timeout mà vẫn chưa đủ điều kiện, Playwright ném `TimeoutError` kèm log từng điều kiện đã qua/chưa qua — đọc
log này là cách nhanh để biết vì sao một action bị treo, bổ sung cho cách dùng `error-context.md` ở mục 7 trong
`README.md`.

---

## 5. Assertions tự chờ với expect

Mọi `expect(locator)...`, `expect(page)...` bên dưới đều **tự thử lại** tới khi đúng hoặc hết timeout (mặc định
5000ms, đổi bằng `expect: { timeout }` trong `playwright.config.ts` — project này chưa đổi nên dùng mặc định).
Thêm `.not` để phủ định, ví dụ `expect(locator).not.toBeVisible()`.

| Nhóm | Assertion | Đúng khi |
|---|---|---|
| Trạng thái | `toBeVisible()` / `toBeHidden()` | Hiển thị / không hiển thị (hoặc không còn trong DOM) |
| | `toBeAttached()` | Có trong DOM, không quan tâm hiển thị hay không |
| | `toBeEnabled()` / `toBeDisabled()` | Có thể / không thể thao tác |
| | `toBeEditable()` | Có thể nhập liệu |
| | `toBeChecked(options?)` | Checkbox/radio đang tick (`{ checked: false }` để kiểm tra ngược, `{ indeterminate: true }` cho trạng thái lửng) |
| | `toBeEmpty()` | Input rỗng hoặc phần tử không có nội dung con |
| | `toBeFocused()` | Đang được focus |
| | `toBeInViewport()` | Nằm trong phần đang cuộn thấy của trang |
| Nội dung, thuộc tính | `toHaveText(text\|regex\|[])` | Text khớp chính xác (mảng = khớp từng phần tử theo đúng thứ tự, xem `tests/03-locators-waiting.spec.ts:47`) |
| | `toContainText(text\|[])` | Chứa đoạn text đó, không cần khớp hết |
| | `toHaveValue(text)` / `toHaveValues([...])` | Value của input / của `<select multiple>` |
| | `toHaveAttribute(name, value?)` | Có thuộc tính HTML đó (bỏ `value` = chỉ cần thuộc tính tồn tại) |
| | `toHaveClass(className\|regex)` | Giá trị `class` khớp |
| | `toHaveCount(n)` | Số phần tử khớp locator |
| | `toHaveCSS(name, value)` | Giá trị CSS đã tính toán (computed style) |
| | `toHaveId(id)` | Thuộc tính `id` |
| | `toHaveJSProperty(name, value)` | Property trên đối tượng DOM (khác attribute HTML) |
| | `toHaveAccessibleName()` / `toHaveAccessibleDescription()` | Tên / mô tả accessible (`aria-label`, `aria-describedby`...) — `tests/02-form.spec.ts:41` dùng để đọc lỗi gắn qua `aria-describedby` |
| | `toHaveRole(role)` | Vai trò ARIA tính toán được |
| | `toMatchAriaSnapshot()` | So cây accessibility (YAML) với bản mẫu |
| | `toHaveScreenshot(name?)` | So khớp ảnh chuẩn — mục 5.4 trong `README.md`, gắn tag `@visual` |
| Page, Response | `expect(page).toHaveTitle(text\|regex)` | Tiêu đề trang |
| | `expect(page).toHaveURL(text\|regex)` | URL hiện tại |
| | `expect(page).toHaveScreenshot(name?)` | Ảnh toàn trang khớp ảnh chuẩn |
| | `expect(response).toBeOK()` | Mã trạng thái HTTP trong khoảng 200–299 |

Ngoài so sánh một locator/page, `expect` còn có:

| Cách dùng | Khi nào |
|---|---|
| `expect.soft(locator).toBeVisible()` | Assertion lỗi vẫn không dừng test ngay — test chạy tiếp, báo fail ở cuối. Hợp khi muốn thấy hết lỗi trong một lần chạy |
| `expect.poll(() => ...).toBe(x)` | Gọi lại hàm bất kỳ tới khi khớp — dùng cho giá trị ngoài DOM, như đọc `localStorage` ở mục 3 |
| `expect(async () => { ... }).toPass()` | Thử lại **cả khối code** tới khi không còn assertion nào bên trong ném lỗi |

---

## 6. Bàn phím, chuột và cảm ứng

API cấp thấp, không gắn với một locator cụ thể — hiếm khi cần vì mọi hành động ở mục 2 đã tự di chuột/gõ phím
đúng chỗ. Chỉ dùng khi mô phỏng thao tác không gắn với phần tử nào (phím tắt toàn cục) hoặc tự dựng chuỗi thao tác
riêng (vẽ, kéo thả tự chế).

| Đối tượng | Phương thức | Làm gì |
|---|---|---|
| `page.keyboard` | `press(key, options?)` | Nhấn rồi thả một phím/tổ hợp |
| | `down(key)` / `up(key)` | Giữ / thả riêng một phím — dùng khi cần giữ phím qua nhiều thao tác khác |
| | `insertText(text)` | Chèn thẳng text, không bắn sự kiện phím (nhanh hơn, nhưng JS lắng nghe `keydown` sẽ không thấy) |
| `page.mouse` | `move(x, y, options?)` | Di chuột tới toạ độ trang, `steps` để di chuyển mượt qua nhiều bước |
| | `down(options?)` / `up(options?)` | Giữ / thả nút chuột |
| | `click(x, y, options?)` / `dblclick(x, y, options?)` | Click theo toạ độ (khi không có locator phù hợp) |
| | `wheel(deltaX, deltaY)` | Mô phỏng cuộn chuột |
| `page.touchscreen` | `tap(x, y)` | Chạm theo toạ độ — cần context/device giả lập cảm ứng (`hasTouch`, `isMobile`) |

---

## 7. Hành động cấp trang

| Phương thức | Làm gì |
|---|---|
| `page.goto(url, options?)` | Mở URL. `waitUntil`: `'load'` (mặc định), `'domcontentloaded'`, `'commit'`. Trả về `Response` nên kiểm tra được mã lỗi mà không bị ném lỗi (`tests/01-title.spec.ts:37-39`) |
| `page.reload(options?)` | Tải lại trang (`tests/05-e2e-checkout.spec.ts:81`, kiểm tra giỏ hàng trống sau khi đặt hàng) |
| `page.goBack()` / `page.goForward()` | Điều hướng như nút back/forward của trình duyệt |
| `page.waitForURL(urlOrRegex)` | Chờ URL đổi đúng — thường dùng `expect(page).toHaveURL()` thay vì gọi trực tiếp |
| `page.waitForResponse(urlOrPredicate)` / `waitForRequest(...)` | Chờ một network call cụ thể. **Đăng ký trước hành động gây ra request** (`tests/03-locators-waiting.spec.ts:62`, `tests/05-e2e-checkout.spec.ts:56`) |
| `page.waitForEvent(event, optionsOrPredicate?)` | Chờ một sự kiện bất kỳ của `Page` (`'dialog'`, `'download'`, `'popup'`...) |
| `page.route(url, handler)` / `page.unroute(...)` | Chặn request khớp `url`, tự trả lời bằng `route.fulfill()`, cho đi tiếp bằng `route.continue()`, hoặc huỷ bằng `route.abort()`. Phải đăng ký **trước khi** gây ra request (`tests/03-locators-waiting.spec.ts:87`) |
| `page.evaluate(fn, arg?)` / `evaluateHandle(...)` | Chạy JavaScript trong trang, trả kết quả về Node |
| `page.addInitScript(fn)` | Chạy script trước khi trang của bạn chạy — hợp để giả lập/ghi đè API trình duyệt |
| `page.screenshot(options?)` / `page.pdf(options?)` | Chụp ảnh toàn trang (`fullPage`, `mask`...); `pdf()` chỉ chạy được trên Chromium headless. Chi tiết mục 5.4 trong `README.md` |
| `page.setViewportSize({ width, height })` | Đổi kích thước viewport giữa chừng |
| `page.emulateMedia({ colorScheme, reducedMotion, media })` | Giả lập dark mode, giảm animation, chế độ in |
| `page.on(event, handler)` / `page.once(event, handler)` | Lắng nghe sự kiện liên tục / một lần. `'dialog'` phải đăng ký **trước khi click** nút mở hộp thoại, nếu không Playwright tự bấm "Huỷ" (`tests/05-e2e-checkout.spec.ts:101`) |

---

## 8. Đối chiếu với code trong thư mục này

| Khái niệm | Xem trong |
|---|---|
| `fill`, `selectOption`, `check`, đọc `toHaveValue`/`toBeChecked` | `tests/02-form.spec.ts` |
| `getByRole` + `filter({ hasText })` / `filter({ has })`, xâu chuỗi locator | `tests/03-locators-waiting.spec.ts` |
| `waitForResponse` đăng ký trước hành động | `tests/03-locators-waiting.spec.ts:62`, `tests/05-e2e-checkout.spec.ts:56` |
| `page.route()` giả lập API lỗi và dữ liệu tuỳ ý | `tests/03-locators-waiting.spec.ts:85-112` |
| `expect.poll()` đọc `localStorage` | `tests/03-locators-waiting.spec.ts:78` |
| `page.screenshot()`, `locator.screenshot()`, `mask`, `toHaveScreenshot()` | `tests/04-screenshot.spec.ts` |
| `test.step()` chia kịch bản nhiều bước | `tests/05-e2e-checkout.spec.ts` |
| `page.once('dialog', ...)` xử lý `confirm` | `tests/05-e2e-checkout.spec.ts:101-104` |
| Kiểm tra body request gửi lên server (`response.request().postDataJSON()`) | `tests/05-e2e-checkout.spec.ts:64` |

Best practice chọn locator và các cặp "nên / tránh": mục 6 trong [`README.md`](README.md#6-best-practice-đã-áp-dụng).
Cách Playwright MCP đọc trạng thái trang qua cây accessibility (liên quan `ariaSnapshot()` ở mục 3):
[`CLAUDE_MCP.md`](CLAUDE_MCP.md#4-các-tool-claude-dùng-được).

---

## 9. Tham khảo

- [Actions](https://playwright.dev/docs/input) · [Locators](https://playwright.dev/docs/locators) ·
  [Actionability](https://playwright.dev/docs/actionability) · [Assertions](https://playwright.dev/docs/test-assertions)
- [API: class Locator](https://playwright.dev/docs/api/class-locator) · [API: class Page](https://playwright.dev/docs/api/class-page) ·
  [API: class Keyboard](https://playwright.dev/docs/api/class-keyboard) · [API: class Mouse](https://playwright.dev/docs/api/class-mouse)
- [Network](https://playwright.dev/docs/network) · [Dialogs](https://playwright.dev/docs/dialogs) ·
  [Screenshots](https://playwright.dev/docs/screenshots)
- Xem thêm: [`README.md`](README.md) (5 ví dụ test chạy được), [`CLAUDE_MCP.md`](CLAUDE_MCP.md) (điều khiển trình duyệt qua MCP)
