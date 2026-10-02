'use strict';

const logger = require('../infra/logger');
const store = require('../infra/store');
const { createFaultInjector, noFaults } = require('../infra/faults');
const { createOrderSaga } = require('../orchestration/orderSaga');
const { runOrderChoreography } = require('../choreography/runner');

/** Đơn hàng dùng chung cho mọi scenario: 2 x iPhone 15 = 52.000.000đ */
const REQUEST = { customerId: 'CUS-01', sku: 'IPHONE-15', qty: 2, unitPrice: 26000000 };

const RICH = {
  products: [{ sku: 'IPHONE-15', name: 'iPhone 15', stock: 5, price: 26000000 }],
  wallets: [{ customerId: 'CUS-01', balance: 100000000 }],
};

const BROKE = {
  products: [{ sku: 'IPHONE-15', name: 'iPhone 15', stock: 5, price: 26000000 }],
  wallets: [{ customerId: 'CUS-01', balance: 10000000 }],
};

/** Gói ctx cho orchestration. */
const ctxOf = (sagaId, faults) => ({
  sagaId,
  request: REQUEST,
  data: {},
  faults,
  failure: null,
});

const scenarios = [
  // =========================================================== ORCHESTRATION
  {
    id: 'success',
    mode: 'orchestration',
    title: '1. HAPPY PATH - saga chạy hết 6 bước',
    context: 'Ví 100.000.000đ, tồn kho 5. Không có lỗi nào.',
    seed: RICH,
    async run() {
      const saga = createOrderSaga();
      const result = await saga.run(ctxOf('SAGA-0001', noFaults()));
      return result.status;
    },
  },

  {
    id: 'rollback',
    mode: 'orchestration',
    title: '2. ROLLBACK - hết tiền ở bước thanh toán',
    context:
      'Ví chỉ có 10.000.000đ nhưng đơn 52.000.000đ. Lỗi NGHIỆP VỤ nên không retry, ' +
      'bù trừ ngay 2 bước đã commit.',
    seed: BROKE,
    async run() {
      const saga = createOrderSaga();
      const result = await saga.run(ctxOf('SAGA-0002', noFaults()));
      return result.status;
    },
  },

  {
    id: 'retry',
    mode: 'orchestration',
    title: '3. RETRY rồi ROLLBACK - phân biệt lỗi tạm thời và lỗi nghiệp vụ',
    context:
      'inventory.reserve timeout 2 lần đầu (retry cứu được), sau đó shipping.schedule ' +
      'báo hết xe - lỗi nghiệp vụ, phải bù trừ 3 bước.',
    seed: RICH,
    async run() {
      const faults = createFaultInjector({
        'inventory.reserve': {
          kind: 'transient',
          code: 'TIMEOUT',
          times: 2,
          message: 'inventory service không phản hồi',
        },
        'shipping.schedule': {
          kind: 'business',
          code: 'NO_COURIER',
          message: 'không còn đối tác giao khu vực này',
        },
      });
      const result = await createOrderSaga().run(ctxOf('SAGA-0003', faults));
      return result.status;
    },
  },

  {
    id: 'pivot',
    mode: 'orchestration',
    title: '4. PIVOT POINT - sau điểm không quay đầu thì chỉ forward recovery',
    context:
      'Hàng đã giao cho tài xế (carrier.handover). Bước order.confirm lỗi. ' +
      'Saga KHÔNG được rollback - chỉ được retry đi tiếp.',
    seed: RICH,
    async run() {
      logger.write('');
      logger.write('  --- 4a. order.confirm timeout 2 lần rồi thành công ---');
      const okFaults = createFaultInjector({
        'order.confirm': {
          kind: 'transient',
          code: 'DB_TIMEOUT',
          times: 2,
          message: 'order DB quá tải',
        },
      });
      const a = await createOrderSaga().run(ctxOf('SAGA-0004', okFaults));

      logger.write('');
      logger.write('  --- 4b. order.confirm lỗi vĩnh viễn -> DLQ, KHÔNG rollback ---');
      store.reset(RICH);
      const badFaults = createFaultInjector({
        'order.confirm': {
          kind: 'transient',
          code: 'DB_TIMEOUT',
          message: 'order DB quá tải (không hồi phục)',
        },
      });
      const b = await createOrderSaga().run(ctxOf('SAGA-0005', badFaults));

      return `${a.status} + ${b.status}`;
    },
  },

  {
    id: 'comp-fail',
    mode: 'orchestration',
    title: '5. COMPENSATION CŨNG THẤT BẠI - trường hợp tệ nhất',
    context:
      'Thẻ bị từ chối, cần bù trừ. Nhưng inventory service đang chết nên ' +
      'inventory.release không chạy được -> DLQ, saga vào COMPENSATION_FAILED.',
    seed: RICH,
    async run() {
      const faults = createFaultInjector({
        'payment.charge': {
          kind: 'business',
          code: 'CARD_DECLINED',
          message: 'cổng thanh toán từ chối thẻ',
        },
        'inventory.release': {
          kind: 'transient',
          code: 'SERVICE_DOWN',
          message: 'inventory service trả 503',
        },
      });
      const result = await createOrderSaga().run(ctxOf('SAGA-0006', faults));
      return result.status;
    },
  },

  {
    id: 'idempotency',
    mode: 'orchestration',
    title: '6. IDEMPOTENCY - chạy lại saga không được trừ tiền lần hai',
    context: 'Cùng một sagaId được submit 3 lần: lần đầu chạy thật, 2 lần sau phải vô hại.',
    seed: RICH,
    async run() {
      const saga = createOrderSaga();

      logger.write('');
      logger.write('  --- 6a. lần đầu: chạy thật ---');
      const a = await saga.run(ctxOf('SAGA-0007', noFaults()));

      logger.write('');
      logger.write('  --- 6b. gửi lại cùng sagaId: saga log chặn ở cửa ---');
      const b = await saga.run(ctxOf('SAGA-0007', noFaults()));

      logger.write('');
      logger.write('  --- 6c. ép chạy lại từng bước (force): guard ở service chặn ---');
      const c = await saga.run(ctxOf('SAGA-0007', noFaults()), { force: true });

      logger.write('');
      logger.write(
        '  ' +
          logger.paint(
            'bold',
            'Ví bị trừ đúng 1 lần, tồn kho giảm đúng 1 lần, chỉ có 1 bút toán CHARGE.'
          )
      );

      return `${a.status} / ${b.status} / ${c.status}`;
    },
  },

  // =========================================================== CHOREOGRAPHY
  {
    id: 'chore-success',
    mode: 'choreography',
    title: '7. CHOREOGRAPHY - happy path, không có orchestrator',
    context: 'Mỗi service nghe event của bước trước và tự phát event của mình.',
    seed: RICH,
    async run() {
      const result = await runOrderChoreography({
        sagaId: 'SAGA-0008',
        request: REQUEST,
        faults: noFaults(),
      });
      return result.status;
    },
  },

  {
    id: 'chore-rollback',
    mode: 'choreography',
    title: '8. CHOREOGRAPHY - bù trừ lan ngược bằng event',
    context:
      'Ví không đủ tiền. payment phát PAYMENT_REJECTED, inventory tự nhả hàng, ' +
      'order tự huỷ. Không ai "ra lệnh rollback".',
    seed: BROKE,
    async run() {
      const result = await runOrderChoreography({
        sagaId: 'SAGA-0009',
        request: REQUEST,
        faults: noFaults(),
      });
      return result.status;
    },
  },

  {
    id: 'chore-duplicate',
    mode: 'choreography',
    title: '9. CHOREOGRAPHY - broker giao lại event (at-least-once)',
    context:
      'ORDER_CREATED bị giao 2 lần, kéo theo mọi event sau cũng nhân đôi. ' +
      'Idempotency guard phải hứng hết.',
    seed: RICH,
    async run() {
      const result = await runOrderChoreography({
        sagaId: 'SAGA-0010',
        request: REQUEST,
        faults: noFaults(),
        redeliver: ['ORDER_CREATED'],
      });
      return result.status;
    },
  },
];

module.exports = { scenarios };
