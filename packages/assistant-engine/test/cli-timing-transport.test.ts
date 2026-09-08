import assert from 'node:assert/strict'
import { createSocket } from 'node:dgram'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'vitest'

import {
  addCliPhaseSample, CLI_TIMING_MAX_REPORT_BYTES, CLI_TIMING_MAX_REPORTS, CLI_TIMING_PHASES,
  emptyCliTiming, normalizeCliTiming,
} from '@murphai/runtime-state/cli-timing'
import { timeCliDispatch, timeCliPhase, withCliTiming } from '@murphai/runtime-state/node/cli-timing'
import { createCodexCliTimingReceiver, withCliTimingEnvironmentAdmission } from '../src/assistant-codex/cli-timing.ts'

function endpoint(receiver: ReturnType<typeof createCodexCliTimingReceiver>) {
  const setting = receiver.launchArgs[1]!
  assert.match(setting, /^shell_environment_policy\.set\.MURPH_CLI_TIMING_ENDPOINT="\d+:[a-f0-9]{32}"$/u)
  const value: string = JSON.parse(setting.slice(setting.indexOf('=') + 1))
  const [port, key] = value.split(':')
  return { value, port: Number(port), key }
}
async function send(port: number, message: unknown) {
  const socket = createSocket('udp4')
  try {
    await new Promise<void>((resolve, reject) => {
      socket.send(typeof message === 'string' ? message : JSON.stringify(message), port, '127.0.0.1',
        (error) => error ? reject(error) : resolve())
    })
    // Test-only event-loop drain; production never waits for transport/flush.
    await delay(10)
  } finally { socket.close() }
}
function timing(event: unknown) {
  const envelope = event as { method: string; params: { timing: unknown } }
  assert.equal(envelope.method, 'murph/cliTiming')
  const report = normalizeCliTiming(envelope.params.timing)
  assert.ok(report)
  return report
}
function envelope(key: string, startedUs = Number(process.hrtime.bigint() / 1_000n)) {
  const report = emptyCliTiming()
  const phases: typeof report.commands[number]['phases'] = []
  addCliPhaseSample(phases, 'total', 42)
  report.commands.push({ command: 'goal list', outcome: 'ok', calls: 1, phases })
  return { key, startedUs, endedUs: startedUs, timing: report }
}

test('real sender/receiver report naturally completed scopes without tool-channel output', async () => {
  const receiver = createCodexCliTimingReceiver()
  const transport = endpoint(receiver)
  const prior = process.env.MURPH_CLI_TIMING_ENDPOINT
  try {
    await delay(10)
    const finish = receiver.begin()
    process.env.MURPH_CLI_TIMING_ENDPOINT = transport.value
    const value = await withCliTiming(() => timeCliDispatch('memory show', async () => {}))
    assert.equal(value, undefined)
    await delay(10)
    const report = timing(finish('turn-synthetic'))
    assert.equal(report.reportCount, 1)
    assert.equal(report.commands[0]!.command, 'memory show')
    assert.equal(finish('turn-synthetic'), null)
    assert.equal(JSON.stringify(report).includes(transport.key!), false)
    assert.equal(JSON.stringify(report).includes('startedUs'), false)
  } finally {
    receiver.close()
    if (prior === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT
    else process.env.MURPH_CLI_TIMING_ENDPOINT = prior
  }
})

test('warm windows isolate late roots and cannot be closed by a non-owner', async () => {
  const receiver = createCodexCliTimingReceiver()
  const { port, key } = endpoint(receiver)
  try {
    await delay(10)
    const finishFirst = receiver.begin()
    const rejectedOwner = receiver.begin()
    assert.equal(rejectedOwner('wrong'), null)
    const old = envelope(key!)
    await send(port, old)
    assert.equal(timing(finishFirst('first')).commands[0]!.calls, 1)
    const finishSecond = receiver.begin()
    await send(port, old)
    await send(port, envelope(key!))
    const report = timing(finishSecond('second'))
    assert.equal(report.reportCount, 1)
    assert.equal(report.outOfWindowReports, 1)
    assert.equal(report.commands[0]!.calls, 1)
    receiver.close()
    assert.equal(receiver.begin()('closed'), null)
  } finally { receiver.close() }
})

test('malformed, private, oversized and excessive packets are bounded diagnostics only', async () => {
  const receiver = createCodexCliTimingReceiver()
  const { port, key } = endpoint(receiver)
  try {
    await delay(10)
    const finish = receiver.begin()
    await send(port, { ...envelope('bad-key'), command: 'PRIVATE_SENTINEL' })
    // Both packets fit the supported macOS 9 KiB UDP limit. Use valid JSON
    // and the correct key: rejection must be the byte cap, not a parse error.
    assert.equal(CLI_TIMING_MAX_REPORT_BYTES, 8_192)
    const padded = JSON.stringify({ ...envelope(key!), argv: ['PRIVATE_SENTINEL'], result: 'PRIVATE_SENTINEL' })
    await send(port, padded.padEnd(CLI_TIMING_MAX_REPORT_BYTES + 1, ' '))
    await send(port, '{broken PRIVATE_SENTINEL')
    const malicious = envelope(key!)
    malicious.timing.commands[0]!.command = 'goal list PRIVATE_SENTINEL'
    await send(port, malicious)
    // Exactly the cap is accepted; unowned private extras still do not escape.
    await send(port, padded.padEnd(CLI_TIMING_MAX_REPORT_BYTES, ' '))
    const report = timing(finish('turn-safe'))
    assert.equal(report.reportCount, 1)
    assert.equal(JSON.stringify(report).includes('PRIVATE_SENTINEL'), false)

    const finishBound = receiver.begin()
    // Drain between datagrams so the test asserts the receiver budget, not OS loss.
    for (let i = 0; i <= CLI_TIMING_MAX_REPORTS; i += 1) await send(port, envelope(key!))
    const bounded = timing(finishBound('bounded'))
    assert.equal(bounded.reportCount, CLI_TIMING_MAX_REPORTS)
    assert.equal(bounded.transportTruncated, true)
    assert.equal(bounded.commands.length, 1)
  } finally { receiver.close() }
})

test('unavailable receiver is non-blocking and existing restrictive environment policy stays restrictive', async () => {
  const receiver = createCodexCliTimingReceiver()
  const { value } = endpoint(receiver)
  await delay(10)
  receiver.close()
  const old = process.env.MURPH_CLI_TIMING_ENDPOINT
  try {
    process.env.MURPH_CLI_TIMING_ENDPOINT = value
    assert.equal(await withCliTiming(async () => 'unchanged'), 'unchanged')
    await delay(10)
  } finally {
    if (old === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT
    else process.env.MURPH_CLI_TIMING_ENDPOINT = old
  }
  const policy = { 'shell_environment_policy.inherit': 'none',
    'shell_environment_policy.include_only': ['PATH'],
    'shell_environment_policy.set': { PATH: '/synthetic/bin' }, other: true }
  assert.deepEqual(withCliTimingEnvironmentAdmission(policy), {
    ...policy, 'shell_environment_policy.include_only': ['PATH', 'MURPH_CLI_TIMING_ENDPOINT'],
  })
  assert.deepEqual(policy['shell_environment_policy.include_only'], ['PATH'])
  assert.equal(withCliTimingEnvironmentAdmission(undefined), undefined)
  const empty = { 'shell_environment_policy.include_only': [] }
  assert.equal(withCliTimingEnvironmentAdmission(empty), empty)
})


test('natural sender bounds the datagram and accounts for trimmed command summaries', async () => {
  const receiver = createCodexCliTimingReceiver()
  const { value } = endpoint(receiver)
  const old = process.env.MURPH_CLI_TIMING_ENDPOINT
  const originalClock = process.hrtime.bigint
  let clock = originalClock()
  process.hrtime.bigint = () => clock
  const commands = ['goal list', 'family list', 'memory show', 'age calculate',
    'age evidence', 'age inputs', 'allergy list', 'allergy show', 'audit list',
    'audit show', 'audit tail', 'automation list', 'condition list', 'capture list',
    'food list', 'meal list']
  try {
    await delay(10)
    const finish = receiver.begin()
    process.env.MURPH_CLI_TIMING_ENDPOINT = value
    await withCliTiming(() => timeCliDispatch('batch', async () => {
      for (const command of commands) for (const failed of [false, true]) {
        const call = withCliTiming(() => timeCliDispatch(command, async () => {
          // Wide safe integer samples deterministically exercise the byte budget,
          // independently of machine speed (the real sender/receiver still run).
          for (const phase of CLI_TIMING_PHASES) await timeCliPhase(phase, async () => {
            clock += 1_000_000_000_000n
          })
          if (failed) throw Error('synthetic')
        }))
        if (failed) await assert.rejects(call)
        else await call
      }
    }))
    await delay(10)
    const report = timing(finish('bounded-sender'))
    // The real receiver caps the WHOLE envelope, not just this normalized
    // summary. Receipt proves the natural sender's trimmed packet fits.
    assert.equal(report.reportCount, 1)
    assert.equal(report.batchContainers, 1)
    assert.equal(report.outOfWindowReports, 0)
    assert.equal(report.transportTruncated, false)
    assert.ok(report.commands.length > 0)
    assert.ok(report.droppedCalls > 0)
    assert.equal(report.commands.reduce((sum, c) => sum + c.calls, 0) + report.droppedCalls, 32)
    assert.ok(Buffer.byteLength(JSON.stringify(report)) < CLI_TIMING_MAX_REPORT_BYTES)
  } finally {
    receiver.close()
    process.hrtime.bigint = originalClock
    if (old === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT
    else process.env.MURPH_CLI_TIMING_ENDPOINT = old
  }
})
