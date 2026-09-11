import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createHash, randomInt } from 'node:crypto'
import { createSocket } from 'node:dgram'
import { once } from 'node:events'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setImmediate } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'
import { normalizeCliTiming, type CliTiming } from '@murphai/runtime-state/cli-timing'
import { syntheticOats } from './fixtures/food-label-response.ts'

const root = fileURLToPath(new URL('../../..', import.meta.url))
const childFile = fileURLToPath(new URL('./fixtures/cli-timing-child.ts', import.meta.url))
const tsx = import.meta.resolve('tsx')
const key = '0123456789abcdef0123456789abcdef'
const sentinels = ['SYNTHETIC_SECRET_TOKEN', 'SYNTHETIC_HEALTH_HISTORY', 'SYNTHETIC_PRIVATE_PATH']

async function tree(directory: string): Promise<unknown> {
  const names = (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))
  return Promise.all(names.map(async (entry) => [entry.name, entry.isDirectory()
    ? await tree(path.join(directory, entry.name))
    : createHash('sha256').update(await readFile(path.join(directory, entry.name))).digest('hex')]))
}

async function isolated(run: (directory: string, invoke: (
  argv: string[], expectedRequests?: number, timed?: boolean,
) => Promise<{ stdout: string; stderr: string; code: number | null; signal: NodeJS.Signals | null; timing: CliTiming | null }>) => Promise<void>) {
  const directory = await mkdtemp(path.join(tmpdir(), 'murph-cli-SYNTHETIC_PRIVATE_PATH-'))
  await mkdir(path.join(directory, 'vault'))
  await writeFile(path.join(directory, '.env'), 'MURPH_DATA_API_KEY=SYNTHETIC_DO_NOT_LOAD\n')
  await writeFile(path.join(directory, 'vault', 'sentinel.txt'), 'SYNTHETIC_HEALTH_HISTORY')
  const before = await tree(directory)
  try {
    await run(directory, async (argv, expectedRequests = 0, timed = true) => {
      const socket = createSocket('udp4')
      const port = randomInt(49_152, 65_536)
      const messages: string[] = []
      socket.on('message', (message) => messages.push(message.toString('utf8')))
      try {
        const listening = once(socket, 'listening')
        socket.bind(port, '127.0.0.1')
        await listening
        const child = spawn(process.execPath, ['--no-warnings', '--import', tsx,
          childFile, String(expectedRequests), ...argv], {
          cwd: directory,
          // Deliberately no process.env spread, NODE_OPTIONS, user config or
          // .env loading. Pin public workspace imports to the production TS
          // source graph, never whichever dist files happen to be installed.
          env: {
            HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: directory,
            TMPDIR: directory, TMP: directory, TEMP: directory,
            TSX_TSCONFIG_PATH: path.join(root, 'tsconfig.base.json'), TSX_DISABLE_CACHE: '1',
            MURPH_HOSTED_RUNTIME_PROCESS: '1', MURPH_DATA_API_KEY: 'SYNTHETIC_SECRET_TOKEN',
            ...(timed ? { MURPH_CLI_TIMING_ENDPOINT: `${port}:${key}` } : {}),
          },
          stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
        })
        let stdout = '', stderr = ''
        child.stdout.on('data', (chunk) => { stdout += chunk })
        child.stderr.on('data', (chunk) => { stderr += chunk })
        const [code, signal] = await once(child, 'close') as [number | null, NodeJS.Signals | null]
        await setImmediate()
        assert.equal(signal, null, 'child must exit normally, not hit the harness deadline')
        assert.equal(stderr, '', 'includes the child no-unexpected-provider-call assertion')
        assert.deepEqual(await tree(directory), before, 'read-only commands must not change vault, cwd or home')
        assert.equal(messages.length, timed ? 1 : 0, 'exactly one report per real CLI subprocess')
        let timing: CliTiming | null = null
        if (timed) {
          const envelope = JSON.parse(messages[0]!)
          assert.equal(envelope.key, key)
          timing = normalizeCliTiming(envelope.timing)
          assert.ok(timing)
          for (const sentinel of sentinels) assert.ok(!messages[0]!.includes(sentinel))
          assert.ok(!messages[0]!.includes('synthetic oats'))
        }
        return { code, signal, stdout, stderr, timing }
      } finally { socket.close() }
    })
  } finally { await rm(directory, { recursive: true, force: true }) }
}

type Case = { name: string; argv: string[]; command: string; code?: string; field?: string; requests?: number }
const cases: Case[] = [
  { name: 'food limit validation before provider access', argv: ['food', 'search-labels', 'synthetic oats', '--limit', '51'],
    command: 'food search-labels', code: 'VALIDATION_ERROR', field: 'limit' },
  { name: 'exercise invalid kind', argv: ['exercise', 'list', '--kind', 'synthetic-invalid'],
    command: 'exercise list', code: 'VALIDATION_ERROR', field: 'kind' },
  { name: 'exercise missing lookup', argv: ['exercise', 'show', 'synthetic-no-such-exercise'],
    command: 'exercise show', code: 'exercise_not_found' },
  { name: 'nearby successful catalog lookup', argv: ['exercise', 'list', '--query', 'squat', '--limit', '1'],
    command: 'exercise list' },
  { name: 'successful fake-provider food lookup', argv: ['food', 'search-labels', 'synthetic oats', '--limit', '1'],
    command: 'food search-labels', requests: 1 },
]

for (const sample of cases) test(`real subprocess: ${sample.name}`, async () => {
  await isolated(async (directory, invoke) => {
    const argv = [...sample.argv, '--vault', path.join(directory, 'vault'), '--format', 'json']
    const off = await invoke(argv, sample.requests, false)
    const on = await invoke(argv, sample.requests)
    assert.deepEqual({ ...on, timing: null }, off, 'exit and complete model-visible output/hints must be byte-identical')
    assert.equal(on.code, sample.code ? 1 : 0)
    const output = JSON.parse(on.stdout)
    if (sample.code) {
      assert.equal(output.code, sample.code)
      assert.equal(typeof output.message, 'string')
      if (sample.field) {
        assert.ok(output.fieldErrors.some((error: { path: string }) =>
          error.path === sample.field || error.path.startsWith(`${sample.field}.`)))
      } else {
        assert.equal(output.message, 'No public exercise catalog item matched "synthetic-no-such-exercise".')
      }
    } else if (sample.requests) {
      assert.deepEqual(output, { source: 'murph-data-api', query: 'synthetic oats', limit: 1,
        includeOffMarket: false, items: [syntheticOats] })
    } else {
      assert.ok(output.total > 0)
      assert.equal(output.items.length, 1)
      assert.equal(typeof output.items[0].id, 'string')
    }
    const commands = on.timing!.commands
    assert.equal(commands.length, 1)
    assert.equal(commands[0]!.command, sample.command)
    assert.equal(commands[0]!.outcome, sample.code ? 'error' : 'ok')
    assert.equal(commands[0]!.calls, 1)
    assert.deepEqual(commands[0]!.failures, sample.code
      ? [{ code: sample.code, stage: sample.field ? 'validation' : 'unknown', count: 1 }] : undefined)
  })
}, 90_000)

test('early root/built-in parse rejection and natural version success retain exact exits and output', async () => {
  await isolated(async (directory, invoke) => {
    for (const argv of [['--format', 'json', '--vault'], ['--version'],
      ['exercise', 'list', '--token-limit', 'SYNTHETIC_SECRET_TOKEN',
        '--vault', path.join(directory, 'vault'), '--format', 'json']]) {
      const off = await invoke(argv, 0, false)
      const on = await invoke(argv)
      assert.deepEqual({ ...on, timing: null }, off)
      assert.equal(on.code, argv[0] === '--version' ? 0 : 1)
      assert.equal(on.timing!.commands[0]!.command, 'other')
      if (argv[0] === 'exercise') {
        const error = JSON.parse(on.stdout)
        assert.equal(error.code, 'VALIDATION_ERROR')
        assert.equal(error.message, 'The command arguments are invalid.')
        assert.equal(error.hint, 'Run the command with --help and correct its arguments or options.')
        assert.equal(error.fieldErrors[0].path, 'arguments')
        // Built-ins fail before dispatch/bridge evidence exists. Do not infer
        // the catalog command or copy detail from the printed result.
        assert.deepEqual(on.timing!.commands[0]!.failures, [{ code: 'unknown', stage: 'unknown', count: 1 }])
      } else if (on.code === 1) {
        assert.deepEqual(JSON.parse(on.stdout), { code: 'invalid_option', message: 'Missing value for --vault.', retryable: false })
        assert.deepEqual(on.timing!.commands[0]!.failures, [{ code: 'invalid_option', stage: 'unknown', count: 1 }])
      } else assert.match(on.stdout, /^\d+\.\d+\.\d+[^\n]*\n$/u)
    }
  })
}, 120_000)

test('real batch children report once, preserve stop-on-error and reject nested batches unchanged', async () => {
  await isolated(async (directory, invoke) => {
    const common = ['--vault', path.join(directory, 'vault'), '--format', 'json']
    const argv = ['batch', '--compact', '--stop-on-error', '--command', JSON.stringify(cases[3]!.argv),
      '--command', JSON.stringify(cases[1]!.argv), '--command', JSON.stringify(cases[4]!.argv), ...common]
    const off = await invoke(argv, 0, false)
    const on = await invoke(argv)
    assert.deepEqual({ ...on, timing: null }, off)
    assert.equal(on.code, 0) // Batch's existing envelope, not the child exit.
    const result = JSON.parse(on.stdout)
    assert.equal(result.requested, 3)
    assert.equal(result.executed, 2)
    assert.equal(result.failed, 1)
    assert.equal(result.stoppedEarly, true)
    assert.equal(result.commands[1].error.code, 'VALIDATION_ERROR')
    assert.equal(on.timing!.reportCount, 1)
    assert.equal(on.timing!.batchContainers, 1)
    assert.deepEqual(on.timing!.commands.map(({ command, outcome, calls }) => ({ command, outcome, calls })), [
      { command: 'exercise list', outcome: 'ok', calls: 1 },
      { command: 'exercise list', outcome: 'error', calls: 1 },
    ])
    const nestedArgv = ['batch', '--command', '["batch"]', ...common]
    const nestedOff = await invoke(nestedArgv, 0, false)
    const nested = await invoke(nestedArgv)
    assert.deepEqual({ ...nested, timing: null }, nestedOff)
    assert.equal(nested.code, 0)
    const error = JSON.parse(nested.stdout).commands[0].error
    assert.equal(error.code, 'invalid_option')
    assert.equal(error.message, 'Nested batch commands are not supported.')
    assert.equal(nested.timing!.batchContainers, 1)
    assert.deepEqual(nested.timing!.commands, [])
  })
}, 120_000)
