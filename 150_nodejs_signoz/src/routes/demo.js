'use strict';

/**
 * Endpoint dùng để DEMO, cố tình gây lỗi hoặc chạy chậm.
 *
 * GET /api/error            chạy một bước bình thường rồi ném lỗi trong handler → 500.
 *                           Exception do instrumentation-express tự ghi, không cần code tracing.
 * GET /api/error?type=db    truy vấn DB giả lập bị timeout → exception nằm ở span DB, lan lên → 500.
 * GET /api/slow             request chậm 0,5–2 giây, nhiều bước con để soi trên waterfall/flamegraph.
 */

const express = require('express');
const { trace } = require('@opentelemetry/api');
const db = require('../lib/fake-db');
const { logger } = require('../lib/logger');
const { withSpan } = require('../lib/telemetry');
const { sleep, randomInt } = require('../lib/utils');

const router = express.Router();

router.get('/error', async (req, res) => {
  const type = req.query.type === 'db' ? 'db' : 'unhandled';
  trace.getActiveSpan()?.setAttribute('app.demo.error_type', type);
  logger.info({ type }, 'Chuẩn bị gây lỗi để demo');

  // Một bước chạy bình thường trước: trên trace sẽ thấy span thành công đứng cạnh span lỗi.
  await db.listProducts();

  if (type === 'db') {
    // Ném lỗi "canceling statement due to statement timeout" từ bên trong span DB.
    await db.runBrokenReportQuery();
  }

  // Express 5 bắt được lỗi ném ra từ async handler và chuyển tới errorHandler (lib/middlewares.js).
  throw new Error('Lỗi cố ý từ GET /api/error để demo error trace trên SigNoz');
});

router.get('/slow', async (req, res) => {
  const report = await withSpan('report.generate', async (span) => {
    // Bước 1: truy vấn tổng hợp chậm (span DB 0,3–1,2 giây).
    const rows = await db.runSlowAggregateQuery();

    // Bước 2: tính toán bằng CPU. Vòng lặp bận này CHẶN event loop trong vài chục ms: mọi request
    // khác phải đợi. Cố ý để thấy trên metric nodejs.eventloop.delay.* (instrumentation-runtime-node).
    await withSpan('report.aggregate', async (aggSpan) => {
      const busyMs = randomInt(30, 80);
      const until = Date.now() + busyMs;
      while (Date.now() < until) {
        // cố ý không làm gì: giả lập xử lý nặng CPU
      }
      aggSpan.setAttribute('app.cpu_busy_ms', busyMs);
    });

    // Bước 3: "render" báo cáo (I/O bất đồng bộ, không chặn event loop).
    await withSpan('report.render', () => sleep(randomInt(100, 400)));

    span.setAttribute('app.report.rows', rows.length);
    return rows;
  });

  res.json({ generatedAt: new Date().toISOString(), rows: report });
});

module.exports = router;
