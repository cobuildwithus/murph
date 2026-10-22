import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { randomInt } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Cli, Errors, z } from 'incur'
import { afterEach, test, vi } from 'vitest'

import { CLI_TIMING_MAX_REPORT_BYTES, cliTimingCommand, cliTimingValidationFailure, normalizeCliTiming, type CliTiming } from '@murphai/runtime-state/cli-timing'
import { planVaultCliInvocation } from '../src/vault-cli-routing.ts'

const roots: string[] = []
const initialEndpoint = process.env.MURPH_CLI_TIMING_ENDPOINT

afterEach(async () => {
  vi.useRealTimers()
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
    { error: new Errors.ParseError({ message: 'PRIVATE_SENTINEL', kind: 'config_missing' }),
      expected: { code: 'VALIDATION_ERROR', stage: 'validation', count: 1 }, exit: 1 },
    { error: new Errors.ParseError({ message: 'PRIVATE_SENTINEL', kind: 'config_invalid' }),
      expected: { code: 'VALIDATION_ERROR', stage: 'validation', count: 1 }, exit: 1 },
    { error: new Errors.ParseError({ message: 'PRIVATE_SENTINEL', kind: 'config_unavailable' }),
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


test('real research scout-batch rejects before egress and preserves output/exit with loopback diagnostics on or off', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'research-timing-PRIVATE_PATH-'))
  roots.push(directory)
  vi.stubEnv('HOME', directory)
  // Freeze only output-envelope wall durations, not the monotonic timing owner.
  vi.spyOn(performance, 'now').mockReturnValue(0)
  const fetchImpl = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('PRIVATE_UNEXPECTED_PROVIDER_REQUEST')
  })
  const file = path.join(directory, 'PRIVATE_ARGUMENT.json')
  const valid = JSON.stringify({ lanes: [{ label: 'sleep', profile: { topics: ['sleep'] } }] })
  const argv = ['research', 'scout-batch', '--vault', directory, '--input', `@${file}`,
    '--since', '2026-04-18', '--until', '2026-06-17', '--format', 'json']
  delete process.env.MURPH_CLI_TIMING_ENDPOINT
  const fixtures = [
    { payload: '{"PRIVATE_PAYLOAD":', code: 'invalid_payload' },
    { payload: '{}', code: 'research_scout_invalid_batch_payload', rejection: 'envelope' },
    { payload: '{"lanes":[],"PRIVATE_PAYLOAD":"PRIVATE_VALUE"}', code: 'research_scout_invalid_batch_payload',
      rejection: 'lane_count' },
    { payload: `${valid.slice(0, -1)},"since":"PRIVATE_VALUE"}`, code: 'research_scout_invalid_batch_payload',
      rejection: 'unexpected_root_field' },
    { payload: valid.replace('"sleep"', '"PRIVATE Label"'), code: 'research_scout_invalid_batch_payload',
      rejection: 'lane_label' },
    { payload: valid.replace('"topics"', '"mode":"focused","topics"'), code: 'research_scout_invalid_batch_payload',
      rejection: 'unexpected_lane_field' },
    { payload: valid.replace('["sleep"]', '"sleep"'), code: 'research_scout_invalid_batch_payload',
      rejection: 'profile_shape' },
    { payload: valid.replace('["sleep"]', '["PRIVATE_CONCEPT"]'), code: 'research_scout_invalid_batch_payload',
      rejection: 'public_concept' },
    { payload: valid, code: 'research_scout_invalid_window', since: '2026-06-18' },
    { payload: valid, code: 'research_exa_token_missing', token: '' },
  ]
  for (const fixture of fixtures) {
    vi.stubEnv('EXA_API_KEY', fixture.token ?? 'PRIVATE_TOKEN')
    await writeFile(file, fixture.payload)
    const args = [...argv]
    if (fixture.since) args[args.indexOf('--since') + 1] = fixture.since
    const baseline = await invoke(args)
    const captured = await collect(() => invoke(args))
    assert.deepEqual(captured.result, baseline)
    assert.equal(captured.result.thrown, null)
    assert.deepEqual(captured.result.exits, [1])
    assert.equal(JSON.parse(captured.result.stdout).code, fixture.code)
    assert.equal(JSON.parse(captured.result.stdout).stage, undefined)
    assert.equal(fetchImpl.mock.calls.length, 0)
    assert.equal(captured.timing.reportCount, 1)
    assert.equal(captured.timing.commands.length, 1)
    assert.equal(captured.timing.commands[0]!.command, 'research scout-batch')
    assert.equal(captured.timing.commands[0]!.outcome, 'error')
    assert.equal(captured.timing.commands[0]!.calls, 1)
    assert.deepEqual(captured.timing.commands[0]!.failures, [{ code: fixture.code, stage: 'unknown', count: 1,
      ...(fixture.rejection ? { rejection: fixture.rejection } : {}) }])
    assert.equal(captured.timing.droppedCalls, 0)
    assert.equal(captured.timing.commands[0]!.droppedFailures, undefined)
    assert.equal(captured.wire.includes('PRIVATE'), false)
    // The category exists only on the timing wire, never in model-visible output.
    for (const text of [captured.result.stdout, captured.result.stderr]) {
      assert.equal(/cliTimingRejection|"rejection"|_field|lane_|public_concept|profile_shape|envelope/u.test(text), false)
    }
    assert.deepEqual(await readdir(directory), [path.basename(file)], 'Rejected input performs no canonical writes.')
  }
  // Nearby valid input uses the real client; only the external provider is fake.
  vi.stubEnv('EXA_API_KEY', 'PRIVATE_TOKEN')
  await writeFile(file, valid)
  const payload = { results: [{ title: 'Synthetic paper', url: 'https://example.test/paper' }],
    output: { content: { candidates: [{ resultIndex: 0 }] } }, extraProviderField: 'PRIVATE_PROVIDER_PAYLOAD' }
  fetchImpl.mockImplementation(async () => new Response(JSON.stringify(payload)))
  const baseline = await invoke(argv)
  const succeeded = await collect(() => invoke(argv))
  assert.deepEqual(succeeded.result, baseline)
  assert.equal(succeeded.result.thrown, null)
  assert.deepEqual(succeeded.result.exits, [])
  assert.deepEqual(JSON.parse(succeeded.result.stdout).lanes, [{ label: 'sleep', response: payload }])
  assert.equal(fetchImpl.mock.calls.length, 2, 'Exactly one fake request per successful invocation.')
  assert.equal(succeeded.timing.commands[0]!.outcome, 'ok')
  assert.equal(succeeded.timing.commands[0]!.calls, 1)
  assert.equal(succeeded.timing.commands[0]!.failures, undefined)
  assert.equal(succeeded.wire.includes('PRIVATE_'), false)
})

test('real event and knowledge validation preserve output, effects and finite loopback evidence', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cli-validation-PRIVATE_SENTINEL-'))
  roots.push(home)
  vi.stubEnv('HOME', home)
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
  const fetchImpl = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('PRIVATE_SENTINEL unexpected provider request')
  })
  const root = await vault()
  // Observe real registered handlers without substituting their implementation.
  const knowledge = await import('@murphai/assistant-engine/knowledge')
  const upsert = vi.spyOn(knowledge, 'upsertKnowledgePage')
  const show = vi.spyOn(knowledge, 'getKnowledgePage')
  const services = await import('@murphai/vault-usecases/vault-services')
  const createServices = services.createIntegratedVaultServices
  const eventCalls: Array<() => number> = []
  vi.spyOn(services, 'createIntegratedVaultServices').mockImplementation((...args) => {
    const value = createServices(...args)
    const list = vi.spyOn(value.query, 'listEvents')
    eventCalls.push(() => list.mock.calls.length)
    return value
  })
  // Freeze output dates/durations only; timing still uses the real monotonic clock.
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2030-01-15T10:00:00.000Z'))
  try {
    // Optional parser reason is admitted only for knowledge upsert/show (and
    // wearables day below), never event list; trailing tokens follow the
    // shared flags so a final option really lacks its value.
    const rows: Array<[string[], string, string, boolean, string?, string[]?]> = [
      [['event', 'list', '--limit', '201'], 'limit', 'too_big', false],
      [['event', 'list', '--PRIVATE_SENTINEL'], 'arguments', 'custom', false],
      [['knowledge', 'show', '--slug', 'synthetic-page'], 'arguments', 'custom', false, 'unknown_flag'],
      [['knowledge', 'show', 'synthetic-page'], 'arguments', 'custom', false, 'missing_value', ['--request-id']],
      [['knowledge', 'show'], 'slug', 'invalid_type', true],
      [['knowledge', 'show', 'PRIVATE_SENTINEL!'], 'slug', 'invalid_format', false],
      [['knowledge', 'upsert', '--body', '# PRIVATE_SENTINEL', '--PRIVATE_SENTINEL'], 'arguments', 'custom', false, 'unknown_flag'],
      [['knowledge', 'upsert', '--body', '# PRIVATE_SENTINEL'], 'arguments', 'custom', false, 'missing_value', ['--slug']],
      [['knowledge', 'upsert'], 'body', 'invalid_type', true],
      [['knowledge', 'upsert', '--body', ''], 'body', 'too_small', false],
      [['knowledge', 'upsert', '--body', '# PRIVATE_SENTINEL', '--related-slug', 'PRIVATE_SENTINEL!'], 'relatedSlug', 'invalid_format', false],
    ]
    const outputs = new Map<string, string>()
    for (const [args, field, code, missing, rejection, trailing = []] of rows) {
      const argv = [...args, '--vault', root, '--format', 'json', ...trailing]
      const baseline = await invoke(argv)
      const captured = await collect(() => invoke(argv))
      assert.deepEqual(captured.result, baseline)
      assert.equal(captured.result.thrown, null)
      assert.deepEqual(captured.result.exits, [1])
      const output = JSON.parse(captured.result.stdout)
      assert.equal(output.code, 'VALIDATION_ERROR')
      assert.equal(output.stage, 'validation')
      assert.ok(output.fieldErrors.some((issue: { path: string; code: string; missing?: boolean }) =>
        issue.path === field && issue.code === code && issue.missing === missing))
      assert.equal(captured.timing.reportCount, 1)
      assert.equal(captured.timing.commands.length, 1)
      const command = captured.timing.commands[0]!
      assert.equal(command.command, args.slice(0, 2).join(' '))
      assert.equal(command.outcome, 'error')
      assert.equal(command.calls, 1)
      const validation = { field, code, missing }
      assert.deepEqual(cliTimingValidationFailure(command.command, output.code, output, 'fieldErrors'), { validation })
      assert.deepEqual(command.failures, [{ code: 'VALIDATION_ERROR', stage: 'validation', count: 1, validation,
        ...(rejection ? { rejection } : {}) }])
      assert.equal(/unknown_flag|missing_value|cliTimingRejection/u.test(captured.result.stdout + captured.result.stderr), false)
      if (rejection) outputs.set(`${command.command}:${rejection}`, captured.result.stdout)
      assert.equal(command.droppedFailures, undefined)
      assert.equal(captured.timing.droppedCalls, 0)
      assert.equal(captured.timing.droppedSpans, 0)
      assert.ok(Buffer.byteLength(captured.wire) <= CLI_TIMING_MAX_REPORT_BYTES)
      assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
    }
    // Distinct telemetry reasons; the model-visible fixed envelope stays identical.
    assert.equal(outputs.size, 4)
    for (const name of ['knowledge upsert', 'knowledge show']) {
      assert.equal(outputs.get(`${name}:unknown_flag`), outputs.get(`${name}:missing_value`))
    }
    assert.equal(upsert.mock.calls.length, 0)
    assert.equal(show.mock.calls.length, 0, 'Parser/schema rejection precedes the registered read handler.')
    assert.equal(eventCalls.reduce((sum, count) => sum + count(), 0), 0)
    assert.equal((await knowledge.listKnowledgePages({ vault: root })).pageCount, 0)
    const absentArgv = ['knowledge', 'show', 'synthetic-page', '--vault', root, '--format', 'json']
    const absentBaseline = await invoke(absentArgv)
    const absent = await collect(() => invoke(absentArgv))
    assert.deepEqual(absent.result, absentBaseline)
    assert.deepEqual(absent.result.exits, [1])
    assert.equal(JSON.parse(absent.result.stdout).code, 'knowledge_page_not_found')
    assert.equal(absent.timing.commands[0]!.calls, 1)
    assert.deepEqual(absent.timing.commands[0]!.failures, [{ code: 'knowledge_page_not_found', stage: 'read', count: 1 }])
    assert.equal(absent.wire.includes('PRIVATE_SENTINEL'), false)
    assert.equal(show.mock.calls.length, 2)
    assert.equal(upsert.mock.calls.length, 0)
    for (const args of [
      ['event', 'list', '--limit', '1'],
      ['knowledge', 'upsert', '--body', '# Synthetic page\n\nPRIVATE_SENTINEL\n', '--slug', 'synthetic-page'],
      ['knowledge', 'show', 'synthetic-page'],
    ]) {
      const argv = [...args, '--vault', root, '--format', 'json']
      const baseline = await invoke(argv)
      const captured = await collect(() => invoke(argv))
      assert.deepEqual(captured.result, baseline)
      assert.equal(captured.result.thrown, null)
      assert.deepEqual(captured.result.exits, [])
      assert.equal(captured.timing.reportCount, 1)
      assert.equal(captured.timing.commands.length, 1)
      assert.equal(captured.timing.commands[0]!.command, args.slice(0, 2).join(' '))
      assert.equal(captured.timing.commands[0]!.outcome, 'ok')
      assert.equal(captured.timing.commands[0]!.calls, 1)
      assert.equal(captured.timing.commands[0]!.failures, undefined)
      if (args[0] === 'knowledge' && args[1] === 'show') {
        assert.equal(JSON.parse(captured.result.stdout).page.slug, 'synthetic-page')
        assert.match(JSON.parse(captured.result.stdout).page.body, /PRIVATE_SENTINEL/u)
      }
      assert.ok(Buffer.byteLength(captured.wire) <= CLI_TIMING_MAX_REPORT_BYTES)
      assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
    }
    assert.equal(upsert.mock.calls.length, 2, 'One real upsert per successful invocation, no retries.')
    assert.equal(show.mock.calls.length, 4, 'One real read per positional invocation, no retries.')
    assert.equal(eventCalls.reduce((sum, count) => sum + count(), 0), 2)
    assert.equal((await knowledge.listKnowledgePages({ vault: root })).pageCount, 1)
    assert.match(await readFile(path.join(root, 'derived/knowledge/pages/synthetic-page.md'), 'utf8'), /PRIVATE_SENTINEL/u)
    assert.equal(fetchImpl.mock.calls.length, 0)
  } finally { vi.useRealTimers() }
})

async function vaultFiles(root: string, canonicalOnly = false): Promise<Array<[string, string]>> {
  const files: Array<[string, string]> = []
  for (const entry of await readdir(root, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const relative = path.relative(root, path.join(entry.parentPath, entry.name))
    // Valid reads may refresh rebuildable projections; canonical sources must not change.
    if (canonicalOnly && /^(?:derived|\.runtime)(?:\/|$)/u.test(relative)) continue
    files.push([relative, (await readFile(path.join(root, relative))).toString('base64')])
  }
  return files.sort(([left], [right]) => left.localeCompare(right))
}

test('real wearables day and search query rejections keep output, exits and zero effects while separating causes', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'cli-filter-PRIVATE_SENTINEL-'))
  roots.push(home)
  vi.stubEnv('HOME', home)
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
  const fetchImpl = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('PRIVATE_SENTINEL unexpected provider request')
  })
  const root = await vault()
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2030-01-15T10:00:00.000Z'))
  const hidden = /cliTimingRejection|comma_delimited|unsupported_value|unknown_flag|missing_value/u
  try {
    type Row = { args: string[]; trailing?: string[]; code: string; stage: string;
      validation?: { field: string; code: string; missing: boolean }; rejection?: string }
    const day = (args: string[], field: string, code: string, missing: boolean, rejection?: string, trailing?: string[]): Row =>
      ({ args: ['wearables', 'day', ...args], trailing, code: 'VALIDATION_ERROR', stage: 'validation',
        validation: { field, code, missing }, ...(rejection ? { rejection } : {}) })
    const filter = (args: string[], rejection?: string): Row =>
      ({ args, code: 'invalid_option', stage: 'unknown', ...(rejection ? { rejection } : {}) })
    const rows: Row[] = [
      day(['2030-01-14', '--PRIVATE_SENTINEL'], 'arguments', 'custom', false, 'unknown_flag'),
      day(['2030-01-14'], 'arguments', 'custom', false, 'missing_value', ['--provider']),
      day([], 'date', 'invalid_type', true),
      day(['PRIVATE_SENTINEL'], 'date', 'invalid_format', false),
      filter(['search', 'query', 'synthetic', '--record-type', 'PRIVATE_SENTINEL'], 'unsupported_value'),
      filter(['search', 'query', 'synthetic', '--record-type', 'event,goal'], 'comma_delimited'),
      filter(['search', 'query', 'synthetic', '--kind', 'PRIVATE,SENTINEL'], 'comma_delimited'),
      filter(['search', 'query', 'synthetic', '--stream', 'PRIVATE,SENTINEL'], 'comma_delimited'),
      filter(['search', 'query', 'synthetic', '--tag', 'PRIVATE,SENTINEL'], 'comma_delimited'),
      // The same shared normalizer on another command: metadata dropped by the owner gate.
      filter(['list', '--record-type', 'PRIVATE_SENTINEL']),
      filter(['list', '--tag', 'PRIVATE,SENTINEL']),
    ]
    const canonical = await vaultFiles(root, true)
    const outputs = new Map<string, string>()
    for (const row of rows) {
      const argv = [...row.args, '--vault', root, '--format', 'json', ...(row.trailing ?? [])]
      // `list` reads the vault before its tag normalizer (unchanged ordering),
      // which may refresh the rebuildable projection; the others touch nothing.
      const before = await vaultFiles(root, row.args[0] === 'list')
      const baseline = await invoke(argv)
      const captured = await collect(() => invoke(argv))
      assert.deepEqual(captured.result, baseline, 'Timing on/off: identical stdout, stderr, exits and throws.')
      assert.equal(captured.result.thrown, null)
      assert.deepEqual(captured.result.exits, [1])
      const output = JSON.parse(captured.result.stdout)
      assert.equal(output.code, row.code)
      if (row.validation) {
        assert.ok(output.fieldErrors.some((issue: { path: string; code: string; missing?: boolean }) =>
          issue.path === row.validation!.field && issue.code === row.validation!.code && issue.missing === row.validation!.missing))
      }
      assert.equal(hidden.test(captured.result.stdout + captured.result.stderr), false)
      const command = captured.timing.commands[0]!
      assert.equal(captured.timing.commands.length, 1)
      assert.equal(command.command, row.args[0] === 'list' ? 'list' : row.args.slice(0, 2).join(' '))
      assert.equal(command.outcome, 'error')
      assert.equal(command.calls, 1)
      assert.deepEqual(command.failures, [{ code: row.code, stage: row.stage, count: 1,
        ...(row.validation ? { validation: row.validation } : {}), ...(row.rejection ? { rejection: row.rejection } : {}) }])
      assert.equal(command.droppedFailures, undefined)
      assert.equal(captured.timing.droppedCalls, 0)
      assert.equal(captured.timing.droppedSpans, 0)
      assert.ok(Buffer.byteLength(captured.wire) <= CLI_TIMING_MAX_REPORT_BYTES)
      assert.equal(captured.wire.includes('PRIVATE'), false)
      if (row.args[0] === 'wearables' && row.rejection) outputs.set(row.rejection, captured.result.stdout)
      assert.deepEqual(await vaultFiles(root, row.args[0] === 'list'), before, 'Rejected input performs no vault writes.')
    }
    // Distinct telemetry reasons; the model-visible fixed envelope stays identical.
    assert.equal(outputs.size, 2)
    assert.equal(outputs.get('unknown_flag'), outputs.get('missing_value'))
    // Reversed dates are a different, already-staged validation: no filter class.
    const reversedArgv = ['search', 'query', 'synthetic', '--from', '2030-01-15', '--to', '2030-01-14', '--vault', root, '--format', 'json']
    const reversedBaseline = await invoke(reversedArgv)
    const reversed = await collect(() => invoke(reversedArgv))
    assert.deepEqual(reversed.result, reversedBaseline)
    assert.deepEqual(reversed.result.exits, [1])
    assert.equal(JSON.parse(reversed.result.stdout).code, 'invalid_option')
    assert.deepEqual(reversed.timing.commands[0]!.failures, [{ code: 'invalid_option', stage: 'validation', count: 1 }])
    assert.deepEqual(await vaultFiles(root, true), canonical)
    // Valid neighbors use the same real handlers and succeed exactly once each.
    for (const args of [
      ['search', 'query', 'synthetic', '--record-type', 'event', '--record-type', 'goal', '--tag', 'synthetic'],
      ['wearables', 'day', '2030-01-14'],
    ]) {
      const argv = [...args, '--vault', root, '--format', 'json']
      const baseline = await invoke(argv)
      const captured = await collect(() => invoke(argv))
      assert.deepEqual(captured.result, baseline)
      assert.equal(captured.result.thrown, null)
      assert.deepEqual(captured.result.exits, [])
      assert.equal(captured.timing.commands[0]!.command, args.slice(0, 2).join(' '))
      assert.equal(captured.timing.commands[0]!.outcome, 'ok')
      assert.equal(captured.timing.commands[0]!.calls, 1)
      assert.equal(captured.timing.commands[0]!.failures, undefined)
      assert.equal(hidden.test(captured.result.stdout + captured.wire), false)
    }
    assert.deepEqual(await vaultFiles(root, true), canonical, 'Valid reads perform no canonical writes.')
    assert.equal(fetchImpl.mock.calls.length, 0)
  } finally { vi.useRealTimers() }
})

test('real meal validation preserves output and mutation boundaries while admitting only finite loopback detail', async () => {
  const home = await mkdtemp(path.join(os.tmpdir(), 'meal-validation-PRIVATE_SENTINEL-'))
  roots.push(home)
  vi.stubEnv('HOME', home)
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
  const fetchImpl = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('PRIVATE_SENTINEL unexpected provider request')
  })
  const root = await vault()
  // Spies retain the real canonical writers, not fake successful handlers.
  const core = await import('@murphai/core')
  const add = vi.spyOn(core, 'addMeal')
  const edit = vi.spyOn(core, 'upsertEvent')
  const records = await import('@murphai/vault-usecases/records')
  const editRecord = vi.spyOn(records, 'editMealRecord')
  const removeRecord = vi.spyOn(records, 'removeAutomaticMealPhotoRecord')
  const removePhoto = vi.spyOn(core, 'removeAutomaticMealPhoto')
  const runtime = await import('@murphai/vault-usecases/runtime')
  const importers = vi.spyOn(runtime, 'loadImportersRuntimeModule')
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2030-01-15T12:00:00.000Z'))
  try {
    for (const action of ['add', 'edit']) {
      const schemaResult = await invoke(['meal', action, '--schema', '--format', 'json'])
      assert.equal(schemaResult.thrown, null)
      assert.deepEqual(schemaResult.exits, [])
      const schema = JSON.parse(schemaResult.stdout)
      for (const field of ['nutritionCalories', 'nutritionSource', 'occurredAt']) {
        assert.equal(Object.hasOwn(schema.options.properties, field), true, `${action}/${field}`)
      }
      if (action === 'edit') {
        assert.deepEqual(schema.args.required, ['id'])
        for (const field of ['id']) assert.equal(Object.hasOwn(schema.args.properties, field), true)
        for (const field of ['nutritionProteinGrams', 'nutritionConfidence']) {
          assert.equal(Object.hasOwn(schema.options.properties, field), true)
        }
      }
      // Edit's real positional lookup is syntactically valid but deliberately absent.
      // Option rejection must precede even the edit lookup, not merely its write.
      const args = ['meal', action, ...(action === 'edit' ? ['meal_synthetic_missing'] : [])]
      for (const [flags, field, code] of [
        [['--nutrition-calories', '-1'], 'nutritionCalories', 'too_small'],
        [['--nutrition-source', 'PRIVATE_SENTINEL'], 'nutritionSource', 'invalid_value'],
        [['--PRIVATE_SENTINEL'], 'arguments', 'custom'],
        ...(action === 'edit' ? [
          [['--nutrition-protein-grams', '-1'], 'nutritionProteinGrams', 'too_small'],
          [['--nutrition-confidence', 'PRIVATE_SENTINEL'], 'nutritionConfidence', 'invalid_value'],
          [[], 'id', 'invalid_type'],
        ] as const : []),
      ] as const) {
        const argv = [...(field === 'id' ? ['meal', 'edit'] : args), ...flags,
          '--note', 'PRIVATE_SENTINEL', '--vault', root, '--format', 'json']
        const baseline = await invoke(argv)
        const captured = await collect(() => invoke(argv))
        assert.deepEqual(captured.result, baseline)
        assert.equal(captured.result.thrown, null)
        assert.deepEqual(captured.result.exits, [1])
        const output = JSON.parse(captured.result.stdout)
        assert.equal(output.code, 'VALIDATION_ERROR')
        assert.equal(output.stage, 'validation')
        assert.equal(output.retryable, false)
        const validation = { field, code, missing: field === 'id' }
        assert.ok(output.fieldErrors.some((issue: { path: string; code: string; missing?: boolean }) =>
          issue.path === field && issue.code === code && issue.missing === validation.missing))
        assert.deepEqual(cliTimingValidationFailure(`meal ${action}`, output.code, output, 'fieldErrors'), { validation })
        assert.equal(captured.timing.reportCount, 1)
        assert.equal(captured.timing.commands.length, 1)
        const command = captured.timing.commands[0]!
        assert.equal(command.command, `meal ${action}`)
        assert.equal(command.outcome, 'error')
        assert.equal(command.calls, 1)
        const failure = { code: 'VALIDATION_ERROR', stage: 'validation', count: 1 }
        assert.deepEqual(command.failures, [{ ...failure, validation }])
        assert.equal(command.droppedFailures, undefined)
        assert.equal(captured.timing.droppedCalls, 0)
        assert.equal(captured.timing.droppedSpans, 0)
        assert.equal(captured.timing.transportTruncated, false)
        assert.ok(Buffer.byteLength(captured.wire) <= CLI_TIMING_MAX_REPORT_BYTES)
        assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
      }
    }
    for (const [args, field, code, missing] of [
      [['meal', 'edit'], 'id', 'invalid_type', true],
      [['meal', 'edit', 'meal_synthetic_missing', '--nutrition-protein-grams', '-1'], 'nutritionProteinGrams', 'too_small', false],
      [['meal', 'edit', 'meal_synthetic_missing', '--nutrition-confidence', 'PRIVATE_SENTINEL'], 'nutritionConfidence', 'invalid_value', false],
    ] as const) for (const compact of [false, true]) {
      const argv = ['batch', '--vault', root, '--format', 'json', '--stop-on-error',
        ...(compact ? ['--compact'] : []), '--command', JSON.stringify(args), '--command', '["meal","list"]']
      const baseline = await invoke(argv)
      const captured = await collect(() => invoke(argv))
      assert.deepEqual(captured.result, baseline)
      assert.equal(captured.result.thrown, null)
      assert.deepEqual(captured.result.exits, [], 'The batch container returns child failures, not an extra exit.')
      const output = JSON.parse(captured.result.stdout)
      assert.equal(output.executed, 1)
      assert.equal(output.failed, 1)
      assert.equal(output.stoppedEarly, true)
      assert.equal(output.commands[0].error.code, 'VALIDATION_ERROR')
      assert.equal(captured.timing.batchContainers, 1)
      assert.equal(captured.timing.commands.length, 1)
      assert.equal(captured.timing.commands[0]!.command, 'meal edit')
      assert.equal(captured.timing.commands[0]!.calls, 1)
      assert.deepEqual(captured.timing.commands[0]!.failures, [{ code: 'VALIDATION_ERROR', stage: 'validation', count: 1,
        validation: { field, code, missing } }])
      assert.equal(captured.timing.droppedCalls, 0)
      assert.equal(captured.timing.droppedSpans, 0)
      assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
    }
    assert.equal(importers.mock.calls.length, 0)
    assert.equal(editRecord.mock.calls.length, 0)
    assert.equal(add.mock.calls.length, 0)
    assert.equal(edit.mock.calls.length, 0)
    assert.equal(removeRecord.mock.calls.length, 0)
    assert.equal(removePhoto.mock.calls.length, 0)
    assert.equal((await records.listMealRecords({ vault: root })).count, 0)

    // Follow the unchanged validation recovery with one real save of each kind.
    const saved = await collect(() => invoke(['meal', 'add', '--note', 'PRIVATE_SENTINEL',
      '--nutrition-calories', '420', '--nutrition-source', 'estimated',
      '--occurred-at', '2030-01-15T10:00:00.000Z', '--vault', root, '--format', 'json']))
    assert.equal(saved.result.thrown, null)
    assert.deepEqual(saved.result.exits, [])
    const meal = JSON.parse(saved.result.stdout)
    assert.equal(typeof meal.mealId, 'string')
    assert.equal(meal.nutrition.totals.calories, 420)
    assert.equal(meal.note, 'PRIVATE_SENTINEL')
    assert.equal(add.mock.calls.length, 1)
    assert.equal(edit.mock.calls.length, 0)
    const edited = await collect(() => invoke(['meal', 'edit', meal.mealId,
      '--day-key-policy', 'keep',
      '--nutrition-calories', '430', '--nutrition-source', 'estimated',
      '--nutrition-protein-grams', '30', '--nutrition-confidence', 'medium',
      '--occurred-at', '2030-01-15T11:00:00.000Z', '--vault', root, '--format', 'json']))
    assert.equal(edited.result.thrown, null)
    assert.deepEqual(edited.result.exits, [])
    assert.equal(JSON.parse(edited.result.stdout).entity.data.nutrition.totals.calories, 430)
    assert.equal(JSON.parse(edited.result.stdout).entity.data.nutrition.totals.proteinGrams, 30)
    assert.equal(JSON.parse(edited.result.stdout).entity.data.nutrition.provenance.confidence, 'medium')
    assert.equal(add.mock.calls.length, 1)
    assert.equal(edit.mock.calls.length, 1)
    assert.equal(importers.mock.calls.length, 1)
    assert.equal(editRecord.mock.calls.length, 1)
    assert.equal((await records.listMealRecords({ vault: root })).count, 1)
    for (const [action, captured] of [['add', saved], ['edit', edited]] as const) {
      assert.equal(captured.timing.reportCount, 1)
      assert.equal(captured.timing.commands.length, 1)
      assert.equal(captured.timing.commands[0]!.command, `meal ${action}`)
      assert.equal(captured.timing.commands[0]!.outcome, 'ok')
      assert.equal(captured.timing.commands[0]!.calls, 1)
      assert.equal(captured.timing.commands[0]!.failures, undefined)
      assert.equal(captured.timing.commands[0]!.droppedFailures, undefined)
      assert.equal(captured.timing.droppedCalls, 0)
      assert.equal(captured.timing.droppedSpans, 0)
      assert.equal(captured.timing.transportTruncated, false)
      assert.ok(Buffer.byteLength(captured.wire) <= CLI_TIMING_MAX_REPORT_BYTES)
      assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
    }
    const readArgs = ['meal', 'show', meal.mealId, '--vault', root, '--format', 'json']
    const beforeRemoval = await invoke(readArgs)
    const read = await collect(() => invoke(readArgs))
    assert.deepEqual(read.result, beforeRemoval)
    assert.deepEqual(read.result.exits, [])
    assert.equal(read.timing.commands[0]!.failures, undefined)
    for (const batch of [false, true]) {
      const args = ['meal', 'remove-photo', meal.mealId]
      const argv = batch
        ? ['batch', '--vault', root, '--format', 'json', '--stop-on-error', '--command', JSON.stringify(args),
          '--command', '["meal","list"]']
        : [...args, '--vault', root, '--format', 'json']
      const baseline = await invoke(argv)
      const captured = await collect(() => invoke(argv))
      assert.deepEqual(captured.result, baseline)
      assert.equal(captured.result.thrown, null)
      assert.deepEqual(captured.result.exits, batch ? [] : [1])
      const output = JSON.parse(captured.result.stdout)
      if (batch) {
        assert.equal(output.executed, 1)
        assert.equal(output.stoppedEarly, true)
      }
      assert.equal((batch ? output.commands[0].error : output).code, 'invalid_operation')
      assert.equal(captured.timing.batchContainers, batch ? 1 : 0)
      assert.equal(captured.timing.commands.length, 1)
      assert.equal(captured.timing.commands[0]!.command, 'meal remove-photo')
      assert.equal(captured.timing.commands[0]!.calls, 1)
      assert.deepEqual(captured.timing.commands[0]!.failures, [{ code: 'invalid_operation', stage: 'unknown', count: 1 }])
      assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
    }
    assert.equal(removeRecord.mock.calls.length, 4, 'One real handler per failed invocation, no retries.')
    assert.equal(removePhoto.mock.calls.length, 4)
    assert.equal(add.mock.calls.length, 1)
    assert.equal(edit.mock.calls.length, 1)
    assert.deepEqual(await invoke(readArgs), beforeRemoval, 'Ordinary-meal rejection leaves canonical data unchanged.')

    const photoPath = path.join(home, 'PRIVATE_SENTINEL.jpg')
    await writeFile(photoPath, 'synthetic image bytes')
    const automatic = await core.addMeal({ vaultRoot: root, photoPath, source: 'device',
      occurredAt: '2030-01-15T09:00:00.000Z',
      nutrition: { totals: { calories: 500, proteinGrams: 25 }, provenance: { source: 'estimated', confidence: 'medium' } },
      externalRef: { system: 'meal-photo-capture', resourceType: 'photo',
        resourceId: 'synthetic-capture', version: 'b'.repeat(64) } })
    const automaticArgs = ['meal', 'remove-photo', automatic.mealId, '--vault', root, '--format', 'json']
    const removed = await collect(() => invoke(automaticArgs))
    assert.equal(removed.result.thrown, null)
    assert.deepEqual(removed.result.exits, [])
    const entity = JSON.parse(removed.result.stdout).entity
    assert.deepEqual(entity.data.attachments ?? [], [])
    assert.equal(entity.data.nutrition.totals.proteinGrams, 25)
    const idempotentBaseline = await invoke(automaticArgs)
    const idempotent = await collect(() => invoke(automaticArgs))
    assert.deepEqual(idempotent.result, idempotentBaseline)
    assert.deepEqual(idempotent.result, removed.result, 'No extra revision on idempotent removal.')
    assert.equal(removeRecord.mock.calls.length, 7)
    assert.equal(removePhoto.mock.calls.length, 7)
    const removals = await Promise.all(removePhoto.mock.results.slice(4).map(result => result.value))
    assert.deepEqual(removals.map(result => result.removedPhotoCount), [1, 0, 0])
    assert.equal(add.mock.calls.length, 2)
    assert.equal(edit.mock.calls.length, 1)
    for (const captured of [removed, idempotent]) {
      assert.equal(captured.timing.commands[0]!.outcome, 'ok')
      assert.equal(captured.timing.commands[0]!.calls, 1)
      assert.equal(captured.timing.commands[0]!.failures, undefined)
      assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
    }
    assert.equal(fetchImpl.mock.calls.length, 0)
  } finally { vi.useRealTimers() }
})

// Parent can apply just this test-file hunk to the declared base. This mode
// must run the actual old timing owners, never patched code with stripped fields.
async function sourceCauseBaseline(): Promise<boolean> {
  const base = process.env.MURPH_CLI_SOURCE_CAUSE_BASELINE
  if (base === undefined) return false
  assert.equal(base, '704630e3fda169456458db4c7a0f50121be120ee')
  for (const owner of ['src/cli-timing.ts', 'src/node/cli-timing.ts']) {
    const current = await readFile(new URL(`../../runtime-state/${owner}`, import.meta.url))
    const original: Buffer = execFileSync('git', ['show', `${base}:packages/runtime-state/${owner}`], { maxBuffer: 1_000_000 })
    assert.equal(current.equals(original), true, `BASE reproduction requires the unchanged ${owner} owner.`)
  }
  return true
}

test('real source-cause meal errors preserve output, original bridge errors and canonical mutation boundaries', async () => {
  const baseTiming = await sourceCauseBaseline()
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cli-source-cause-PRIVATE_SENTINEL-'))
  roots.push(directory)
  vi.stubEnv('HOME', directory)
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
  const fetchImpl = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
    throw new Error('PRIVATE_SENTINEL unexpected provider request')
  })
  const root = await vault()
  const core = await import('@murphai/core')
  const records = await import('@murphai/vault-usecases/records')
  const timingOwner = await import('@murphai/runtime-state/node/cli-timing')
  const { VaultCliError } = await import('@murphai/operator-config/vault-cli-errors')
  const observed = vi.spyOn(timingOwner, 'noteCliTimingFailure')
  const edit = vi.spyOn(records, 'editMealRecord')
  const remove = vi.spyOn(records, 'removeAutomaticMealPhotoRecord')
  const upsert = vi.spyOn(core, 'upsertEvent')
  vi.spyOn(performance, 'now').mockReturnValue(0)
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date('2030-01-15T12:00:00.000Z'))
  try {
    const meal = await core.addMeal({ vaultRoot: root, note: 'PRIVATE_SENTINEL',
      occurredAt: '2030-01-15T10:00:00.000Z' })
    const photoPath = path.join(directory, 'PRIVATE_SENTINEL.jpg')
    await writeFile(photoPath, 'synthetic original photo bytes')
    const photos: Array<Awaited<ReturnType<typeof core.addMeal>>> = []
    for (const index of [0, 1]) {
      photos.push(await core.addMeal({ vaultRoot: root, photoPath, source: 'device',
        occurredAt: '2030-01-15T09:00:00.000Z', externalRef: { system: 'meal-photo-capture',
          resourceType: 'photo', resourceId: `synthetic-${index}`, version: 'b'.repeat(64) } }))
    }
    const integrity = photos[0]!, manifest = photos[1]!
    assert.ok(integrity.photo)
    assert.ok(manifest.photo)
    const retainedPath = path.join(root, integrity.photo.relativePath)
    await writeFile(retainedPath, 'PRIVATE_SENTINEL changed synthetic photo bytes')
    const manifestPath = path.join(root, manifest.manifestPath)
    const manifestBytes = await readFile(manifestPath, 'utf8')
    const changedManifest = JSON.parse(manifestBytes)
    const artifact = changedManifest.artifacts.find((entry: { relativePath: string }) =>
      entry.relativePath === manifest.photo!.relativePath)
    assert.ok(artifact)
    artifact.sha256 = '0'.repeat(64)
    await writeFile(manifestPath, JSON.stringify(changedManifest))

    const cases = [
      // The CLI accepts confidence, but a newly created provenance object must
      // also have source. The real core contract, not a stubbed handler, rejects.
      { args: ['meal', 'edit', meal.mealId, '--nutrition-confidence', 'medium'],
        code: 'contract_invalid', stage: 'validation', vaultCode: undefined, handler: edit },
      { args: ['meal', 'remove-photo', integrity.mealId], code: 'vault_error', stage: 'unknown',
        vaultCode: 'MEAL_PHOTO_RETENTION_PRECONDITION_FAILED', handler: remove },
      { args: ['meal', 'remove-photo', manifest.mealId], code: 'vault_error', stage: 'unknown',
        vaultCode: 'MEAL_PHOTO_RETENTION_MANIFEST_INVALID', handler: remove },
    ] as const
    const canonical = await vaultFiles(root, true)
    for (const fixture of cases) {
      const argv = [...fixture.args, '--vault', root, '--format', 'json']
      const before = fixture.handler.mock.calls.length
      const baseline = await invoke(argv)
      const captured = await collect(() => invoke(argv))
      assert.deepEqual(captured.result, baseline)
      assert.equal(captured.result.thrown, null)
      assert.deepEqual(captured.result.exits, [1])
      assert.equal(JSON.parse(captured.result.stdout).code, fixture.code)
      assert.equal(fixture.handler.mock.calls.length, before + 2)
      const originResult = fixture.handler.mock.results.at(-1)
      assert.ok(originResult?.type === 'return')
      await assert.rejects(originResult.value, original => {
        assert.ok(original instanceof VaultCliError)
        assert.equal(original.code, fixture.code)
        if (fixture.vaultCode) assert.equal(original.context?.vaultCode, fixture.vaultCode)
        assert.ok(observed.mock.calls.some(([error]) => error === original),
          'The bridge must observe the exact real record error before projection.')
        assert.equal(Object.hasOwn(original, 'sourceCause'), false)
        return true
      })
      assert.equal(captured.timing.commands.length, 1)
      assert.equal(captured.timing.commands[0]!.command, fixture.args.slice(0, 2).join(' '))
      assert.equal(captured.timing.commands[0]!.outcome, 'error')
      assert.equal(captured.timing.commands[0]!.calls, 1)
      assert.deepEqual(captured.timing.commands[0]!.failures,
        [{ code: 'unknown', stage: fixture.stage, count: 1,
          ...(baseTiming ? {} : { sourceCause: {
            code: fixture.code, ...(fixture.vaultCode ? { vaultCode: fixture.vaultCode } : {}),
          } }) }])
      assert.ok(Buffer.byteLength(captured.wire) <= CLI_TIMING_MAX_REPORT_BYTES)
      assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
      assert.equal(captured.result.stdout.includes('sourceCause'), false)
      assert.deepEqual(await vaultFiles(root, true), canonical)
    }
    const batchArgs = ['batch', '--vault', root, '--format', 'json',
      ...[cases[0], cases[1], cases[2], cases[0]].flatMap(row => ['--command', JSON.stringify(row.args)])]
    const baseline = await invoke(batchArgs)
    const batch = await collect(() => invoke(batchArgs))
    assert.deepEqual(batch.result, baseline)
    assert.deepEqual(batch.result.exits, [])
    assert.equal(JSON.parse(batch.result.stdout).failed, 4)
    assert.equal(batch.timing.batchContainers, 1)
    assert.equal(batch.timing.commands.reduce((count, command) => count + command.calls, 0), 4)
    assert.deepEqual(batch.timing.commands.map(command => command.failures), [
      [{ code: 'unknown', stage: 'validation', count: 2,
        ...(baseTiming ? {} : { sourceCause: { code: 'contract_invalid' } }) }],
      baseTiming ? [{ code: 'unknown', stage: 'unknown', count: 2 }] : [
        { code: 'unknown', stage: 'unknown', count: 1,
          sourceCause: { code: 'vault_error', vaultCode: 'MEAL_PHOTO_RETENTION_PRECONDITION_FAILED' } },
        { code: 'unknown', stage: 'unknown', count: 1,
          sourceCause: { code: 'vault_error', vaultCode: 'MEAL_PHOTO_RETENTION_MANIFEST_INVALID' } },
      ],
    ])
    assert.equal(batch.timing.droppedCalls, 0)
    assert.equal(batch.timing.droppedSpans, 0)
    assert.equal(batch.wire.includes('PRIVATE_SENTINEL'), false)
    assert.deepEqual(await vaultFiles(root, true), canonical)
    assert.equal(upsert.mock.calls.length, 6, 'One real writer attempt for each rejected edit, without retries.')

    // Valid adjacent edit performs one intended write. A quiet read and an
    // idempotent removal then prove on/off output parity without extra revisions.
    const saved = await collect(() => invoke(['meal', 'edit', meal.mealId,
      '--nutrition-confidence', 'medium', '--nutrition-source', 'estimated',
      '--vault', root, '--format', 'json']))
    assert.deepEqual(saved.result.exits, [])
    assert.equal(JSON.parse(saved.result.stdout).entity.data.nutrition.provenance.source, 'estimated')
    assert.equal(upsert.mock.calls.length, 7)
    assert.equal(saved.timing.commands[0]!.failures, undefined)
    await writeFile(retainedPath, 'synthetic original photo bytes')
    const removeArgs = ['meal', 'remove-photo', integrity.mealId, '--vault', root, '--format', 'json']
    const removed = await collect(() => invoke(removeArgs))
    assert.deepEqual(removed.result.exits, [])
    assert.deepEqual(JSON.parse(removed.result.stdout).entity.data.attachments ?? [], [])
    for (const argv of [removeArgs, ['meal', 'show', meal.mealId, '--vault', root, '--format', 'json']]) {
      const before = await vaultFiles(root, true)
      const quietBaseline = await invoke(argv)
      const quiet = await collect(() => invoke(argv))
      assert.deepEqual(quiet.result, quietBaseline)
      assert.deepEqual(quiet.result.exits, [])
      assert.equal(quiet.timing.commands[0]!.failures, undefined)
      assert.equal(quiet.wire.includes('PRIVATE_SENTINEL'), false)
      assert.deepEqual(await vaultFiles(root, true), before)
    }
    assert.equal(fetchImpl.mock.calls.length, 0)
  } finally { vi.useRealTimers() }
})

test('real source-cause food and research responses preserve CLI output and distinguish source-owned failures', async () => {
  const baseTiming = await sourceCauseBaseline()
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cli-response-PRIVATE_SENTINEL-'))
  roots.push(directory)
  vi.stubEnv('HOME', directory)
  vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
  vi.stubEnv('MURPH_DATA_API_KEY', 'PRIVATE_SENTINEL')
  vi.stubEnv('EXA_API_KEY', 'PRIVATE_SENTINEL')
  vi.spyOn(process, 'loadEnvFile').mockImplementation(() => {})
  vi.spyOn(performance, 'now').mockReturnValue(0)
  // Date-only until clamps to new Date(), not Date.now(). Freeze both while
  // leaving monotonic timing, socket delivery and timeout handling unchanged.
  const researchNow = '2030-01-15T12:00:00.000Z'
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(new Date(researchNow))
  const { syntheticOats } = await import('./fixtures/food-label-response.ts')
  const labels = await import('../src/food-labels.ts')
  const research = await import('../src/research-scout-client.ts')
  const contracts = await import('@murphai/contracts')
  const { VaultCliError } = await import('@murphai/operator-config/vault-cli-errors')
  const timingOwner = await import('@murphai/runtime-state/node/cli-timing')
  const observed = vi.spyOn(timingOwner, 'noteCliTimingFailure')
  const foodHandler = vi.spyOn(labels, 'searchFoodLabelsBatch')
  const researchHandler = vi.spyOn(research, 'fetchExaResearchScoutBatchCandidates')
  const file = path.join(directory, 'PRIVATE_SENTINEL.json')
  const lanes = [{ label: 'sleep', profile: { topics: ['sleep'] } }]
  await writeFile(file, JSON.stringify({ lanes }))
  const researchInput = contracts.researchScoutBatchInputSchema.parse({ lanes,
    since: '2030-01-01T00:00:00.000Z', until: researchNow, maxCandidatesPerLane: 1 })
  const expectedResearchBody = contracts.buildExaResearchScoutBatchLaneRequest({
    profile: researchInput.lanes[0]!.profile, since: researchInput.since, until: researchInput.until, maxCandidates: 1,
  })
  const timeout = AbortSignal.timeout.bind(AbortSignal)
  let researchDeadline: AbortController | undefined
  vi.spyOn(AbortSignal, 'timeout').mockImplementation(milliseconds => {
    if (milliseconds !== 60_000) return timeout(milliseconds)
    researchDeadline = new AbortController()
    return researchDeadline.signal
  })
  const bodyFailure = (name = 'TypeError') => new Response(new ReadableStream<Uint8Array>({
    start(controller) { controller.error(Object.assign(new Error('PRIVATE_SENTINEL'), { name })) },
  }))
  const http = (status: number) => () => new Response('PRIVATE_SENTINEL', { status })
  const invalidJson = () => new Response('PRIVATE_SENTINEL not JSON')
  const invalidShape = () => Response.json({ PRIVATE_SENTINEL: true })
  const owners = [
    { command: 'food search-labels-batch', handler: foodHandler,
      args: ['food', 'search-labels-batch', '--query', 'PRIVATE_SENTINEL oats', '--generic'],
      target: 'http://murph-data-api.worker/api/foods',
      body: { queries: ['PRIVATE_SENTINEL oats'], limit: 1, includeOffMarket: false, genericOnly: true, nutritionOnly: true },
      success: { results: [{ query: 'PRIVATE_SENTINEL oats', items: [syntheticOats] }] },
      failures: [
        { code: 'food_labels_api_auth_failed', response: http(401) },
        { code: 'food_labels_api_rate_limited', response: http(429) },
        { code: 'food_labels_api_request_timed_out', response: http(408) },
        { code: 'food_labels_api_service_unavailable', response: http(503) },
        { code: 'food_labels_api_response_failed', response: http(422) },
        { code: 'food_labels_api_response_body_failed', response: () => bodyFailure() },
        { code: 'food_labels_api_response_body_timed_out', response: () => bodyFailure('TimeoutError') },
        { code: 'food_labels_api_invalid_response', response: invalidJson },
        { code: 'food_labels_api_invalid_response', response: invalidShape },
      ] },
    { command: 'research scout-batch', handler: researchHandler,
      args: ['research', 'scout-batch', '--input', `@${file}`, '--since', '2030-01-01', '--until', '2030-01-15', '--max-candidates-per-lane', '1'],
      target: 'https://api.exa.ai/search', body: expectedResearchBody,
      success: { results: [{ title: 'Synthetic paper', url: 'https://example.test/paper' }],
        output: { content: { candidates: [{ resultIndex: 0 }] } }, extraProviderField: 'PRIVATE_SENTINEL' },
      failures: [
        { code: 'research_exa_auth_failed', response: http(401) },
        { code: 'research_exa_rate_limited', response: http(429) },
        { code: 'research_exa_unavailable', response: http(503) },
        { code: 'research_exa_request_rejected', response: http(422) },
        { code: 'research_exa_unavailable', response: () => bodyFailure() },
        { code: 'research_exa_invalid_response', response: invalidJson },
        { code: 'research_exa_invalid_response', response: invalidShape },
        { code: 'research_exa_timeout', response: () => {
          assert.ok(researchDeadline)
          researchDeadline.abort(new Error('PRIVATE_SENTINEL'))
          return bodyFailure()
        } },
      ] },
  ]
  let active = owners[0]!
  let respond: () => Response = invalidJson
  const fetchImpl = vi.spyOn(globalThis, 'fetch').mockImplementation(async (target, init) => {
    assert.equal(String(target), active.target)
    assert.equal(init?.method, 'POST')
    assert.deepEqual(JSON.parse(String(init?.body)), active.body,
      'Use the real command contract and research prompt builder, without altered inputs.')
    return respond()
  })
  const files = await vaultFiles(directory)
  for (const owner of owners) {
    active = owner
    const argv = [...owner.args, '--vault', directory, '--format', 'json']
    for (const failure of owner.failures) {
      respond = failure.response
      const before = fetchImpl.mock.calls.length
      const baseline = await invoke(argv)
      const captured = await collect(() => invoke(argv))
      assert.deepEqual(captured.result, baseline)
      assert.equal(captured.result.thrown, null)
      assert.deepEqual(captured.result.exits, [1])
      assert.equal(JSON.parse(captured.result.stdout).code, failure.code)
      const originResult = owner.handler.mock.results.at(-1)
      assert.ok(originResult?.type === 'return')
      await assert.rejects(originResult.value, original => {
        assert.ok(original instanceof VaultCliError)
        assert.equal(original.code, failure.code)
        assert.ok(observed.mock.calls.some(([error]) => error === original))
        assert.equal(Object.hasOwn(original, 'sourceCause'), false)
        return true
      })
      assert.equal(fetchImpl.mock.calls.length, before + 2, 'Exactly one fake provider request per invocation.')
      assert.equal(captured.timing.commands.length, 1)
      assert.equal(captured.timing.commands[0]!.command, owner.command)
      assert.equal(captured.timing.commands[0]!.outcome, 'error')
      assert.equal(captured.timing.commands[0]!.calls, 1)
      assert.deepEqual(captured.timing.commands[0]!.failures, [{ code: 'unknown', stage: 'response', count: 1,
        ...(baseTiming ? {} : { sourceCause: { code: failure.code } }) }])
      assert.ok(Buffer.byteLength(captured.wire) <= CLI_TIMING_MAX_REPORT_BYTES)
      assert.equal(captured.wire.includes('PRIVATE_SENTINEL'), false)
      assert.equal(captured.result.stdout.includes('sourceCause'), false)
      assert.deepEqual(await vaultFiles(directory), files)
    }
    let index = 0
    // Repeated cause and a distinct cause share the same legacy code/stage.
    const sequence = [owner.failures[0]!, owner.failures[1]!, owner.failures[0]!]
    respond = () => sequence[index++]!.response()
    const batchArgs = ['batch', '--vault', directory, '--format', 'json',
      ...sequence.flatMap(() => ['--command', JSON.stringify(owner.args)])]
    const before = fetchImpl.mock.calls.length
    const baseline = await invoke(batchArgs)
    index = 0
    const batch = await collect(() => invoke(batchArgs))
    assert.deepEqual(batch.result, baseline)
    assert.deepEqual(batch.result.exits, [])
    assert.equal(JSON.parse(batch.result.stdout).failed, 3)
    assert.equal(batch.timing.batchContainers, 1)
    assert.equal(batch.timing.commands[0]!.calls, 3)
    assert.deepEqual(batch.timing.commands[0]!.failures, baseTiming
      ? [{ code: 'unknown', stage: 'response', count: 3 }] : [
      { code: 'unknown', stage: 'response', count: 2, sourceCause: { code: sequence[0]!.code } },
      { code: 'unknown', stage: 'response', count: 1, sourceCause: { code: sequence[1]!.code } },
    ])
    assert.equal(fetchImpl.mock.calls.length, before + 6)
    assert.equal(batch.wire.includes('PRIVATE_SENTINEL'), false)
    assert.equal(batch.timing.droppedCalls, 0)
    assert.equal(batch.timing.commands[0]!.droppedFailures, undefined)

    respond = () => Response.json(owner.success)
    const successBefore = fetchImpl.mock.calls.length
    const successBaseline = await invoke(argv)
    const success = await collect(() => invoke(argv))
    assert.deepEqual(success.result, successBaseline)
    assert.deepEqual(success.result.exits, [])
    assert.equal(success.timing.commands[0]!.outcome, 'ok')
    assert.equal(success.timing.commands[0]!.failures, undefined)
    assert.equal(fetchImpl.mock.calls.length, successBefore + 2)
    const quietBaseline = await invoke(['--version'])
    const quiet = await collect(() => invoke(['--version']))
    assert.deepEqual(quiet.result, quietBaseline)
    assert.equal(quiet.timing.commands[0]!.failures, undefined)
    assert.equal(fetchImpl.mock.calls.length, successBefore + 2)
    assert.equal(success.wire.includes('PRIVATE_SENTINEL'), false)
    assert.deepEqual(await vaultFiles(directory), files)
  }
})
