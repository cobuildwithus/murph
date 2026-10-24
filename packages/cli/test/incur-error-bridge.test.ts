import assert from 'node:assert/strict'
import { Cli, Errors, middleware } from 'incur'
import { afterEach, test, vi } from 'vitest'
import { normalizeCliTiming, type CliTiming } from '@murphai/runtime-state/cli-timing'
import * as timing from '@murphai/runtime-state/node/cli-timing'
import { incurErrorBridge } from '../src/incur-error-bridge.js'
import { projectVaultCliError } from '../src/vault-cli-error-projection.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import { normalizeRepeatableEnumFlagOption, normalizeRepeatableFlagOption } from '@murphai/vault-usecases'

// Errors is a native ESM namespace. Mock the module export rather than
// redefining it; keep the real classes, projection and timing scope owner.
vi.mock('incur', async (importOriginal) => {
  const actual = await importOriginal<typeof import('incur')>()
  return { ...actual, Errors: { ...actual.Errors, toErrorEnvelope: vi.fn(actual.Errors.toErrorEnvelope) } }
})
vi.mock('@murphai/runtime-state/node/cli-timing', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@murphai/runtime-state/node/cli-timing')>()
  return { ...actual, noteCliTimingFailure: vi.fn(actual.noteCliTimingFailure) }
})

// Reset call history and one-shot failures back to the real vi.fn implementations.
afterEach(() => { vi.resetAllMocks() })

// Inspect the bridge's throw before Incur renders it. Real registered commands,
// byte parity and canonical effects are covered in cli-timing.test.ts.
async function observe(error: unknown, enabled = true, command = 'knowledge show') {
  let caught: unknown
  let release!: () => void
  let late: Promise<void> | undefined
  const gate = new Promise<void>((resolve) => { release = resolve })
  const reports: CliTiming[] = []
  const cli = Cli.create('synthetic-bridge')
  cli.use(middleware(async (_context, next) => {
    try { await next() } catch (value) { caught = value }
  }))
  cli.use(incurErrorBridge)
  cli.command('show', { run() { throw error } })
  const run = () => timing.timeCliDispatch(command, async () => {
    late = gate.then(() => {
      timing.noteCliTimingFailure(error)
      timing.noteCliTimingExit(1, false)
    })
    await cli.serve(['show', '--format', 'json'], { stdout() {}, exit() {} })
    assert.notEqual(caught, undefined)
    timing.noteCliTimingFailure(error)
    timing.noteCliTimingFailure(caught)
    throw caught
  })
  await assert.rejects(enabled ? timing.withCliTiming(run, (report) => { reports.push(report) }) : run(),
    (value) => value === caught)
  const snapshot = structuredClone(reports)
  release()
  await late
  timing.noteCliTimingFailure(error)
  assert.deepEqual(reports, snapshot, 'Late observations cannot change a closed report.')
  assert.equal(reports.length, enabled ? 1 : 0)
  if (enabled) {
    assert.equal(reports[0]!.reportCount, 1)
    assert.equal(reports[0]!.commands.length, 1)
    assert.equal(reports[0]!.commands[0]!.calls, 1)
    assert.equal(reports[0]!.commands[0]!.outcome, 'error')
    assert.equal(reports[0]!.commands[0]!.droppedFailures, undefined)
    assert.equal(reports[0]!.droppedCalls, 0)
    assert.equal(reports[0]!.droppedSpans, 0)
    assert.equal(reports[0]!.transportTruncated, false)
    assert.deepEqual(normalizeCliTiming(reports[0]), reports[0])
    assert.equal(JSON.stringify(reports).includes('PRIVATE_SENTINEL'), false)
  }
  return { caught, failures: reports[0]?.commands[0]?.failures }
}

const codeOnly = { code: 'VALIDATION_ERROR', stage: 'validation', count: 1 }
const parserFailure = { ...codeOnly, validation: { field: 'arguments', code: 'custom', missing: false } }

test('real argument ParseError projects once before rethrows, double and late observations', async () => {
  const actual = await vi.importActual<typeof import('incur')>('incur')
  assert.equal(Errors.ParseError, actual.Errors.ParseError)
  assert.equal(Errors.ValidationError, actual.Errors.ValidationError)
  assert.equal(Errors.IncurError, actual.Errors.IncurError)
  assert.equal(Cli, actual.Cli)
  assert.equal(middleware, actual.middleware)
  const original = Object.freeze(Object.assign(new Errors.ParseError({ message: 'PRIVATE_SENTINEL' }), {
    extra: 'PRIVATE_SENTINEL', cause: new Error('PRIVATE_SENTINEL'),
  }))
  const descriptors = Object.getOwnPropertyDescriptors(original)
  const projection = vi.mocked(Errors.toErrorEnvelope)
  for (let invocation = 0; invocation < 2; invocation += 1) {
    const result = await observe(original)
    assert.equal(result.caught, original)
    assert.deepEqual(result.failures, [parserFailure])
    assert.equal(projection.mock.calls.length, invocation + 1, 'No projection on fallback catches or reused-error cache.')
    assert.deepEqual(Object.getOwnPropertyDescriptors(original), descriptors)
  }
  assert.equal((await observe(original, false)).caught, original)
  assert.equal(projection.mock.calls.length, 2, 'Timing disabled must not project the error for telemetry.')
})

test.each([
  ['config_missing', true],
  ['config_invalid', false],
  ['config_unavailable', false],
] as const)('%s ParseError stays config evidence, never fabricated argument detail', async (kind, missing) => {
  const original = new Errors.ParseError({ message: 'PRIVATE_SENTINEL', kind })
  const projection = vi.mocked(Errors.toErrorEnvelope)
  const projected = Errors.toErrorEnvelope(original)
  assert.equal(projected.code, 'VALIDATION_ERROR')
  assert.equal(projected.stage, 'validation')
  assert.deepEqual(projected.fieldErrors?.map(({ path, code, missing }) => ({ path, code, missing })),
    [{ path: 'config', code: 'custom', missing }])
  projection.mockClear()
  const result = await observe(original)
  assert.equal(result.caught, original)
  assert.deepEqual(result.failures, [codeOnly])
  assert.equal(projection.mock.calls.length, 1)
  assert.equal(projection.mock.calls[0]?.[0], original)
  assert.equal((await observe(original, false)).caught, original)
  assert.equal(projection.mock.calls.length, 1, 'Timing disabled must not project config evidence.')
})

test('projection and capture failures cannot replace the bridge throw', async () => {
  const original = new Errors.ParseError({ message: 'PRIVATE_SENTINEL' })
  const projection = vi.mocked(Errors.toErrorEnvelope)
  projection.mockImplementationOnce(() => { throw new Error('PRIVATE_SENTINEL') })
  const projectionFailed = await observe(original)
  assert.equal(projection.mock.results[0]?.type, 'throw')
  assert.equal(projectionFailed.caught, original)
  assert.deepEqual(projectionFailed.failures, [codeOnly])
  const capture = vi.mocked(timing.noteCliTimingFailure)
  capture.mockClear()
  capture.mockImplementationOnce(() => { throw new Error('PRIVATE_SENTINEL') })
  const captureFailed = await observe(original)
  assert.equal(capture.mock.results[0]?.type, 'throw')
  assert.equal(captureFailed.caught, original)
  assert.deepEqual(captureFailed.failures, [codeOnly])
  const recovered = await observe(original)
  assert.equal(recovered.caught, original)
  assert.deepEqual(recovered.failures, [parserFailure])
})

test('nonparser errors preserve original handling and are never passed to the parser projection', async () => {
  const projection = vi.mocked(Errors.toErrorEnvelope)
  for (const original of [
    new Errors.IncurError({ code: 'conflict', message: 'PRIVATE_SENTINEL', exitCode: 7 }),
    new Errors.ValidationError({ message: 'PRIVATE_SENTINEL', publicIssues: [
      { path: 'slug', code: 'invalid_type', missing: true },
    ] }),
  ]) {
    assert.equal((await observe(original)).caught, original)
    assert.equal((await observe(original, false)).caught, original)
  }
  // An exact name string alone is not a typed ParseError.
  const original = Object.assign(new Error('PRIVATE_SENTINEL'), { name: 'Incur.ParseError' })
  const expected = new Errors.IncurError(projectVaultCliError(original))
  const result = await observe(original)
  assert.ok(result.caught instanceof Errors.IncurError)
  assert.equal(result.caught.code, expected.code)
  assert.equal(result.caught.message, expected.message)
  assert.deepEqual(result.failures, [codeOnly])
  assert.equal(projection.mock.calls.length, 0)
})

test('parser-set reason reaches only its gated commands; hostile metadata cannot leak, throw or invoke accessors', async () => {
  for (const reason of ['unknown_flag', 'missing_value'] as const) {
    const original = new Errors.ParseError({ message: 'PRIVATE_SENTINEL', reason })
    const visible = { keys: Object.keys(original), json: JSON.stringify(original), envelope: Errors.toErrorEnvelope(original) }
    assert.deepEqual(visible.envelope, Errors.toErrorEnvelope(new Errors.ParseError({ message: 'PRIVATE_SENTINEL' })))
    assert.equal(JSON.stringify(visible).includes(reason), false)
    for (const command of ['knowledge upsert', 'knowledge show', 'wearables day']) {
      const result = await observe(original, true, command)
      assert.equal(result.caught, original)
      assert.deepEqual(result.failures, [{ ...parserFailure, rejection: reason }])
    }
    assert.deepEqual((await observe(original, true, 'event list')).failures, [parserFailure],
      'Other commands never admit the reason.')
    assert.equal((await observe(original, false, 'knowledge upsert')).caught, original)
    assert.deepEqual({ keys: Object.keys(original), json: JSON.stringify(original), envelope: Errors.toErrorEnvelope(original) }, visible)
  }
  let reads = 0
  const withReason = (descriptor: PropertyDescriptor) =>
    Object.defineProperty(new Errors.ParseError({ message: 'PRIVATE_SENTINEL' }), 'reason', descriptor)
  for (const original of [
    new Errors.ParseError({ message: 'PRIVATE_SENTINEL' }),
    new Errors.ParseError({ message: 'PRIVATE_SENTINEL', kind: 'config_invalid' }),
    withReason({ value: 'PRIVATE_SENTINEL' }),
    withReason({ value: 'Unknown_flag' }),
    withReason({ value: new String('unknown_flag') }),
    withReason({ value: { toString: () => 'unknown_flag' } }),
    withReason({ get: () => { reads += 1; return 'unknown_flag' } }),
    Object.setPrototypeOf(new Errors.ParseError({ message: 'PRIVATE_SENTINEL' }),
      Object.create(Errors.ParseError.prototype, { reason: { value: 'unknown_flag' } })),
  ]) {
    const result = await observe(original, true, 'knowledge upsert')
    assert.equal(result.caught, original)
    assert.equal(result.failures?.length, 1)
    assert.equal(result.failures?.[0]?.rejection, undefined)
  }
  assert.equal(reads, 0)
  // Config rejections share VALIDATION_ERROR; even a valid reason stays unclassified.
  for (const kind of ['config_missing', 'config_invalid', 'config_unavailable'] as const) {
    for (const reason of ['unknown_flag', 'missing_value'] as const) {
      const original = new Errors.ParseError({ message: 'SYNTHETIC_PRIVATE', kind, reason })
      const result = await observe(original, true, 'knowledge upsert')
      assert.equal(result.caught, original)
      assert.deepEqual(result.failures, [codeOnly])
    }
    const getter = Object.defineProperty(new Errors.ParseError({ message: 'SYNTHETIC_PRIVATE', kind }), 'reason',
      { get: () => { reads += 1; return 'unknown_flag' } })
    assert.deepEqual((await observe(getter, true, 'knowledge upsert')).failures, [codeOnly])
  }
  assert.equal(reads, 0)
  // Projection still hits the throwing reason trap; native timing rejects the
  // live proxy as unknown without invoking its descriptor traps.
  let descriptorTraps = 0
  let observerTraps = -1
  const nativeTiming = await vi.importActual<typeof timing>('@murphai/runtime-state/node/cli-timing')
  vi.mocked(timing.noteCliTimingFailure).mockImplementationOnce((error) => {
    const before = descriptorTraps
    try { nativeTiming.noteCliTimingFailure(error) }
    finally { observerTraps = descriptorTraps - before }
  })
  const trapped = new Proxy(new Errors.ParseError({ message: 'PRIVATE_SENTINEL', reason: 'unknown_flag' }), {
    getOwnPropertyDescriptor: (target, key) => {
      descriptorTraps += 1
      if (key === 'reason') throw new Error('PRIVATE_SENTINEL')
      return Reflect.getOwnPropertyDescriptor(target, key)
    },
  })
  const trappedResult = await observe(trapped, true, 'knowledge upsert')
  assert.equal(trappedResult.caught, trapped)
  assert.deepEqual(trappedResult.failures, [{ code: 'unknown', stage: 'unknown', count: 1 }])
  assert.ok(descriptorTraps > 0, 'The bridge still exercises the projection trap.')
  assert.equal(observerTraps, 0, 'The native timing observer invokes no proxy descriptor traps.')
  // Name and reason alone are not a typed ParseError.
  const spoof = Object.defineProperty(Object.assign(new Error('PRIVATE_SENTINEL'), { name: 'Incur.ParseError' }),
    'reason', { value: 'unknown_flag' })
  assert.deepEqual((await observe(spoof, true, 'knowledge upsert')).failures, [codeOnly])
})

test('shared filter normalizer class reaches only search query timing; projected errors stay unchanged', async () => {
  const thrown = (run: () => unknown) => { try { run() } catch (error) { return error } assert.fail('expected throw') }
  const filterFailure = { code: 'invalid_option', stage: 'unknown', count: 1 }
  for (const [rejection, error] of [
    ['comma_delimited', thrown(() => normalizeRepeatableFlagOption(['PRIVATE,SENTINEL'], 'tag'))],
    ['unsupported_value', thrown(() => normalizeRepeatableEnumFlagOption(['PRIVATE_SENTINEL'], 'record-type', ['event']))],
  ] as const) {
    assert.ok(error instanceof VaultCliError)
    assert.deepEqual(Object.getOwnPropertyDescriptor(error, 'cliTimingRejection'),
      { value: rejection, writable: false, enumerable: false, configurable: false })
    const bare = new VaultCliError(error.code, error.message)
    const visible = (value: VaultCliError) => ({ keys: Object.keys(value), json: JSON.stringify(value),
      projected: projectVaultCliError(value) })
    assert.deepEqual(visible(error), visible(bare), 'Envelope, serialization and projection are unchanged.')
    const result = await observe(error, true, 'search query')
    assert.ok(result.caught instanceof Errors.IncurError)
    assert.equal(Object.hasOwn(result.caught, 'cliTimingRejection'), false)
    assert.deepEqual(result.failures, [{ ...filterFailure, rejection }])
    assert.deepEqual((await observe(bare, true, 'search query')).caught, result.caught)
    for (const command of ['list', 'event list', 'knowledge show']) {
      assert.deepEqual((await observe(error, true, command)).failures, [filterFailure])
    }
    assert.deepEqual((await observe(error, false, 'search query')).caught, result.caught)
  }
})
