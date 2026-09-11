import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Cli, Errors, z } from 'incur'
import { afterEach, test, vi } from 'vitest'

import { cliTimingCommand, normalizeCliTiming, type CliTiming } from '@murphai/runtime-state/cli-timing'
import { planVaultCliInvocation } from '../src/vault-cli-routing.ts'

const roots: string[] = []
const initialEndpoint = process.env.MURPH_CLI_TIMING_ENDPOINT

afterEach(async () => {
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.doUnmock('../src/vault-cli-command-routing.js')
  vi.doUnmock('@murphai/assistant-engine/codex-lifecycle')
  vi.doUnmock('@murphai/runtime-state/node/cli-timing')
  vi.resetModules()
  if (initialEndpoint === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT
  else process.env.MURPH_CLI_TIMING_ENDPOINT = initialEndpoint
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// A real loopback receiver, not a production callback/flag. The production CLI
// sender is exercised by every captured invocation; engine tests cover its peer.
async function collect<T>(run: () => Promise<T>): Promise<{ result: T; timing: CliTiming; wire: string }> {
  const socket = createSocket('udp4')
  const port = randomInt(49_152, 65_536)
  const previous = process.env.MURPH_CLI_TIMING_ENDPOINT
  const key = '0123456789abcdef0123456789abcdef'
  try {
    const listening = once(socket, 'listening')
    socket.bind(port, '127.0.0.1')
    await listening
    process.env.MURPH_CLI_TIMING_ENDPOINT = `${port}:${key}`
    const message = once(socket, 'message', { signal: AbortSignal.timeout(5_000) })
    const result = await run()
    const [buffer] = await message
    const wire = buffer.toString('utf8')
    const envelope = JSON.parse(wire)
    assert.equal(envelope.key, key)
    const timing = normalizeCliTiming(envelope.timing)
    assert.ok(timing)
    return { result, timing, wire }
  } finally {
    if (previous === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT
    else process.env.MURPH_CLI_TIMING_ENDPOINT = previous
    socket.close()
  }
}

async function invoke(argv: string[], pipe = false, entry?: typeof import('../src/cli-entry.ts').runMurphCliAction) {
  const stdout: string[] = []
  const stderr: string[] = []
  const exits: Array<number | undefined> = []
  let thrown: string | null = null
  const priorCode = process.exitCode
  const write = vi.spyOn(process.stderr, 'write').mockImplementation((chunk) => {
    stderr.push(String(chunk)); return true
  })
  try {
    process.exitCode = undefined
    // Import after resetModules so entry and middleware share the same ALS instance.
    const run = entry ?? (await import('../src/cli-entry.ts')).runMurphCliAction
    await run(argv, { argv0: 'vault-cli', exit: (code) => { exits.push(code) }, stdout: (s) => {
      if (pipe) throw Object.assign(new Error('broken pipe'), { code: 'EPIPE' })
      stdout.push(s)
    } })
  } catch (error) {
    thrown = error instanceof Error ? `${error.name}:${error.message}` : String(error)
  } finally { write.mockRestore() }
  const exitCode = process.exitCode
  process.exitCode = priorCode
  return { stdout: stdout.join(''), stderr: stderr.join(''), exits, exitCode, thrown }
}
async function vault() {
  delete process.env.MURPH_CLI_TIMING_ENDPOINT
  const root = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-timing-PRIVATE_SENTINEL-'))
  roots.push(root)
  const target = path.join(root, 'vault')
  const initialized = await invoke(['init', '--vault', target, '--format', 'json'])
  assert.equal(initialized.thrown, null)
  return target
}

test('closed diagnostic command vocabulary follows the real source-owned catalog', async () => {
  const catalog = await readFile(new URL('../src/incur.generated.ts', import.meta.url), 'utf8')
  const names = [...catalog.matchAll(/^\s{6}'([^']+)':/gmu)].map((match) => match[1]!)
  assert.ok(names.length > 300)
  for (const name of names) assert.equal(cliTimingCommand(name), name)
  assert.equal(cliTimingCommand('goal list --vault /PRIVATE_SENTINEL'), 'other')
})

test('real scoped and full routes automatically report lifecycle phases with byte-identical output', async () => {
  const root = await vault()
  for (const [command, kind] of [['goal', 'scoped'], ['family', 'full']] as const) {
    const argv = [command, 'list', '--vault', root, '--format', 'json']
    assert.equal(planVaultCliInvocation(argv, { programName: 'vault-cli' }).plan.kind, kind)
    const baseline = await invoke(argv)
    const { result, timing } = await collect(() => invoke(argv))
    assert.deepEqual(result, baseline)
    assert.equal(result.thrown, null)
    assert.equal(timing.commands.length, 1)
    assert.equal(timing.commands[0]!.command, `${command} list`)
    assert.equal(timing.commands[0]!.outcome, 'ok')
    const phases = timing.commands[0]!.phases.map((p) => p.phase)
    for (const phase of ['setup', 'dispatch', 'post-dispatch', 'total']) assert.ok(phases.includes(phase as typeof phases[number]))
    assert.equal(JSON.stringify(timing).includes('PRIVATE_SENTINEL'), false)
  }
})

test('entry lazily loads one shared timing owner before real middleware and teardown', async () => {
  vi.resetModules()
  let timingLoads = 0
  vi.doMock('@murphai/runtime-state/node/cli-timing', async (importOriginal) => {
    timingLoads += 1
    return importOriginal<typeof import('@murphai/runtime-state/node/cli-timing')>()
  })
  let clock = 0n
  vi.spyOn(process.hrtime, 'bigint').mockImplementation(() => clock)
  vi.doMock('../src/vault-cli-command-routing.js', () => ({
    registerScopedVaultCliCommand: async ({ cli, root }: { cli: Cli.Cli; root: string }) => {
      clock += 300_000_000n
      cli.command(Cli.create(root).command('list', { run: async () => {
        clock += 2_000_000_000n
        return { value: 'unchanged PRIVATE_SENTINEL' }
      } }))
    },
  }))
  vi.doMock('@murphai/assistant-engine/codex-lifecycle', () => ({
    stopWarmCodexAppServer: async () => { clock += 25_000_000n },
  }))
  const { runMurphCliEntrypoint } = await import('../src/cli-entry.ts')
  assert.equal(timingLoads, 0, 'Importing entry helpers must not evaluate the timing wire/catalog.')
  const { result, timing } = await collect(() => invoke(
    ['goal', 'list', '--vault', '/tmp/PRIVATE_SENTINEL', '--format', 'json'], false, runMurphCliEntrypoint))
  assert.equal(result.thrown, null)
  assert.match(result.stdout, /unchanged PRIVATE_SENTINEL/u)
  const phases = Object.fromEntries(timing.commands[0]!.phases.map((p) => [p.phase, p.sumUs]))
  assert.equal(phases.setup, 300_000)
  assert.equal(phases.dispatch, 2_000_000)
  assert.equal(phases.teardown, 25_000)
  assert.equal(phases.total, 2_325_000)
  assert.equal(timingLoads, 1, 'Entry, serve options and middleware must share the native module instance.')
  assert.equal(JSON.stringify(timing).includes('PRIVATE_SENTINEL'), false)
})

test('direct actions lazily load timing and keep repeated invocations isolated', async () => {
  vi.resetModules()
  let timingLoads = 0
  vi.doMock('@murphai/runtime-state/node/cli-timing', async (importOriginal) => {
    timingLoads += 1
    return importOriginal<typeof import('@murphai/runtime-state/node/cli-timing')>()
  })
  const { runMurphCliAction } = await import('../src/cli-entry.ts')
  assert.equal(timingLoads, 0)
  for (let invocation = 0; invocation < 2; invocation += 1) {
    const { result, timing } = await collect(() => invoke(['--version'], false, runMurphCliAction))
    assert.equal(result.thrown, null)
    assert.equal(timingLoads, 1)
    assert.equal(timing.reportCount, 1)
    assert.equal(timing.commands.length, 1)
    assert.equal(timing.commands[0]!.calls, 1)
    assert.equal(timing.commands[0]!.outcome, 'ok')
    assert.equal(timing.commands[0]!.command, 'other')
  }
})

test('batch children are timed exactly once; stop-on-error and compact results stay identical', async () => {
  const root = await vault()
  // Batch's existing result timestamps are wall clock, independent of monotonic telemetry.
  vi.spyOn(Date, 'now').mockReturnValue(1_788_560_000_000)
  for (const compact of [false, true]) {
    const argv = ['batch', '--vault', root, '--format', 'json', '--stop-on-error',
      ...(compact ? ['--compact'] : []), '--command', '["goal","list"]',
      '--command', '["goal","list","--PRIVATE_SENTINEL"]',
      '--command', '["family","list"]']
    const baseline = await invoke(argv)
    const { result, timing } = await collect(() => invoke(argv))
    assert.deepEqual(result, baseline)
    const batch = JSON.parse(result.stdout)
    assert.equal(batch.executed, 2)
    assert.equal(batch.stoppedEarly, true)
    assert.equal(timing.batchContainers, 1)
    assert.equal(timing.commands.reduce((n, c) => n + c.calls, 0), 2)
    assert.equal(timing.commands.some((c) => c.command === 'batch' || c.command === 'family list'), false)
    assert.equal(timing.commands.some((c) => c.outcome === 'error'), true)
    assert.equal(JSON.stringify(timing).includes('PRIVATE_SENTINEL'), false)
  }
})

test('early parse, validation, handler and broken-pipe results/exits remain unchanged', async () => {
  const root = await vault()
  for (const argv of [
    ['--vault'],
    ['goal', 'list', '--PRIVATE_SENTINEL', '--vault', root, '--format', 'json'],
    ['family', 'show', 'PRIVATE_SENTINEL', '--vault', root, '--format', 'json'],
  ]) {
    const baseline = await invoke(argv)
    const { result, timing } = await collect(() => invoke(argv))
    assert.deepEqual(result, baseline)
    assert.equal(timing.commands[0]!.outcome, 'error')
    assert.equal(JSON.stringify(timing).includes('PRIVATE_SENTINEL'), false)
  }
  const argv = ['goal', 'list', '--vault', root, '--format', 'json']
  const baseline = await invoke(argv, true)
  assert.deepEqual((await collect(() => invoke(argv, true))).result, baseline)
  process.env.MURPH_CLI_TIMING_ENDPOINT = 'not-a-transport-PRIVATE_SENTINEL'
  assert.deepEqual(await invoke(argv, true), baseline)
})


// Only the handler is synthetic: entrypoint, shell, Incur middleware/errors,
// rendering, exit handling, invocation ALS and loopback sender remain real.
async function syntheticSession(run: () => Promise<unknown>) {
  const home = await mkdtemp(path.join(os.tmpdir(), 'murph-cli-failure-PRIVATE_SENTINEL-'))
  roots.push(home)
  vi.stubEnv('HOME', home)
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
  vi.doMock('../src/vault-cli-command-routing.js', async (importOriginal) => {
    const original = await importOriginal<typeof import('../src/vault-cli-command-routing.js')>()
    return {
      ...original,
      registerScopedVaultCliCommand: async (input: Parameters<typeof original.registerScopedVaultCliCommand>[0]) => {
        if (input.root !== 'experiment') return original.registerScopedVaultCliCommand(input)
        input.cli.command(Cli.create('experiment').command(Cli.create('session').command('log', {
          options: z.object({ quantity: z.number().optional() }), run,
        })))
      },
    }
  })
  vi.doMock('@murphai/assistant-engine/codex-lifecycle', () => ({ stopWarmCodexAppServer: async () => {} }))
  // Incur error envelopes and batch results contain wall durations. Freeze those,
  // not the production monotonic timing clock, for byte-for-byte parity.
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.spyOn(Date, 'now').mockReturnValue(1_788_560_000_000)
}
const sessionArgv = ['experiment', 'session', 'log', '--vault', '/tmp/PRIVATE_SENTINEL', '--format', 'json']

test('real entry and loopback retain original session code/stage once before Incur projection', async () => {
  const original = Object.assign(new Error('PRIVATE_SENTINEL'), {
    code: 'invalid_payload', name: 'PRIVATE_SENTINEL',
    context: { stage: 'validation', field: 'PRIVATE_SENTINEL', extra: 'PRIVATE_SENTINEL' },
    cause: Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'PRIVATE_SENTINEL' }),
    extra: 'PRIVATE_SENTINEL',
  })
  let failing = true
  await syntheticSession(async () => {
    if (failing) throw original
    return { unchanged: 'PRIVATE_SENTINEL' }
  })
  const { runMurphCliEntrypoint } = await import('../src/cli-entry.ts')
  delete process.env.MURPH_CLI_TIMING_ENDPOINT
  const baseline = await invoke(sessionArgv, false, runMurphCliEntrypoint)
  const failed = await collect(() => invoke(sessionArgv, false, runMurphCliEntrypoint))
  assert.deepEqual(failed.result, baseline)
  assert.deepEqual(failed.result.exits, [1])
  assert.equal(failed.timing.commands.length, 1)
  assert.equal(failed.timing.commands[0]!.command, 'experiment session log')
  assert.equal(failed.timing.commands[0]!.outcome, 'error')
  assert.equal(failed.timing.commands[0]!.calls, 1)
  assert.deepEqual(failed.timing.commands[0]!.failures, [{ code: 'invalid_payload', stage: 'validation', count: 1 }])
  assert.equal(failed.wire.includes('PRIVATE_SENTINEL'), false)
  failing = false
  const successBaseline = await invoke(sessionArgv, false, runMurphCliEntrypoint)
  const succeeded = await collect(() => invoke(sessionArgv, false, runMurphCliEntrypoint))
  assert.deepEqual(succeeded.result, successBaseline)
  assert.equal(succeeded.timing.commands[0]!.outcome, 'ok')
  assert.equal(succeeded.timing.commands[0]!.failures, undefined)
  assert.equal(succeeded.wire.includes('PRIVATE_SENTINEL'), false)
  const quietBaseline = await invoke(['--version'], false, runMurphCliEntrypoint)
  const quiet = await collect(() => invoke(['--version'], false, runMurphCliEntrypoint))
  assert.deepEqual(quiet.result, quietBaseline)
  assert.equal(quiet.timing.commands[0]!.failures, undefined)
})

test('real Incur error types and command parsing retain finite detail without reading private fields', async () => {
  let failure: unknown
  let handlers = 0
  await syntheticSession(async () => { handlers += 1; throw failure })
  const fixtures = [
    { error: Object.assign(new Errors.IncurError({ code: 'conflict', message: 'PRIVATE_SENTINEL', exitCode: 7 }), { stage: 'persistence' }),
      expected: { code: 'conflict', stage: 'persistence', count: 1 }, exit: 7 },
    { error: new Errors.ValidationError({ message: 'PRIVATE_SENTINEL', fieldErrors: [{
      path: 'PRIVATE_SENTINEL', expected: 'PRIVATE_SENTINEL', received: 'PRIVATE_SENTINEL', message: 'PRIVATE_SENTINEL',
    }] }), expected: { code: 'VALIDATION_ERROR', stage: 'validation', count: 1 }, exit: 1 },
    { error: new Errors.ParseError({ message: 'PRIVATE_SENTINEL' }),
      expected: { code: 'VALIDATION_ERROR', stage: 'validation', count: 1 }, exit: 1 },
    { error: Object.assign(new Errors.IncurError({ code: 'PRIVATE_SENTINEL', message: 'PRIVATE_SENTINEL',
      cause: Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'invalid_payload', stage: 'validation' }) }),
      { name: 'PRIVATE_SENTINEL', stage: 'PRIVATE_SENTINEL', context: { stage: 'PRIVATE_SENTINEL' }, extra: 'PRIVATE_SENTINEL' }),
      expected: { code: 'unknown', stage: 'unknown', count: 1 }, exit: 1 },
  ]
  delete process.env.MURPH_CLI_TIMING_ENDPOINT
  for (const fixture of fixtures) {
    failure = fixture.error
    const baseline = await invoke(sessionArgv)
    const captured = await collect(() => invoke(sessionArgv))
    assert.deepEqual(captured.result, baseline)
    assert.deepEqual(captured.result.exits, [fixture.exit])
    assert.deepEqual(captured.timing.commands[0]!.failures, [fixture.expected])
    assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
  }
  for (const [extra, expected, command] of [
    [['--quantity', 'PRIVATE_SENTINEL'], { code: 'VALIDATION_ERROR', stage: 'validation', count: 1 }, 'experiment session log'],
    [['--PRIVATE_SENTINEL'], { code: 'VALIDATION_ERROR', stage: 'validation', count: 1 }, 'experiment session log'],
    // Built-in parsing fails before the middleware sees an original error or path.
    [['--token-limit', 'PRIVATE_SENTINEL'], { code: 'unknown', stage: 'unknown', count: 1 }, 'other'],
  ] as const) {
    const before = handlers
    const argv = [...sessionArgv, ...extra]
    const baseline = await invoke(argv)
    const captured = await collect(() => invoke(argv))
    assert.deepEqual(captured.result, baseline)
    assert.deepEqual(captured.timing.commands[0]!.failures, [expected])
    assert.equal(captured.timing.commands[0]!.command, command)
    assert.equal(handlers, before, 'Real Incur parsing, not the handler, must fail.')
    assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
  }
})

test('real batch exit rewrites do not multiply failures; mixed stages, stop and nested rejection keep parity', async () => {
  let index = 0
  const failures = [
    Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'invalid_payload', context: { stage: 'validation' } }),
    Object.assign(new Errors.IncurError({ code: 'conflict', message: 'PRIVATE_SENTINEL' }), { stage: 'persistence' }),
    Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'invalid_payload', context: { stage: 'validation' } }),
    Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'invalid_payload', context: { stage: 'write' } }),
  ]
  await syntheticSession(async () => {
    const error = failures[index++]
    if (error) throw error
    return { ok: true }
  })
  const argv = ['batch', '--vault', '/tmp/PRIVATE_SENTINEL', '--format', 'json',
    ...Array.from({ length: 5 }, () => ['--command', '["experiment","session","log"]']).flat()]
  delete process.env.MURPH_CLI_TIMING_ENDPOINT
  const baseline = await invoke(argv)
  index = 0
  const captured = await collect(() => invoke(argv))
  assert.deepEqual(captured.result, baseline)
  assert.equal(captured.timing.batchContainers, 1)
  assert.equal(captured.timing.commands.reduce((n, entry) => n + entry.calls, 0), 5)
  const failed = captured.timing.commands.find((entry) => entry.outcome === 'error')!
  assert.equal(failed.calls, 4)
  assert.deepEqual(failed.failures, [
    { code: 'invalid_payload', stage: 'validation', count: 2 },
    { code: 'conflict', stage: 'persistence', count: 1 },
    { code: 'invalid_payload', stage: 'write', count: 1 },
  ])
  assert.equal(captured.timing.commands.find((entry) => entry.outcome === 'ok')!.failures, undefined)
  assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
  index = 0
  const stoppedBaseline = await invoke([...argv, '--stop-on-error'])
  index = 0
  const stopped = await collect(() => invoke([...argv, '--stop-on-error']))
  assert.deepEqual(stopped.result, stoppedBaseline)
  assert.equal(JSON.parse(stopped.result.stdout).executed, 1)
  assert.equal(stopped.timing.commands[0]!.calls, 1)
  assert.deepEqual(stopped.timing.commands[0]!.failures, [{ code: 'invalid_payload', stage: 'validation', count: 1 }])
  const nestedArgv = ['batch', '--vault', '/tmp/PRIVATE_SENTINEL', '--format', 'json', '--stop-on-error',
    '--command', '["batch","--command","[\\"experiment\\",\\"session\\",\\"log\\"]"]']
  const nestedBaseline = await invoke(nestedArgv)
  const nested = await collect(() => invoke(nestedArgv))
  assert.deepEqual(nested.result, nestedBaseline)
  assert.equal(JSON.parse(nested.result.stdout).failed, 1)
  assert.equal(nested.timing.batchContainers, 1)
  assert.deepEqual(nested.timing.commands, [], 'Unsupported nested batch is rejected before opening a child invocation.')
})
