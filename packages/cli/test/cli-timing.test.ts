import assert from 'node:assert/strict'
import { randomInt } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Cli } from 'incur'
import { afterEach, test, vi } from 'vitest'

import { cliTimingCommand, normalizeCliTiming, type CliTiming } from '@murphai/runtime-state/cli-timing'
import { planVaultCliInvocation } from '../src/vault-cli-routing.ts'

const roots: string[] = []
const initialEndpoint = process.env.MURPH_CLI_TIMING_ENDPOINT

afterEach(async () => {
  vi.restoreAllMocks()
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
async function collect<T>(run: () => Promise<T>): Promise<{ result: T; timing: CliTiming }> {
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
    const envelope = JSON.parse(buffer.toString('utf8'))
    assert.equal(envelope.key, key)
    const timing = normalizeCliTiming(envelope.timing)
    assert.ok(timing)
    return { result, timing }
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
