'use strict';

const { kv } = require('./util');

const NO_COLOR = !!process.env.NO_COLOR || process.argv.includes('--no-color');

const C = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function paint(color, text) {
  if (NO_COLOR) return text;
  return `${C[color] || ''}${text}${C.reset}`;
}

const pad = (s, n) => String(s).padEnd(n, ' ');
const write = (line) => process.stdout.write(`${line}\n`);

/** Tiêu đề của một scenario. */
function banner(id, title, mode) {
  write('');
  write(paint('cyan', '='.repeat(78)));
  write(
    `${paint('cyan', '|')} ${paint('bold', title)} ` +
      paint('gray', `[id=${id} mode=${mode}]`)
  );
  write(paint('cyan', '='.repeat(78)));
}

/** Dòng mô tả bối cảnh đầu scenario. */
function context(text) {
  write(`${paint('gray', '  ~ ')}${paint('gray', text)}`);
}

function sagaStart(sagaId, sagaName) {
  write('');
  write(
    `${paint('blue', `[saga ${sagaId}]`)} ${paint('bold', '>> START')} ` +
      paint('gray', `saga=${sagaName}`)
  );
}

/** Một bước forward thành công. */
function stepOk(index, name, meta, ms, note) {
  write(
    `  ${paint('gray', `${index}.`)} ${pad(name, 20)} ${paint('green', 'OK   ')} ` +
      `${paint('gray', pad(`${ms}ms`, 7))} ${kv(meta)}` +
      (note ? ` ${paint('yellow', `(${note})`)}` : '')
  );
}

/** Một bước forward thất bại. */
function stepFail(index, name, error, ms, attemptInfo) {
  write(
    `  ${paint('gray', `${index}.`)} ${pad(name, 20)} ${paint('red', 'FAIL ')} ` +
      `${paint('gray', pad(`${ms}ms`, 7))} ` +
      `${paint('red', `${error.name}[${error.code}]`)} ${error.message}` +
      (attemptInfo ? ` ${paint('gray', attemptInfo)}` : '')
  );
}

function retryNotice(name, attempt, max, delayMs) {
  write(
    `     ${paint('yellow', 'retry')} ${paint('gray', `${name} lần ${attempt}/${max} sau ${delayMs}ms`)}`
  );
}

function pivotPassed(name) {
  write(
    `  ${paint('magenta', '-- PIVOT POINT đã đi qua')} ` +
      paint('gray', `(${name}) -> từ đây KHÔNG rollback, chỉ forward recovery`)
  );
}

function compensatingHeader(sagaId, cause) {
  write(
    `${paint('blue', `[saga ${sagaId}]`)} ${paint('yellow', '<< COMPENSATING')} ` +
      paint('gray', `(ngược thứ tự) nguyên nhân: ${cause}`)
  );
}

function compensateOk(name, meta, ms, note) {
  write(
    `  ${paint('yellow', '<-')} ${pad(name, 20)} ${paint('green', 'OK   ')} ` +
      `${paint('gray', pad(`${ms}ms`, 7))} ${kv(meta)}` +
      (note ? ` ${paint('yellow', `(${note})`)}` : '')
  );
}

function compensateFail(name, error, ms) {
  write(
    `  ${paint('yellow', '<-')} ${pad(name, 20)} ${paint('red', 'FAIL ')} ` +
      `${paint('gray', pad(`${ms}ms`, 7))} ` +
      `${paint('red', `${error.name}[${error.code}]`)} ${error.message}`
  );
}

function forwardRecovery(name) {
  write(
    `  ${paint('magenta', '=>')} ${paint('bold', 'FORWARD RECOVERY')} ` +
      paint('gray', `${name} nằm sau pivot -> retry/replay, tuyệt đối không bù trừ`)
  );
}

function deadLetter(entry) {
  write(
    `  ${paint('red', '[DLQ]')} ${paint('gray', kv({ type: entry.type, saga: entry.sagaId, step: entry.step }))}`
  );
  write(`        ${paint('gray', `-> ${entry.error}`)}`);
  if (entry.action) write(`        ${paint('gray', `-> cần xử lý: ${entry.action}`)}`);
}

const STATUS_COLOR = {
  COMPLETED: 'green',
  ROLLED_BACK: 'yellow',
  COMPENSATION_FAILED: 'red',
  PENDING_RECOVERY: 'magenta',
  REPLAY_IGNORED: 'cyan',
};

function sagaEnd(sagaId, status, ms) {
  const color = STATUS_COLOR[status] || 'gray';
  write(
    `${paint('blue', `[saga ${sagaId}]`)} ${paint(color, `## ${status}`)} ` +
      paint('gray', `(tổng ${ms}ms)`)
  );
}

/** Log cho phần choreography (event-driven). Chỉ in field vô hướng cho gọn. */
function event(type, payload) {
  const flat = {};
  for (const [k, v] of Object.entries(payload || {})) {
    if (v === null || typeof v !== 'object') flat[k] = v;
  }
  write(
    `  ${paint('cyan', '>>')} ${paint('bold', pad(type, 22))} ${paint('gray', kv(flat))}`
  );
}

function handler(service, action, note) {
  write(
    `     ${paint('gray', 'xử lý bởi')} ${paint('magenta', `${service}.${action}()`)}` +
      `${note ? ` ${paint('yellow', `[${note}]`)}` : ''}`
  );
}

/** Local transaction mở màn một saga choreography (trước khi có event nào). */
function localTx(service, action, meta, note) {
  write(
    `  ${paint('magenta', '**')} ${paint('bold', 'LOCAL TX')} ` +
      `${paint('magenta', `${service}.${action}()`)} ${paint('gray', kv(meta))}` +
      `${note ? ` ${paint('yellow', `[${note}]`)}` : ''}`
  );
}

function busDuplicate(type) {
  write(`  ${paint('yellow', '!!')} ${paint('gray', `giao lại (at-least-once) event ${type}`)}`);
}

/** In trạng thái in-memory store cuối scenario để KIỂM CHỨNG rollback. */
function snapshot(snap) {
  write('');
  write(`  ${paint('bold', 'TRẠNG THÁI CUỐI (bằng chứng rollback có thật hay không)')}`);
  for (const line of snap) {
    write(`    ${paint('gray', '-')} ${line}`);
  }
}

module.exports = {
  paint,
  write,
  banner,
  context,
  sagaStart,
  stepOk,
  stepFail,
  retryNotice,
  pivotPassed,
  compensatingHeader,
  compensateOk,
  compensateFail,
  forwardRecovery,
  deadLetter,
  sagaEnd,
  event,
  handler,
  localTx,
  busDuplicate,
  snapshot,
};
