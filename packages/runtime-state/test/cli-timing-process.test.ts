import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomInt } from 'node:crypto';
import { createSocket } from 'node:dgram';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { test } from 'vitest';

import { normalizeCliTiming, type CliTiming } from '../src/cli-timing.ts';

const source = new URL('../src/node/cli-timing.ts', import.meta.url).href;
const key = '0123456789abcdef0123456789abcdef';
// JS driver, real TS production module, real process.exit. No mocked exit or
// injected publisher: an outer finally cannot rescue a lost datagram here.
const driver = `
import assert from 'node:assert/strict';
import { Socket } from 'node:dgram';
import { once } from 'node:events';
const [source, mode, transport, port] = process.argv.slice(1);
const bind = Socket.prototype.bind;
let listening;
if (mode === 'bound' || transport === 'bind-failure') {
  Socket.prototype.bind = function (...args) {
    if (mode === 'bound') listening = once(this, 'listening');
    // The parent's live receiver occupies this address: a real EADDRINUSE.
    return Reflect.apply(bind, this, transport === 'bind-failure'
      ? [{ port: Number(port), address: '127.0.0.1', exclusive: true }] : args);
  };
}
if (transport === 'send-failure') {
  Socket.prototype.send = function () { throw new Error('SYNTHETIC_SEND_FAILURE'); };
}
const { withCliTiming, timeCliDispatch, noteCliTimingFailure, noteCliTimingExit } = await import(source);
const reject = async () => {
  noteCliTimingFailure({ code: 'exercise_not_found', message: 'SYNTHETIC_HEALTH_SECRET', stage: 'read' });
  noteCliTimingExit(1, mode !== 'natural-error');
  if (mode === 'natural-error') process.exitCode = 1;
  else process.exit(1);
};
await withCliTiming(async () => {
  if (mode === 'bound') { assert.ok(listening); await listening; }
  if (mode === 'nested') {
    await timeCliDispatch('batch', () => withCliTiming(() => timeCliDispatch('exercise show', reject)));
  } else {
    await timeCliDispatch('exercise show', mode === 'success' ? async () => {} : reject);
  }
});
`;

type Transport = 'healthy' | 'missing' | 'invalid' | 'dead' | 'bind-failure' | 'send-failure';
async function run(mode: string, transport: Transport = 'healthy') {
  const root = await mkdtemp(join(tmpdir(), 'murph-native-exit-'));
  const socket = createSocket('udp4');
  const port = randomInt(49_152, 65_536);
  const messages: string[] = [];
  socket.on('message', (message) => messages.push(message.toString('utf8')));
  let closed = false;
  try {
    const listening = once(socket, 'listening');
    socket.bind(port, '127.0.0.1');
    await listening;
    if (transport === 'dead') {
      const close = once(socket, 'close');
      socket.close();
      await close;
      closed = true;
    }
    const child = spawn(process.execPath, [
      '--no-warnings', '--experimental-strip-types', '--input-type=module', '-e', driver,
      source, mode, transport, String(port),
    ], {
      cwd: root,
      env: { HOME: root, TMPDIR: root,
        ...(transport === 'missing' ? {} : { MURPH_CLI_TIMING_ENDPOINT:
          transport === 'invalid' ? 'SYNTHETIC_NOT_AN_ENDPOINT' : `${port}:${key}` }),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      // A harness deadline, not an exit flush/keepalive in production. A dead
      // receiver must still terminate normally rather than reach this deadline.
      timeout: 5_000,
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const [code, signal] = await once(child, 'close');
    await setImmediate(); // Let the parent dispatch already-queued loopback reads.
    assert.equal(signal, null);
    assert.equal(code, mode === 'success' ? 0 : 1);
    assert.equal(stdout, '');
    assert.equal(stderr, '');
    assert.equal(messages.length, transport === 'healthy' ? 1 : 0);
    assert.ok(!JSON.stringify(messages).includes('SYNTHETIC_HEALTH_SECRET'));
    if (!messages.length) return null;
    const envelope = JSON.parse(messages[0]!);
    assert.equal(envelope.key, key);
    const report = normalizeCliTiming(envelope.timing);
    assert.ok(report);
    return report;
  } finally {
    if (!closed) socket.close();
    await rm(root, { recursive: true, force: true });
  }
}

function assertFailure(report: CliTiming | null) {
  assert.ok(report);
  assert.equal(report.reportCount, 1);
  assert.equal(report.commands.length, 1);
  assert.equal(report.commands[0]!.command, 'exercise show');
  assert.equal(report.commands[0]!.outcome, 'error');
  assert.equal(report.commands[0]!.calls, 1);
  assert.deepEqual(report.commands[0]!.failures, [
    { code: 'exercise_not_found', stage: 'read', count: 1 },
  ]);
}

test('immediate and already-bound forced exits each deliver exactly one finite report', async () => {
  for (const mode of ['forced', 'bound']) {
    for (let repetition = 0; repetition < 5; repetition += 1) assertFailure(await run(mode));
  }
}, 60_000);

test('natural success/error and forced nested exit retain the existing collection semantics', async () => {
  assertFailure(await run('natural-error'));
  const success = await run('success');
  assert.equal(success?.commands[0]!.outcome, 'ok');
  assert.equal(success?.commands[0]!.failures, undefined);
  const nested = await run('nested');
  assertFailure(nested);
  assert.equal(nested!.droppedCalls, 1); // Unfinished parent, not a fabricated sample.
  assert.equal(nested!.batchContainers, 0);
}, 30_000);

test('absent, rejected, dead and failed transports never replace exits, print or keep the child alive', async () => {
  for (const transport of ['missing', 'invalid', 'dead', 'bind-failure', 'send-failure'] as const) {
    await run('forced', transport);
    await run('success', transport);
  }
}, 60_000);
