'use strict';

const logger = require('../infra/logger');
const store = require('../infra/store');
const { scenarios } = require('./scenarios');

const FLAGS = new Set(['--list', '--no-color']);

function usage() {
  logger.write('');
  logger.write(logger.paint('bold', 'Các scenario có sẵn:'));
  logger.write('');
  for (const s of scenarios) {
    logger.write(
      `  ${logger.paint('cyan', s.id.padEnd(16))} ${logger.paint('gray', `[${s.mode}]`)} ${s.title}`
    );
  }
  logger.write('');
  logger.write(logger.paint('gray', '  node src/demo/run.js                 # chạy tất cả'));
  logger.write(logger.paint('gray', '  node src/demo/run.js rollback pivot   # chạy vài cái'));
  logger.write(logger.paint('gray', '  node src/demo/run.js --no-color       # bỏ màu (log vào file)'));
  logger.write('');
}

async function main() {
  const args = process.argv.slice(2);
  const ids = args.filter((a) => !FLAGS.has(a));

  if (args.includes('--list')) {
    usage();
    return;
  }

  const unknown = ids.filter((id) => !scenarios.some((s) => s.id === id));
  if (unknown.length > 0) {
    logger.write(logger.paint('red', `Không có scenario: ${unknown.join(', ')}`));
    usage();
    process.exitCode = 1;
    return;
  }

  const selected = ids.length > 0 ? scenarios.filter((s) => ids.includes(s.id)) : scenarios;
  const results = [];

  for (const scenario of selected) {
    logger.banner(scenario.id, scenario.title, scenario.mode);
    if (scenario.context) logger.context(scenario.context);

    // Mỗi scenario bắt đầu từ dữ liệu sạch để các demo không ảnh hưởng nhau.
    store.reset(scenario.seed);

    let status;
    try {
      status = await scenario.run();
    } catch (err) {
      status = `UNCAUGHT: ${err.message}`;
      logger.write(logger.paint('red', `  Lỗi không được xử lý: ${err.stack}`));
      process.exitCode = 1;
    }

    logger.snapshot(store.snapshot());

    const dlq = store.deadLetters();
    if (dlq.length > 0) {
      logger.write('');
      logger.write(`  ${logger.paint('bold', 'DEAD LETTER QUEUE')}`);
      for (const entry of dlq) logger.deadLetter(entry);
    }

    results.push({ id: scenario.id, mode: scenario.mode, status, dlq: dlq.length });
  }

  // ------------------------------------------------------------- tổng kết ---
  logger.write('');
  logger.write(logger.paint('cyan', '='.repeat(78)));
  logger.write(`${logger.paint('cyan', '|')} ${logger.paint('bold', 'TỔNG KẾT')}`);
  logger.write(logger.paint('cyan', '='.repeat(78)));
  for (const r of results) {
    logger.write(
      `  ${logger.paint('cyan', r.id.padEnd(16))} ${logger.paint('gray', `[${r.mode}]`.padEnd(16))} ` +
        `${r.status}${r.dlq > 0 ? logger.paint('red', `  (DLQ: ${r.dlq})`) : ''}`
    );
  }
  logger.write('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
