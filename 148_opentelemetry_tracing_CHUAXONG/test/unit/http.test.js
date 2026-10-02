'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { errorHandler } = require('../../src/shared/http');

const silentLog = { info() {}, warn() {}, error() {} };

test('errorHandler: header đã được gửi thì chuyển lỗi cho Express, không ghi thêm response', () => {
  const calls = [];
  const res = {
    headersSent: true,
    status() {
      calls.push('status');
      return this;
    },
    json() {
      calls.push('json');
    },
  };
  let forwarded;
  const err = new Error('lỗi giữa chừng');
  errorHandler(silentLog)(err, {}, res, (e) => {
    forwarded = e;
  });
  assert.equal(forwarded, err);
  assert.deepEqual(calls, []);
});
