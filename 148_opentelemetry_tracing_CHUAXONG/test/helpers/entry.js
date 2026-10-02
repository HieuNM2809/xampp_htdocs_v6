'use strict';

const http = require('node:http');
const path = require('node:path');
const { once } = require('node:events');
const { spawn } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');

/**
 * Chiếm sẵn một cổng, rồi chạy file entry của service với PORT = cổng đó.
 * Trả về { code, output } khi tiến trình thoát. Quá `timeoutMs` mà chưa thoát thì tiến trình
 * bị kill và `code` là null.
 */
async function runEntryOnBusyPort(script, extraEnv = {}, timeoutMs = 8000) {
  const blocker = http.createServer();
  blocker.listen(0);
  await once(blocker, 'listening');
  const child = spawn(process.execPath, [script], {
    cwd: ROOT,
    env: { ...process.env, PORT: String(blocker.address().port), ...extraEnv },
  });
  let output = '';
  child.stdout.on('data', (chunk) => (output += chunk));
  child.stderr.on('data', (chunk) => (output += chunk));
  const timer = setTimeout(() => child.kill(), timeoutMs);
  const [code] = await once(child, 'exit');
  clearTimeout(timer);
  blocker.close();
  return { code, output };
}

module.exports = { runEntryOnBusyPort };
