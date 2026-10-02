'use strict';

const logger = require('../infra/logger');
const store = require('../infra/store');
const { sleep } = require('../infra/util');

const DEFAULT_RETRY = { attempts: 3, delayMs: 30, factor: 2 };
const COMPENSATION_RETRY = { attempts: 3, delayMs: 25, factor: 2 };

/**
 * SAGA ORCHESTRATOR
 *
 * Bộ điều phối trung tâm: nó là thứ DUY NHẤT biết toàn bộ luồng. Các service
 * không biết gì về nhau, chỉ nhận lệnh và trả kết quả.
 *
 * Mỗi step khai báo:
 *   name        tên bước (dùng làm khoá idempotency + log)
 *   type        compensatable | pivot | retriable
 *   invoke      hành động thuận
 *   compensate  hành động bù trừ (chỉ step compensatable mới có)
 *   retry       ghi đè chính sách retry
 *
 * Ba loại step chính là cách saga chuẩn phân vùng một luồng:
 *
 *   [compensatable...] --> [PIVOT] --> [retriable...]
 *    còn bù trừ được        không       chỉ được đi tiếp,
 *                           quay đầu    cấm bù trừ
 */
class SagaOrchestrator {
  constructor({ name, steps }) {
    this.name = name;
    this.steps = steps;
  }

  async run(ctx, { force = false } = {}) {
    const startedAt = Date.now();

    // --- Saga log: chống chạy lại toàn bộ saga đã xong (idempotency mức saga)
    const existing = store.getSaga(ctx.sagaId);
    if (existing && existing.status === 'COMPLETED' && !force) {
      logger.sagaStart(ctx.sagaId, this.name);
      logger.sagaEnd(ctx.sagaId, 'REPLAY_IGNORED', 0);
      logger.write(
        '  ' + logger.paint('gray', 'saga log đã ghi COMPLETED trước đó -> không chạy lại bước nào')
      );
      return { sagaId: ctx.sagaId, status: 'REPLAY_IGNORED', data: existing.data };
    }

    logger.sagaStart(ctx.sagaId, this.name);
    store.saveSaga({
      sagaId: ctx.sagaId,
      name: this.name,
      status: 'RUNNING',
      request: ctx.request,
      data: ctx.data,
    });

    const compensatable = []; // các bước đã xong VÀ còn bù trừ được
    let pivotPassed = false;

    for (let i = 0; i < this.steps.length; i++) {
      const step = this.steps[i];
      const isPostPivot = pivotPassed || step.type === 'retriable';

      try {
        const output = await this.invokeWithRetry(step, ctx, i + 1);
        Object.assign(ctx.data, output);

        // Ghi saga log sau MỖI bước: crash giữa đường thì recovery job biết
        // saga đang đứng ở đâu và cần bù trừ những gì.
        store.saveSaga({
          sagaId: ctx.sagaId,
          status: 'RUNNING',
          lastStep: step.name,
          pivotPassed,
          data: ctx.data,
        });

        if (step.compensate && !pivotPassed) compensatable.push(step);
        if (step.type === 'pivot') {
          pivotPassed = true;
          logger.pivotPassed(step.name);
        }
      } catch (err) {
        ctx.failure = err;

        if (isPostPivot) {
          // SAU PIVOT: không bù trừ. Đẩy sang recovery bất đồng bộ.
          logger.forwardRecovery(step.name);
          const entry = store.pushDeadLetter({
            type: 'FORWARD_RECOVERY_REQUIRED',
            sagaId: ctx.sagaId,
            step: step.name,
            error: err.name + '[' + err.code + '] ' + err.message,
            action: 'job recovery replay bước này tới khi thành công',
          });
          logger.deadLetter(entry);
          store.saveSaga({ sagaId: ctx.sagaId, status: 'PENDING_RECOVERY', data: ctx.data });
          logger.sagaEnd(ctx.sagaId, 'PENDING_RECOVERY', Date.now() - startedAt);
          return { sagaId: ctx.sagaId, status: 'PENDING_RECOVERY', data: ctx.data, failure: err };
        }

        // TRƯỚC PIVOT: bù trừ ngược thứ tự.
        const status = await this.compensate(compensatable, ctx, err);
        store.saveSaga({ sagaId: ctx.sagaId, status, data: ctx.data });
        logger.sagaEnd(ctx.sagaId, status, Date.now() - startedAt);
        return { sagaId: ctx.sagaId, status, data: ctx.data, failure: err };
      }
    }

    store.saveSaga({ sagaId: ctx.sagaId, status: 'COMPLETED', data: ctx.data });
    logger.sagaEnd(ctx.sagaId, 'COMPLETED', Date.now() - startedAt);
    return { sagaId: ctx.sagaId, status: 'COMPLETED', data: ctx.data };
  }

  /** Gọi bước thuận, có retry nhưng CHỈ với lỗi tạm thời. */
  async invokeWithRetry(step, ctx, index) {
    const policy = Object.assign({}, DEFAULT_RETRY, step.retry || {});
    let attempt = 0;

    for (;;) {
      attempt += 1;
      const t0 = Date.now();
      try {
        const output = await step.invoke(ctx);
        logger.stepOk(
          index,
          step.name,
          strip(output),
          Date.now() - t0,
          output._replayed ? 'idempotent replay' : null
        );
        return output;
      } catch (err) {
        // Lỗi nghiệp vụ thì retry vô nghĩa -> thoát ngay sang compensation.
        const canRetry = err.retryable === true && attempt < policy.attempts;
        logger.stepFail(
          index,
          step.name,
          err,
          Date.now() - t0,
          'attempt ' + attempt + '/' + policy.attempts
        );
        if (!canRetry) throw err;

        const delay = Math.round(policy.delayMs * Math.pow(policy.factor, attempt - 1));
        logger.retryNotice(step.name, attempt + 1, policy.attempts, delay);
        await sleep(delay);
      }
    }
  }

  /**
   * Bù trừ các bước đã commit, theo thứ tự NGƯỢC.
   *
   * Hai quy tắc sống còn:
   *  1. Một compensation lỗi thì VẪN phải chạy tiếp các compensation còn lại.
   *     Dừng giữa đường chỉ để lại nhiều rác hơn.
   *  2. Compensation lỗi vĩnh viễn -> DLQ, saga chuyển COMPENSATION_FAILED để
   *     người/job đối soát. Tuyệt đối không im lặng báo thành công.
   */
  async compensate(compensatable, ctx, cause) {
    logger.compensatingHeader(
      ctx.sagaId,
      cause.name + '[' + cause.code + '] ' + cause.message
    );

    const failures = [];
    for (const step of compensatable.slice().reverse()) {
      const policy = Object.assign({}, COMPENSATION_RETRY, step.compensateRetry || {});
      const label = compensationName(step);
      let attempt = 0;
      let done = false;

      while (!done) {
        attempt += 1;
        const t0 = Date.now();
        try {
          const output = await step.compensate(ctx);
          logger.compensateOk(
            label,
            strip(output),
            Date.now() - t0,
            output._replayed ? 'idempotent replay' : null
          );
          done = true;
        } catch (err) {
          logger.compensateFail(label, err, Date.now() - t0);
          // Compensation thì retry cả lỗi nghiệp vụ, vì bỏ dở là mất dữ liệu.
          if (attempt < policy.attempts) {
            const delay = Math.round(policy.delayMs * Math.pow(policy.factor, attempt - 1));
            logger.retryNotice(label, attempt + 1, policy.attempts, delay);
            await sleep(delay);
            continue;
          }
          failures.push(step.name);
          const entry = store.pushDeadLetter({
            type: 'COMPENSATION_FAILED',
            sagaId: ctx.sagaId,
            step: label,
            error: err.name + '[' + err.code + '] ' + err.message,
            action: 'đối soát thủ công / chạy lại bù trừ sau khi service hồi phục',
          });
          logger.deadLetter(entry);
          done = true;
        }
      }
    }

    return failures.length > 0 ? 'COMPENSATION_FAILED' : 'ROLLED_BACK';
  }
}

const compensationName = (step) => step.compensate.actionName || step.name + '.compensate';

/** Bỏ các field nội bộ (_replayed...) khỏi log. */
function strip(output) {
  const clean = {};
  for (const [k, v] of Object.entries(output || {})) {
    if (!k.startsWith('_')) clean[k] = v;
  }
  return clean;
}

module.exports = { SagaOrchestrator };
