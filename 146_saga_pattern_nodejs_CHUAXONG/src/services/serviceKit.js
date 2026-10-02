'use strict';

const { sleep } = require('../infra/util');
const { runOnce } = require('../infra/store');

/**
 * Bọc một hành động của service với 3 thứ mà mọi bước saga đều phải có:
 *
 *  1. Độ trễ mô phỏng (gọi qua mạng chứ không phải gọi hàm local).
 *  2. Điểm tiêm lỗi để demo các nhánh thất bại.
 *  3. IDEMPOTENCY GUARD: khoá theo `sagaId:action`. Gọi lại lần 2 với cùng
 *     sagaId sẽ trả về kết quả cũ, KHÔNG áp dụng tác dụng phụ lần nữa.
 *
 * Thứ tự quan trọng: guard nằm NGOÀI cùng, nên bản replay không sleep, không
 * tiêm lỗi, không ghi DB. Lỗi thì không được cache -> retry vẫn chạy lại thật.
 */
function action(name, latencyMs, run) {
  const wrapped = async (ctx) => {
    const { value, replayed } = await runOnce(`${ctx.sagaId}:${name}`, async () => {
      await sleep(latencyMs);
      ctx.faults.check(name);
      return run(ctx);
    });
    return { ...value, _replayed: replayed };
  };
  wrapped.actionName = name;
  return wrapped;
}

module.exports = { action };
