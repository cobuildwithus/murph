import assert from 'node:assert/strict'
import { execFileSync, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { stripTypeScriptTypes } from 'node:module'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { setImmediate, setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'vitest'

import { ASSISTANT_USAGE_SCHEMA, parseAssistantUsageRecord } from '@murphai/hosted-execution/assistant-usage'
import { emptyCliTiming, mergeCliTiming, normalizeCliTiming, type CliFailureTiming, type CliTiming } from '@murphai/runtime-state/cli-timing'
import { timeCliDispatch, timeCliPhaseSync, withCliTiming } from '@murphai/runtime-state/node/cli-timing'
import { VAULT_CLI_BATCH_RESULT_SCHEMA } from '@murphai/operator-config/vault-cli-contracts'
import { createCodexCliTimingReceiver } from '../src/assistant-codex/cli-timing.ts'
import { buildAssistantCodexTurnProfileJson } from '../src/assistant/providers/helpers.ts'

const turnId = 'turn-synthetic'
function native(command: string, output = 'PRIVATE_SENTINEL', extra = {}) {
  return { method: 'item/completed', params: { turnId, item: {
    id: 'item-synthetic', type: 'commandExecution', command,
    aggregatedOutput: output, durationMs: 3_032, exitCode: 0, ...extra,
  } } }
}
function usage(profile: unknown) {
  return parseAssistantUsageRecord({ schema: ASSISTANT_USAGE_SCHEMA, provider: 'codex-cli',
    credentialSource: 'platform', inputTokens: 17, outputTokens: 11,
    occurredAt: '2026-09-04T20:36:00.000Z', sessionId: 'synthetic', turnId,
    attemptCount: 1, usageId: `${turnId}.attempt-1`, turnProfileJson: profile })
}
const baseEvents = [
  { method: 'turn/started', params: { turn: { id: turnId } } },
  { method: 'thread/tokenUsage/updated', params: { turnId, threadId: 'thread-synthetic', tokenUsage: {
    last: { inputTokens: 17, cachedInputTokens: 2, outputTokens: 11, reasoningOutputTokens: 0, totalTokens: 28 },
    total: { inputTokens: 17, cachedInputTokens: 2, outputTokens: 11, reasoningOutputTokens: 0, totalTokens: 28 }, modelContextWindow: 258400,
  } } },
]

test('production timing scope -> raw event -> profile -> hosted serialization preserves legacy accounting exactly', async () => {
  let report!: CliTiming
  await withCliTiming(() => timeCliDispatch('goal list', async () => {}), (value) => { report = value })
  for (const command of ['vault-cli goal list --vault /PRIVATE_SENTINEL',
    "/bin/bash -lc 'vault-cli goal list --vault /PRIVATE_SENTINEL'",
    'unsupported-shell PRIVATE_SENTINEL']) {
    const rawEvents = [...baseEvents, native(command)]
    const baseline = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
    const metadata = { method: 'murph/cliTiming', params: { turnId, timing: {
      ...report, argv: ['PRIVATE_SENTINEL'], output: 'PRIVATE_SENTINEL',
    } } }
    const profile = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents, metadata], turnId })!
    const { cliTiming, ...legacy } = profile
    assert.deepEqual(legacy, baseline)
    assert.equal(baseline.requestCount, 1)
    assert.deepEqual(baseline.requests, [{ cachedInput: 2, input: 17, output: 11 }])
    assert.deepEqual(cliTiming, report)
    assert.equal(JSON.stringify(profile).includes('PRIVATE_SENTINEL'), false)
    const parsed = usage(JSON.parse(JSON.stringify(profile)))
    assert.deepEqual(parsed.turnProfileJson, profile)
    assert.equal(parsed.inputTokens, 17)
    assert.equal(parsed.outputTokens, 11)
    assert.deepEqual(usage(baseline).turnProfileJson, baseline)
    // Field-stripped roundtrip through the CURRENT consumer, not mixed-version proof.
    assert.deepEqual(usage(legacy).turnProfileJson, baseline)
  }
})

test('malformed or wrong-turn optional diagnostics do not delete valid legacy profile/token data', () => {
  const rawEvents = [...baseEvents, native('vault-cli memory show')]
  const baseline = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
  for (const timing of [null, 'PRIVATE_SENTINEL', { ...emptyCliTiming(), commands: [{}] },
    { ...emptyCliTiming(), droppedCalls: Number.MAX_SAFE_INTEGER + 1 }]) {
    const produced = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents,
      { method: 'murph/cliTiming', params: { turnId, timing } }], turnId })
    assert.deepEqual(produced, baseline)
    const parsed = usage({ ...baseline, cliTiming: timing })
    assert.deepEqual(parsed.turnProfileJson, baseline)
    assert.equal(parsed.inputTokens, 17)
  }
  assert.deepEqual(buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents,
    { method: 'murph/cliTiming', params: { turnId: 'wrong', timing: emptyCliTiming() } }], turnId }), baseline)
})

test('structured batch child bytes, timings and stop-on-error semantics remain the existing profile contract', async () => {
  let report!: CliTiming
  await withCliTiming(() => timeCliDispatch('batch', async () => {
    await withCliTiming(() => timeCliDispatch('goal list', async () => {}))
    await assert.rejects(withCliTiming(() => timeCliDispatch('memory show', async () => { throw Error('synthetic') })))
  }), (r) => { report = r })
  const batch = { schema: VAULT_CLI_BATCH_RESULT_SCHEMA, vault: '/PRIVATE_SENTINEL',
    count: 2, requested: 3, executed: 2, succeeded: 1, failed: 1, stoppedEarly: true,
    commands: [
      { index: 0, argv: ['goal', 'list'], ok: true, durationMs: 4,
        stdout: '', data: [], outputChars: 2, outputBytes: 2 },
      { index: 1, argv: ['memory', 'show'], ok: false, durationMs: 8,
        stdout: '', outputChars: 0, outputBytes: 0,
        error: { code: 'invalid_option', message: 'PRIVATE_SENTINEL' } },
    ] }
  const rawEvents = [...baseEvents, native('vault-cli batch --PRIVATE_SENTINEL', JSON.stringify(batch))]
  const baseline = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
  const profile = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents,
    { method: 'murph/cliTiming', params: { turnId, timing: report } }], turnId })!
  const { cliTiming, ...legacy } = profile
  assert.deepEqual(legacy, baseline)
  assert.deepEqual(normalizeCliTiming(cliTiming), report)
  assert.deepEqual(usage(profile).turnProfileJson, profile)
  assert.equal((baseline.tools as Array<{ calls: number }>).reduce((n, tool) => n + tool.calls, 0), 2)
  const commands = report.commands
  assert.equal(commands.reduce((sum, c) => sum + c.calls, 0), 2)
  assert.equal(report.batchContainers, 1)
  assert.equal(commands.some((c) => c.command === 'batch'), false)
})

test('old v1 records remain readable with absent or malformed optional timing', () => {
  const old = { schema: 'murph.assistant-turn-profile.v1', modelContextWindow: null,
    requestCount: 0, requests: [], requestsTruncated: false, toolsTruncated: false,
    tools: [{ calls: 1, durationMs: 20, label: 'vault-cli memory show', outputChars: 4 }] }
  assert.deepEqual(usage(old).turnProfileJson, old)
  assert.deepEqual(usage({ ...old, cliTiming: { command: 'PRIVATE_SENTINEL' } }).turnProfileJson, old)
})

// History-dependent rollout proof. No copied legacy parser and no pretending that
// the current consumer is the old one. CI/parent supplies the exact available base.
const compatibilityBase = process.env.MURPH_CLI_TIMING_COMPAT_BASE;
test.skipIf(!compatibilityBase)('actual base consumer accepts the new producer and drops only optional diagnostics', async () => {
  assert.match(compatibilityBase ?? '', /^[a-f0-9]{40}$/u);
  const source = execFileSync('git', [
    'show', `${compatibilityBase}:packages/hosted-execution/src/assistant-usage.ts`,
  ], { encoding: 'utf8', maxBuffer: 1_000_000 });
  // At the declared base this portable owner imports only node:crypto. A future
  // incompatible base must fail here, not accidentally resolve current siblings.
  const baseModule: { parseAssistantUsageRecord: typeof parseAssistantUsageRecord } = await import(
    `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString('base64')}`,
  );
  assert.equal(typeof baseModule.parseAssistantUsageRecord, 'function');
  let report!: CliTiming;
  await withCliTiming(() => timeCliDispatch('goal list', async () => {}), (value) => { report = value; });
  for (const failed of [false, true]) {
    const rawEvents = [...baseEvents, native('vault-cli goal list', 'PRIVATE_SENTINEL', {
      exitCode: failed ? 1 : 0,
    })];
    const legacy = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!;
    const produced = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents,
      { method: 'murph/cliTiming', params: { turnId, timing: report } }], turnId })!;
    for (const cliTiming of [produced.cliTiming, { raw: 'PRIVATE_SENTINEL', ...report }]) {
      const input = { ...usage(legacy), turnProfileJson: { ...produced, cliTiming } };
      const old = baseModule.parseAssistantUsageRecord(JSON.parse(JSON.stringify(input)));
      assert.deepEqual(old, baseModule.parseAssistantUsageRecord({ ...input, turnProfileJson: legacy }));
      assert.deepEqual(old.turnProfileJson, legacy);
      assert.deepEqual(usage(JSON.parse(JSON.stringify(produced))).turnProfileJson, produced);
      assert.equal(JSON.stringify(old).includes('PRIVATE_SENTINEL'), false);
    }
  }
});

test('failure diagnostics cross profile extraction and hosted parsing without changing native accounting or output', async () => {
  let report!: CliTiming
  const failure = Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'invalid_payload', context: { stage: 'validation' } })
  await assert.rejects(withCliTiming(() => timeCliDispatch('experiment session log', async () => { throw failure }),
    (value) => { report = value }), (error) => error === failure)
  const rawEvents = [...baseEvents, native("/bin/bash -lc 'vault-cli experiment session log; true'", 'PRIVATE_SENTINEL')]
  const untouched = structuredClone(rawEvents)
  const baseline = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
  const produced = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents,
    { method: 'murph/cliTiming', params: { turnId, timing: report } }], turnId })!
  const { cliTiming, ...legacy } = produced
  assert.deepEqual(legacy, baseline)
  assert.deepEqual(rawEvents, untouched)
  assert.deepEqual(normalizeCliTiming(cliTiming)?.commands[0]!.failures,
    [{ code: 'invalid_payload', stage: 'validation', count: 1 }])
  assert.deepEqual(usage(JSON.parse(JSON.stringify(produced))).turnProfileJson, produced)
  assert.equal(JSON.stringify(produced).includes('PRIVATE_SENTINEL'), false)
  const malformed = { ...report, commands: [{ ...report.commands[0], failures: 'PRIVATE_SENTINEL' }] }
  const withoutFailures = structuredClone(report)
  delete withoutFailures.commands[0]!.failures
  assert.deepEqual(usage({ ...produced, cliTiming: malformed }).turnProfileJson,
    { ...produced, cliTiming: withoutFailures })
})

test('parser validation survives portable, profile and hosted readback without changing native accounting', async () => {
  for (const [command, field, code, missing] of [
    ['knowledge show', 'arguments', 'custom', false],
    ['knowledge upsert', 'arguments', 'custom', false],
    ['meal edit', 'arguments', 'custom', false],
    ['meal edit', 'id', 'invalid_type', true],
    ['meal edit', 'nutritionProteinGrams', 'too_small', false],
    ['meal edit', 'nutritionConfidence', 'invalid_value', false],
    ['knowledge upsert', 'body', 'invalid_type', true],
  ] as const) {
    let report!: CliTiming
    const error = Object.assign(new Error('PRIVATE_SENTINEL'), {
      code: 'VALIDATION_ERROR', stage: 'validation', fieldErrors: [
        { path: 'PRIVATE_SENTINEL', code: 'custom', missing: false },
        { path: field, code, missing, value: 'PRIVATE_SENTINEL', message: 'PRIVATE_SENTINEL' },
      ], extra: 'PRIVATE_SENTINEL',
    })
    await assert.rejects(withCliTiming(() => timeCliDispatch(command, async () => { throw error }),
      (value) => { report = value }), (caught) => caught === error)
    assert.deepEqual(report.commands[0]!.failures, [{ code: 'VALIDATION_ERROR', stage: 'validation', count: 1,
      validation: { field, code, missing } }])
    const rawEvents = [...baseEvents, native(`vault-cli ${command}`, 'PRIVATE_SENTINEL', { exitCode: 1 })]
    const baseline = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
    const profile = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents,
      { method: 'murph/cliTiming', params: { turnId, timing: { ...report, extra: 'PRIVATE_SENTINEL' } } }], turnId })!
    const { cliTiming, ...legacy } = profile
    assert.deepEqual(legacy, baseline)
    assert.deepEqual(cliTiming, report)
    assert.deepEqual(normalizeCliTiming(cliTiming), report)
    const parsed = usage(JSON.parse(JSON.stringify(profile)))
    assert.deepEqual(parsed.turnProfileJson, profile)
    assert.equal(parsed.inputTokens, 17)
    assert.equal(parsed.outputTokens, 11)
    assert.equal(JSON.stringify(parsed).includes('PRIVATE_SENTINEL'), false)
    const withoutDetail = structuredClone(report)
    delete withoutDetail.commands[0]!.failures![0]!.validation
    // Omitted or malformed optional detail cannot remove valid failure/usage counts.
    const malformed = { ...report, commands: [{ ...report.commands[0], failures: [{
      code: 'VALIDATION_ERROR', stage: 'validation', count: 1,
      validation: { field: 'PRIVATE_SENTINEL', code: 'custom', missing: false },
    }] }] }
    for (const timing of [withoutDetail, malformed]) {
      assert.deepEqual(usage({ ...profile, cliTiming: timing }).turnProfileJson, { ...profile, cliTiming: withoutDetail })
    }
  }
})

// Unlike the older timing rollout above, this base already knows cliTiming.
// Load BOTH actual base owners so this cannot accidentally use today's normalizer.
const failureCompatibilityBase = process.env.MURPH_CLI_FAILURE_COMPAT_BASE

test.skipIf(!failureCompatibilityBase)('actual pre-failure reader preserves command/outcome identities and accounting', async () => {
  assert.match(failureCompatibilityBase ?? '', /^[a-f0-9]{7,40}$/u)
  const source = (file: string) => execFileSync('git', ['show', `${failureCompatibilityBase}:${file}`],
    { encoding: 'utf8', maxBuffer: 1_000_000 })
  const moduleUrl = (text: string) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString('base64')}`
  const oldTimingUrl = moduleUrl(source('packages/runtime-state/src/cli-timing.ts'))
  const oldUsageSource = source('packages/hosted-execution/src/assistant-usage.ts')
  assert.ok(oldUsageSource.includes('"@murphai/runtime-state/cli-timing"'))
  const old: { parseAssistantUsageRecord: typeof parseAssistantUsageRecord } = await import(moduleUrl(
    oldUsageSource.replace('"@murphai/runtime-state/cli-timing"', JSON.stringify(oldTimingUrl))))
  let report!: CliTiming
  await withCliTiming(() => timeCliDispatch('batch', async () => {
    for (const code of ['invalid_payload', 'conflict'] as const) {
      await assert.rejects(withCliTiming(() => timeCliDispatch('experiment session log', async () => {
        throw Object.assign(new Error('PRIVATE_SENTINEL'), { code, context: { stage: 'validation' } })
      })))
    }
    await withCliTiming(() => timeCliDispatch('experiment session log', async () => {}))
    await assert.rejects(withCliTiming(() => timeCliDispatch('knowledge show', async () => {
      throw Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'VALIDATION_ERROR', stage: 'validation',
        fieldErrors: [{ path: 'arguments', code: 'custom', missing: false }] })
    })))
  }), (value) => { report = value })
  const oldReport = { ...report, commands: report.commands.map(({ failures, droppedFailures, ...command }) => command) }
  const legacy = buildAssistantCodexTurnProfileJson({ rawEvents: [...baseEvents, native('vault-cli batch')], turnId })!
  for (const schema of ['murph.assistant-turn-profile.v1', 'murph.assistant-turn-profile.v2']) {
    // Empty tools are valid for either profile version; legacy token accounting
    // remains real, and mixed ok/error timing shares only the old identity keys.
    const profile = { ...legacy, schema, tools: [], cliTiming: report }
    const input = usage(profile)
    const expected = old.parseAssistantUsageRecord({ ...input, turnProfileJson: { ...profile, cliTiming: oldReport } })
    assert.deepEqual(old.parseAssistantUsageRecord(JSON.parse(JSON.stringify(input))), expected)
    assert.deepEqual(expected.turnProfileJson?.cliTiming, oldReport)
    assert.deepEqual(parseAssistantUsageRecord(expected), expected)
    assert.deepEqual(usage(profile).turnProfileJson, profile)
  }
})


test('research source codes survive profile and hosted readback without changing native accounting', async () => {
  const codes = ['research_scout_invalid_batch_payload', 'research_scout_invalid_window', 'research_exa_token_missing'] as const
  let report!: CliTiming
  await withCliTiming(() => timeCliDispatch('batch', async () => {
    for (const code of codes) {
      const error = Object.assign(new Error('PRIVATE_SENTINEL'), { code })
      await assert.rejects(withCliTiming(() => timeCliDispatch('research scout-batch', async () => { throw error })),
        (caught) => caught === error)
    }
    await withCliTiming(() => timeCliDispatch('research scout-batch', async () => {}))
  }), (value) => { report = value })
  const rawEvents = [...baseEvents, native('vault-cli research scout-batch --input @/PRIVATE_SENTINEL',
    'PRIVATE_SENTINEL', { exitCode: 1 })]
  const untouched = structuredClone(rawEvents)
  const baseline = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
  const profile = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents,
    { method: 'murph/cliTiming', params: { turnId, timing: report } }], turnId })!
  const { cliTiming, ...legacy } = profile
  assert.deepEqual(legacy, baseline)
  assert.deepEqual(rawEvents, untouched)
  assert.deepEqual(cliTiming, report)
  assert.deepEqual(report.commands[0]!.failures, codes.map((code) => ({ code, stage: 'unknown', count: 1 })))
  assert.deepEqual(report.commands.map(({ calls, outcome }) => ({ calls, outcome })), [
    { calls: 3, outcome: 'error' }, { calls: 1, outcome: 'ok' },
  ])
  assert.equal(report.commands[1]!.failures, undefined)
  const parsed = usage(JSON.parse(JSON.stringify(profile)))
  assert.deepEqual(parsed.turnProfileJson, profile)
  assert.equal(parsed.inputTokens, 17)
  assert.equal(parsed.outputTokens, 11)
  assert.ok(!JSON.stringify(parsed).includes('PRIVATE_SENTINEL'))
  const future = structuredClone(report)
  const futureInput = { ...future, commands: [{ ...future.commands[0]!, failures: [
    { code: 'PRIVATE_FUTURE_CODE', stage: 'PRIVATE_FUTURE_STAGE', count: 3 },
  ] }, future.commands[1]!] }
  future.commands[0]!.failures = [{ code: 'unknown', stage: 'unknown', count: 3 }]
  assert.deepEqual(usage({ ...profile, cliTiming: futureInput }).turnProfileJson, { ...profile, cliTiming: future })
  delete future.commands[0]!.failures
  assert.deepEqual(usage({ ...profile, cliTiming: future }).turnProfileJson, { ...profile, cliTiming: future })
})

// Bind both hosted readback and its portable normalizer to the actual old base.
const researchCompatibilityBase = process.env.MURPH_CLI_RESEARCH_FAILURE_COMPAT_BASE
test.skipIf(!researchCompatibilityBase)('actual pre-research hosted reader loses only specificity, not counts or tokens', async () => {
  assert.match(researchCompatibilityBase ?? '', /^[a-f0-9]{7,40}$/u)
  const source = (file: string) => execFileSync('git', ['show', `${researchCompatibilityBase}:${file}`],
    { encoding: 'utf8', maxBuffer: 1_000_000 })
  const moduleUrl = (text: string) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString('base64')}`
  const oldTimingUrl = moduleUrl(source('packages/runtime-state/src/cli-timing.ts'))
  const oldTiming: { cliTimingFailureCode: (code: unknown) => string } = await import(oldTimingUrl)
  const oldUsageSource = source('packages/hosted-execution/src/assistant-usage.ts')
  assert.ok(oldUsageSource.includes('"@murphai/runtime-state/cli-timing"'))
  const old: { parseAssistantUsageRecord: typeof parseAssistantUsageRecord } = await import(moduleUrl(
    oldUsageSource.replace('"@murphai/runtime-state/cli-timing"', JSON.stringify(oldTimingUrl))))
  let report!: CliTiming
  await withCliTiming(() => timeCliDispatch('batch', async () => {
    for (const code of ['research_scout_invalid_batch_payload', 'research_scout_invalid_window', 'research_exa_token_missing']) {
      assert.equal(oldTiming.cliTimingFailureCode(code), 'unknown')
      await assert.rejects(withCliTiming(() => timeCliDispatch('research scout-batch', async () => {
        throw Object.assign(new Error('PRIVATE_SENTINEL'), { code })
      })))
    }
    await withCliTiming(() => timeCliDispatch('research scout-batch', async () => {}))
  }), (value) => { report = value })
  const oldReport = structuredClone(report)
  oldReport.commands[0]!.failures = [{ code: 'unknown', stage: 'unknown', count: 3 }]
  const legacy = buildAssistantCodexTurnProfileJson({ rawEvents: baseEvents, turnId })!
  for (const schema of ['murph.assistant-turn-profile.v1', 'murph.assistant-turn-profile.v2']) {
    const profile = { ...legacy, schema, tools: [], cliTiming: report }
    const input = usage(profile)
    const expected = { ...input, turnProfileJson: { ...profile, cliTiming: oldReport } }
    assert.deepEqual(old.parseAssistantUsageRecord(JSON.parse(JSON.stringify(input))), expected)
    assert.deepEqual(parseAssistantUsageRecord(expected), expected)
    assert.equal(expected.inputTokens, 17)
    assert.equal(expected.outputTokens, 11)
    const absent = structuredClone(expected)
    delete absent.turnProfileJson.cliTiming.commands[0]!.failures
    assert.deepEqual(old.parseAssistantUsageRecord(absent), absent)
    assert.deepEqual(parseAssistantUsageRecord(absent), absent)
    assert.ok(!JSON.stringify(expected).includes('PRIVATE_SENTINEL'))
  }
})

async function researchRejectionReport(): Promise<CliTiming> {
  let report!: CliTiming
  await withCliTiming(() => timeCliDispatch('batch', async () => {
    for (const rejection of ['public_concept', 'public_concept', 'unexpected_lane_field', undefined]) {
      const error = Object.assign(new Error('PRIVATE_SENTINEL'), { code: 'research_scout_invalid_batch_payload' })
      if (rejection) Object.defineProperty(error, 'cliTimingRejection', { value: rejection })
      await assert.rejects(withCliTiming(() => timeCliDispatch('research scout-batch', async () => { throw error })),
        (caught) => caught === error)
    }
    await withCliTiming(() => timeCliDispatch('research scout-batch', async () => {}))
  }), (value) => { report = value })
  return report
}

test('research batch rejection category survives profile and hosted readback; native accounting is unchanged', async () => {
  const report = await researchRejectionReport()
  const code = 'research_scout_invalid_batch_payload'
  assert.deepEqual(report.commands[0]!.failures, [
    { code, stage: 'unknown', count: 2, rejection: 'public_concept' },
    { code, stage: 'unknown', count: 1, rejection: 'unexpected_lane_field' },
    { code, stage: 'unknown', count: 1 },
  ])
  assert.equal(report.commands[1]!.failures, undefined)
  const rawEvents = [...baseEvents, native('vault-cli research scout-batch --input @/PRIVATE_SENTINEL',
    'PRIVATE_SENTINEL', { exitCode: 1 })]
  const baseline = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
  const profile = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents,
    { method: 'murph/cliTiming', params: { turnId, timing: report } }], turnId })!
  const { cliTiming, ...legacy } = profile
  assert.deepEqual(legacy, baseline)
  assert.deepEqual(cliTiming, report)
  const parsed = usage(JSON.parse(JSON.stringify(profile)))
  assert.deepEqual(parsed.turnProfileJson, profile)
  assert.equal(parsed.inputTokens, 17)
  assert.ok(!JSON.stringify(parsed).includes('PRIVATE_SENTINEL'))
  // Unknown future categories drop only the detail, never the observation.
  const future = structuredClone(report)
  future.commands[0]!.failures![0] = { ...future.commands[0]!.failures![0]!, rejection: 'PRIVATE_FUTURE' as 'envelope' }
  const expected = structuredClone(report)
  expected.commands[0]!.failures = [
    { code, stage: 'unknown', count: 3 },
    { code, stage: 'unknown', count: 1, rejection: 'unexpected_lane_field' },
  ]
  assert.deepEqual(usage({ ...profile, cliTiming: future }).turnProfileJson, { ...profile, cliTiming: expected })
})

const researchRejectionCompatibilityBase = process.env.MURPH_CLI_RESEARCH_REJECTION_COMPAT_BASE
test.skipIf(!researchRejectionCompatibilityBase)('actual pre-rejection hosted reader drops only the category', async () => {
  assert.match(researchRejectionCompatibilityBase ?? '', /^[a-f0-9]{40}$/u)
  const source = (file: string) => execFileSync('git', ['show', `${researchRejectionCompatibilityBase}:${file}`],
    { encoding: 'utf8', maxBuffer: 1_000_000 })
  const moduleUrl = (text: string) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString('base64')}`
  const oldTimingUrl = moduleUrl(source('packages/runtime-state/src/cli-timing.ts'))
  const oldUsageSource = source('packages/hosted-execution/src/assistant-usage.ts')
  assert.ok(oldUsageSource.includes('"@murphai/runtime-state/cli-timing"'))
  const old: { parseAssistantUsageRecord: typeof parseAssistantUsageRecord } = await import(moduleUrl(
    oldUsageSource.replace('"@murphai/runtime-state/cli-timing"', JSON.stringify(oldTimingUrl))))
  const report = await researchRejectionReport()
  const oldReport = structuredClone(report)
  oldReport.commands[0]!.failures = [{ code: 'research_scout_invalid_batch_payload', stage: 'unknown', count: 4 }]
  const legacy = buildAssistantCodexTurnProfileJson({ rawEvents: baseEvents, turnId })!
  for (const schema of ['murph.assistant-turn-profile.v1', 'murph.assistant-turn-profile.v2']) {
    const profile = { ...legacy, schema, tools: [], cliTiming: report }
    const input = usage(profile)
    const expected = { ...input, turnProfileJson: { ...profile, cliTiming: oldReport } }
    assert.deepEqual(old.parseAssistantUsageRecord(JSON.parse(JSON.stringify(input))), expected)
    assert.deepEqual(parseAssistantUsageRecord(expected), expected)
    assert.equal(expected.inputTokens, 17)
    assert.equal(expected.outputTokens, 11)
  }
})

for (const [label, compatibilityBase, command, phases] of [
  ['Patterns', process.env.MURPH_PATTERN_TIMING_COMPAT_BASE, 'wearables patterns',
    ['query-entity-read', 'query-wearable-compose', 'query-metric-read', 'query-pattern-report']],
  ['write/load', process.env.MURPH_CLI_WAIT_LOAD_PHASE_COMPAT_BASE, 'meal add',
    ['canonical-write-wait', 'importers-runtime-load']],
  ['event-read', process.env.MURPH_CLI_EVENT_READ_PHASE_COMPAT_BASE, 'meal show',
    ['event-core-load', 'event-owner-candidates', 'event-owner-revisions']],
] as const) test.skipIf(!compatibilityBase)(`${label} stages survive new consumers while old consumers preserve legacy usage`, async () => {
  assert.match(compatibilityBase ?? '', /^[a-f0-9]{40}$/u)
  if (label === 'event-read') assert.equal(compatibilityBase, '4ec40920fca1872c8324d9325c23a9e50ba39754')
  const source = (file: string) => execFileSync('git', ['show', `${compatibilityBase}:${file}`],
    { encoding: 'utf8', maxBuffer: 1_000_000 })
  const moduleUrl = (text: string) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString('base64')}`
  const oldTimingUrl = moduleUrl(source('packages/runtime-state/src/cli-timing.ts'))
  const oldTiming: { normalizeCliTiming: typeof normalizeCliTiming } = await import(oldTimingUrl)
  const oldUsageSource = source('packages/hosted-execution/src/assistant-usage.ts')
  assert.ok(oldUsageSource.includes('"@murphai/runtime-state/cli-timing"'))
  const old: { parseAssistantUsageRecord: typeof parseAssistantUsageRecord } = await import(moduleUrl(
    oldUsageSource.replace('"@murphai/runtime-state/cli-timing"', JSON.stringify(oldTimingUrl))))
  let report!: CliTiming
  await withCliTiming(() => timeCliDispatch(command, async () => {
    for (const phase of phases) {
      timeCliPhaseSync(phase, () => undefined)
    }
  }), value => { report = value })
  const legacy = buildAssistantCodexTurnProfileJson({ rawEvents: [...baseEvents, native(`vault-cli ${command}`)], turnId })!
  const profile = { ...legacy, cliTiming: report }
  const input = usage(profile)
  assert.deepEqual(input.turnProfileJson, profile)
  assert.equal(oldTiming.normalizeCliTiming(report), null)
  assert.deepEqual(old.parseAssistantUsageRecord(input), { ...input, turnProfileJson: legacy })
  const oldReport = structuredClone(report)
  oldReport.commands[0]!.phases = oldReport.commands[0]!.phases.filter(phase => !phases.some(name => name === phase.phase))
  assert.deepEqual(oldTiming.normalizeCliTiming(oldReport), oldReport)
  assert.deepEqual(normalizeCliTiming(oldReport), oldReport)
  const oldInput = usage({ ...legacy, cliTiming: oldReport })
  assert.deepEqual(old.parseAssistantUsageRecord(oldInput), oldInput)
  assert.deepEqual(parseAssistantUsageRecord(oldInput), oldInput)
})

async function exerciseMealFailures(batch: boolean, publish?: (report: CliTiming) => void) {
  const run = async () => {
    for (const [field, code, missing] of [
      ['id', 'invalid_type', true], ['nutritionProteinGrams', 'too_small', false],
      ['nutritionConfidence', 'invalid_value', false],
    ] as const) {
      const original = Object.assign(new Error('PRIVATE_SENTINEL'), { name: 'Incur.ValidationError',
        publicIssues: [{ path: field, code, missing, message: 'PRIVATE_SENTINEL' }] })
      await assert.rejects(withCliTiming(() => timeCliDispatch('meal edit', async () => { throw original }), publish),
        caught => caught === original)
      await delay(10)
    }
    for (const code of ['invalid_operation', 'unknown']) {
      const original = Object.assign(new Error('PRIVATE_SENTINEL'), { code })
      await assert.rejects(withCliTiming(() => timeCliDispatch('meal remove-photo', async () => { throw original }), publish),
        caught => caught === original)
      await delay(10)
    }
    for (const command of ['meal edit', 'meal remove-photo']) {
      await withCliTiming(() => timeCliDispatch(command, async () => {}), publish)
      await delay(10)
    }
  }
  if (batch) await withCliTiming(() => timeCliDispatch('batch', run), publish)
  else await run()
}

test('meal original failures cross real UDP, receiver, profile and hosted admission without native accounting changes', async () => {
  const previous = process.env.MURPH_CLI_TIMING_ENDPOINT
  for (const batch of [false, true]) {
    const receiver = createCodexCliTimingReceiver()
    try {
      const setting = receiver.launchArgs[1]!
      assert.ok(setting)
      process.env.MURPH_CLI_TIMING_ENDPOINT = JSON.parse(setting.slice(setting.indexOf('=') + 1))
      await delay(10)
      const finish = receiver.begin()
      await exerciseMealFailures(batch)
      await delay(10)
      const event = finish(turnId) as { method: string; params: { timing: unknown } }
      assert.ok(event)
      assert.equal(event.method, 'murph/cliTiming')
      const report = normalizeCliTiming(event.params.timing)
      assert.ok(report)
      assert.equal(report.reportCount, batch ? 1 : 7)
      assert.equal(report.batchContainers, batch ? 1 : 0)
      assert.equal(report.commands.reduce((sum, command) => sum + command.calls, 0), 7)
      assert.equal(report.droppedCalls, 0)
      assert.equal(report.droppedSpans, 0)
      assert.equal(report.outOfWindowReports, 0)
      assert.equal(report.transportTruncated, false)
      assert.deepEqual(report.commands[0]!.failures, [
        { code: 'VALIDATION_ERROR', stage: 'validation', count: 1, validation: { field: 'id', code: 'invalid_type', missing: true } },
        { code: 'VALIDATION_ERROR', stage: 'validation', count: 1, validation: { field: 'nutritionProteinGrams', code: 'too_small', missing: false } },
        { code: 'VALIDATION_ERROR', stage: 'validation', count: 1, validation: { field: 'nutritionConfidence', code: 'invalid_value', missing: false } },
      ])
      assert.deepEqual(report.commands[1]!.failures, [
        { code: 'invalid_operation', stage: 'unknown', count: 1 }, { code: 'unknown', stage: 'unknown', count: 1 },
      ])
      for (const command of report.commands.filter(command => command.outcome === 'ok')) {
        assert.equal(command.failures, undefined)
      }
      const rawEvents = [...baseEvents, native('vault-cli batch', 'PRIVATE_SENTINEL')]
      const baseline = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
      const profile = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents, event], turnId })!
      const { cliTiming, ...legacy } = profile
      assert.deepEqual(legacy, baseline)
      assert.deepEqual(cliTiming, report)
      const parsed = usage(JSON.parse(JSON.stringify(profile)))
      assert.deepEqual(parsed.turnProfileJson, profile)
      assert.equal(parsed.inputTokens, 17)
      assert.equal(parsed.outputTokens, 11)
      assert.equal(JSON.stringify(parsed).includes('PRIVATE_SENTINEL'), false)
    } finally {
      receiver.close()
      if (previous === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT
      else process.env.MURPH_CLI_TIMING_ENDPOINT = previous
    }
  }
})

const mealAttributionCompatibilityBase = process.env.MURPH_CLI_MEAL_FAILURE_ATTRIBUTION_COMPAT_BASE
test.skipIf(!mealAttributionCompatibilityBase)('actual pre-meal-attribution hosted reader preserves timing, profiles and token accounting', async () => {
  assert.match(mealAttributionCompatibilityBase ?? '', /^[a-f0-9]{40}$/u)
  const source = (file: string) => execFileSync('git', ['show', `${mealAttributionCompatibilityBase}:${file}`],
    { encoding: 'utf8', maxBuffer: 1_000_000 })
  const moduleUrl = (text: string) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString('base64')}`
  const oldTimingUrl = moduleUrl(source('packages/runtime-state/src/cli-timing.ts'))
  const oldUsageSource = source('packages/hosted-execution/src/assistant-usage.ts')
  assert.ok(oldUsageSource.includes('"@murphai/runtime-state/cli-timing"'))
  const old: { parseAssistantUsageRecord: typeof parseAssistantUsageRecord } = await import(moduleUrl(
    oldUsageSource.replace('"@murphai/runtime-state/cli-timing"', JSON.stringify(oldTimingUrl))))
  let report!: CliTiming
  await exerciseMealFailures(true, value => { report = value })
  const oldReport = structuredClone(report)
  oldReport.commands[0]!.failures = [{ code: 'VALIDATION_ERROR', stage: 'validation', count: 3 }]
  oldReport.commands[1]!.failures = [{ code: 'unknown', stage: 'unknown', count: 2 }]
  const legacy = buildAssistantCodexTurnProfileJson({ rawEvents: baseEvents, turnId })!
  for (const schema of ['murph.assistant-turn-profile.v1', 'murph.assistant-turn-profile.v2']) {
    const profile = { ...legacy, schema, tools: [], cliTiming: report }
    const input = usage(profile)
    const expected = { ...input, turnProfileJson: { ...profile, cliTiming: oldReport } }
    assert.deepEqual(old.parseAssistantUsageRecord(JSON.parse(JSON.stringify(input))), expected)
    assert.deepEqual(parseAssistantUsageRecord(expected), expected)
    assert.equal(expected.inputTokens, 17)
    assert.equal(expected.outputTokens, 11)
    const absent = structuredClone(expected)
    for (const command of absent.turnProfileJson.cliTiming.commands) delete command.failures
    assert.deepEqual(old.parseAssistantUsageRecord(absent), absent)
    assert.deepEqual(parseAssistantUsageRecord(absent), absent)
  }
})

const sourceCauseCases: Array<{ command: string; stage: CliFailureTiming['stage'];
  sourceCause: NonNullable<CliFailureTiming['sourceCause']> }> = [
  { command: 'meal edit', stage: 'unknown', sourceCause: { code: 'contract_invalid' } },
  { command: 'meal edit', stage: 'unknown', sourceCause: { code: 'vault_error' } },
  { command: 'meal remove-photo', stage: 'unknown', sourceCause: {
    code: 'vault_error', vaultCode: 'MEAL_PHOTO_RETENTION_PRECONDITION_FAILED',
  } },
  { command: 'meal remove-photo', stage: 'unknown', sourceCause: {
    code: 'vault_error', vaultCode: 'MEAL_PHOTO_RETENTION_MANIFEST_INVALID',
  } },
  { command: 'food search-labels-batch', stage: 'response', sourceCause: { code: 'food_labels_api_response_failed' } },
  { command: 'food search-labels-batch', stage: 'response', sourceCause: { code: 'food_labels_api_invalid_response' } },
  { command: 'research scout-batch', stage: 'response', sourceCause: { code: 'research_exa_request_rejected' } },
  { command: 'research scout-batch', stage: 'response', sourceCause: { code: 'research_exa_invalid_response' } },
]

// Real CLI origin/bridge coverage lives in the CLI owner. Here original typed
// error shapes exercise the production timing scope and its actual UDP peer.
async function exerciseSourceCauseFailures(batch: boolean, publish?: (report: CliTiming) => void) {
  const run = async () => {
    for (const { command, stage, sourceCause } of [...sourceCauseCases, sourceCauseCases[0]!]) {
      const original = Object.assign(new Error('PRIVATE_SENTINEL'), {
        code: sourceCause.code,
        context: { stage, ...(sourceCause.vaultCode ? { vaultCode: sourceCause.vaultCode } : {}),
          value: 'PRIVATE_SENTINEL' },
        cause: { code: 'PRIVATE_SENTINEL' },
      })
      const visible = JSON.stringify(original)
      await assert.rejects(withCliTiming(() => timeCliDispatch(command, async () => { throw original }), publish),
        caught => caught === original)
      assert.equal(JSON.stringify(original), visible)
      assert.equal(Object.hasOwn(original, 'sourceCause'), false)
      await delay(10)
    }
    const unknown = new Error('PRIVATE_SENTINEL')
    await assert.rejects(withCliTiming(() => timeCliDispatch('meal edit', async () => { throw unknown }), publish),
      caught => caught === unknown)
    await delay(10)
    await withCliTiming(() => timeCliDispatch('meal edit', async () => {}), publish)
    await delay(10)
  }
  if (batch) await withCliTiming(() => timeCliDispatch('batch', run), publish)
  else await run()
}

test('source causes cross real UDP, receiver, profile and hosted admission for direct and batch calls', async () => {
  const previous = process.env.MURPH_CLI_TIMING_ENDPOINT
  for (const batch of [false, true]) {
    const receiver = createCodexCliTimingReceiver()
    try {
      const setting = receiver.launchArgs[1]!
      assert.ok(setting)
      process.env.MURPH_CLI_TIMING_ENDPOINT = JSON.parse(setting.slice(setting.indexOf('=') + 1))
      await delay(10)
      const finish = receiver.begin()
      await exerciseSourceCauseFailures(batch)
      await delay(10)
      const event = finish(turnId) as { method: string; params: { timing: unknown } }
      assert.ok(event)
      assert.equal(event.method, 'murph/cliTiming')
      const report = normalizeCliTiming(event.params.timing)
      assert.ok(report)
      assert.equal(report.reportCount, batch ? 1 : 11)
      assert.equal(report.batchContainers, batch ? 1 : 0)
      assert.deepEqual(report.commands.map(({ command, outcome, calls }) => ({ command, outcome, calls })), [
        { command: 'meal edit', outcome: 'error', calls: 4 },
        { command: 'meal remove-photo', outcome: 'error', calls: 2 },
        { command: 'food search-labels-batch', outcome: 'error', calls: 2 },
        { command: 'research scout-batch', outcome: 'error', calls: 2 },
        { command: 'meal edit', outcome: 'ok', calls: 1 },
      ])
      for (const command of report.commands.filter(command => command.outcome === 'error')) {
        const failures: CliFailureTiming[] = sourceCauseCases.filter(row => row.command === command.command).map(row => ({
          code: 'unknown', stage: row.stage, count: row.sourceCause.code === 'contract_invalid' ? 2 : 1,
          sourceCause: row.sourceCause,
        }))
        if (command.command === 'meal edit') failures.push({ code: 'unknown', stage: 'unknown', count: 1 })
        assert.deepEqual(command.failures, failures)
        assert.equal(command.droppedFailures, undefined)
      }
      assert.equal(report.commands.at(-1)!.failures, undefined)
      assert.equal(report.droppedCalls, 0)
      assert.equal(report.droppedSpans, 0)
      assert.equal(report.outOfWindowReports, 0)
      assert.equal(report.transportTruncated, false)
      const rawEvents = [...baseEvents, native('vault-cli batch', 'PRIVATE_SENTINEL')]
      const untouched = structuredClone(rawEvents)
      const baseline = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
      const profile = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents, event], turnId })!
      const { cliTiming, ...legacy } = profile
      assert.deepEqual(legacy, baseline, 'Native command accounting is not additive with CLI observations.')
      assert.deepEqual(rawEvents, untouched)
      assert.deepEqual(cliTiming, report)
      const parsed = usage(JSON.parse(JSON.stringify(profile)))
      assert.deepEqual(parsed.turnProfileJson, profile)
      assert.equal(parsed.inputTokens, 17)
      assert.equal(parsed.outputTokens, 11)
      assert.equal(JSON.stringify(parsed).includes('PRIVATE_SENTINEL'), false)
    } finally {
      receiver.close()
      if (previous === undefined) delete process.env.MURPH_CLI_TIMING_ENDPOINT
      else process.env.MURPH_CLI_TIMING_ENDPOINT = previous
    }
  }
})

test('real food CLI failures cross the bridge, production UDP receiver, profile and hosted admission', async () => {
  const directory = await mkdtemp(path.join(tmpdir(), 'cli-source-cause-PRIVATE_SENTINEL-'))
  const sentinel = path.join(directory, 'PRIVATE_SENTINEL.txt')
  await writeFile(sentinel, 'PRIVATE_SENTINEL canonical bytes')
  const root = fileURLToPath(new URL('../../..', import.meta.url))
  const childFile = fileURLToPath(new URL('../../cli/test/fixtures/cli-timing-child.ts', import.meta.url))
  const tsx = import.meta.resolve('tsx')
  const args = ['food', 'search-labels-batch', '--query', 'synthetic oats']
  const codes = ['food_labels_api_response_failed', 'food_labels_api_invalid_response'] as const
  // Reuse the real terminating CLI child, including its exact provider-call
  // assertion. No source imports across packages and no live fetch fallback.
  const invoke = async (argv: string[], response: string, requests: number, endpoint?: string) => {
    const child = spawn(process.execPath, ['--no-warnings', '--import', tsx, childFile, String(requests), ...argv], {
      cwd: directory,
      env: {
        HOME: directory, USERPROFILE: directory, XDG_CONFIG_HOME: directory,
        TMPDIR: directory, TMP: directory, TEMP: directory,
        TSX_TSCONFIG_PATH: path.join(root, 'tsconfig.base.json'), TSX_DISABLE_CACHE: '1',
        MURPH_HOSTED_RUNTIME_PROCESS: '1', MURPH_DATA_API_KEY: 'SYNTHETIC_SECRET_TOKEN',
        MURPH_TEST_FOOD_RESPONSE: response,
        ...(endpoint ? { MURPH_CLI_TIMING_ENDPOINT: endpoint } : {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'], timeout: 30_000,
    })
    let stdout = '', stderr = ''
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    const [code, signal] = await once(child, 'close') as [number | null, NodeJS.Signals | null]
    await setImmediate()
    assert.equal(signal, null)
    assert.equal(stderr, '', 'Includes the child assertion of exactly the expected fake provider calls.')
    assert.deepEqual(await readdir(directory), [path.basename(sentinel)], 'No vault, cwd or config writes.')
    assert.equal(await readFile(sentinel, 'utf8'), 'PRIVATE_SENTINEL canonical bytes')
    return { stdout, stderr, code, signal }
  }
  try {
    for (const batch of [false, true]) {
      const receiver = createCodexCliTimingReceiver()
      try {
        const setting = receiver.launchArgs[1]!
        assert.ok(setting)
        const endpoint: string = JSON.parse(setting.slice(setting.indexOf('=') + 1))
        const scenarios = batch ? [{ response: 'mixed', requests: 2,
          argv: ['batch', '--command', JSON.stringify(args), '--command', JSON.stringify(args)] }]
          : ['http', 'schema'].map(response => ({ response, requests: 1, argv: args }))
        const baseline = []
        for (const scenario of scenarios) {
          baseline.push(await invoke([...scenario.argv, '--vault', directory, '--format', 'json'],
            scenario.response, scenario.requests))
        }
        // The untimed subprocesses also yield while the real receiver binds.
        const finish = receiver.begin()
        const completions = []
        for (const [index, scenario] of scenarios.entries()) {
          const result = await invoke([...scenario.argv, '--vault', directory, '--format', 'json'],
            scenario.response, scenario.requests, endpoint)
          assert.deepEqual(result, baseline[index], 'Timing preserves complete stdout, stderr and actual process exits.')
          assert.equal(result.code, batch ? 0 : 1)
          const output = JSON.parse(result.stdout)
          if (batch) {
            assert.equal(output.executed, 2)
            assert.equal(output.failed, 2)
            assert.deepEqual(output.commands.map((command: { error: { code: string } }) => command.error.code), codes)
          } else assert.equal(output.code, codes[index])
          assert.equal(result.stdout.includes('sourceCause'), false)
          completions.push(native(batch ? 'vault-cli batch' : 'vault-cli food search-labels-batch', result.stdout,
            { id: `item-synthetic-food-${index}`, exitCode: result.code }))
        }
        const event = finish(turnId) as { method: string; params: { timing: unknown } }
        assert.ok(event)
        const report = normalizeCliTiming(event.params.timing)
        assert.ok(report)
        assert.equal(report.reportCount, batch ? 1 : 2)
        assert.equal(report.batchContainers, batch ? 1 : 0)
        assert.equal(report.commands.length, 1)
        assert.equal(report.commands[0]!.command, 'food search-labels-batch')
        assert.equal(report.commands[0]!.outcome, 'error')
        assert.equal(report.commands[0]!.calls, 2)
        assert.deepEqual(report.commands[0]!.failures, codes.map(code => ({
          code: 'unknown', stage: 'response', count: 1, sourceCause: { code },
        })))
        assert.equal(report.commands[0]!.droppedFailures, undefined)
        assert.equal(report.droppedCalls, 0)
        assert.equal(report.droppedSpans, 0)
        assert.equal(report.outOfWindowReports, 0)
        assert.equal(report.transportTruncated, false)
        const rawEvents = [...baseEvents, ...completions]
        const nativeProfile = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
        const profile = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents, event], turnId })!
        const { cliTiming, ...legacy } = profile
        assert.deepEqual(legacy, nativeProfile)
        assert.deepEqual(cliTiming, report)
        const admitted = usage(JSON.parse(JSON.stringify(profile)))
        assert.deepEqual(admitted.turnProfileJson, profile)
        assert.equal(admitted.inputTokens, 17)
        assert.equal(admitted.outputTokens, 11)
        for (const privateValue of ['PRIVATE_SENTINEL', 'SYNTHETIC_SECRET_TOKEN', 'synthetic oats', 'synthetic-oats']) {
          assert.equal(JSON.stringify(admitted).includes(privateValue), false)
        }
      } finally { receiver.close() }
    }
  } finally { await rm(directory, { recursive: true, force: true }) }
}, 180_000)

test('malformed source causes and legacy reports preserve failure, timing and usage accounting', async () => {
  let report!: CliTiming
  await exerciseSourceCauseFailures(true, value => { report = value })
  const rawEvents = [...baseEvents, native('vault-cli batch')]
  const baseline = buildAssistantCodexTurnProfileJson({ rawEvents, turnId })!
  const profile = { ...baseline, cliTiming: report }
  const expected = structuredClone(report)
  expected.commands[0]!.failures = [
    { code: 'unknown', stage: 'unknown', count: 3 },
    { code: 'unknown', stage: 'unknown', count: 1, sourceCause: { code: 'vault_error' } },
  ]
  let reads = 0
  const malformed: unknown[] = [null, ['contract_invalid'], { code: 'PRIVATE_SENTINEL' },
    Object.create({ code: 'contract_invalid' }),
    { get code() { reads += 1; return 'contract_invalid' } },
    new Proxy({}, { getOwnPropertyDescriptor() { throw new Error('PRIVATE_SENTINEL') } }),
  ]
  for (const sourceCause of malformed) {
    const timing = { ...report, commands: report.commands.map((command, index) => index === 0 ? {
      ...command, failures: command.failures!.map((failure, variant) => variant === 0 ? { ...failure, sourceCause } : failure),
    } : command) }
    const produced = buildAssistantCodexTurnProfileJson({ rawEvents: [...rawEvents,
      { method: 'murph/cliTiming', params: { turnId, timing } }], turnId })!
    assert.deepEqual(produced, { ...baseline, cliTiming: expected })
    const parsed = usage({ ...profile, cliTiming: timing })
    assert.deepEqual(parsed.turnProfileJson, produced)
    assert.equal(parsed.inputTokens, 17)
    assert.equal(parsed.outputTokens, 11)
    assert.equal(JSON.stringify(parsed).includes('PRIVATE_SENTINEL'), false)
  }
  assert.equal(reads, 0)
  const mixed = structuredClone(report)
  // One old failure-aware call and one call without failure coverage. Neither
  // can acquire a source cause from a newer neighboring observation.
  mergeCliTiming(mixed, { ...emptyCliTiming(), reportCount: 1, commands: [{
    command: 'meal edit', outcome: 'error', calls: 2, phases: [],
    failures: [{ code: 'unknown', stage: 'unknown', count: 1 }],
  }] })
  assert.equal(mixed.reportCount, 2)
  assert.equal(mixed.commands[0]!.calls, 6)
  assert.deepEqual(mixed.commands[0]!.failures, [
    { code: 'unknown', stage: 'unknown', count: 2, sourceCause: { code: 'contract_invalid' } },
    { code: 'unknown', stage: 'unknown', count: 1, sourceCause: { code: 'vault_error' } },
    { code: 'unknown', stage: 'unknown', count: 2 },
  ])
  assert.deepEqual(usage({ ...profile, cliTiming: mixed }).turnProfileJson, { ...profile, cliTiming: mixed })
})

// Bind both actual base readers; a current-reader roundtrip is not compatibility proof.
const sourceCauseCompatibilityBase = process.env.MURPH_CLI_SOURCE_CAUSE_COMPAT_BASE
test.skipIf(!sourceCauseCompatibilityBase)('actual base hosted reader drops only source cause and retains legacy failures', async () => {
  assert.equal(sourceCauseCompatibilityBase, '704630e3fda169456458db4c7a0f50121be120ee')
  const source = (file: string) => execFileSync('git', ['show', `${sourceCauseCompatibilityBase}:${file}`],
    { encoding: 'utf8', maxBuffer: 1_000_000 })
  const moduleUrl = (text: string) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(text)).toString('base64')}`
  const oldTimingUrl = moduleUrl(source('packages/runtime-state/src/cli-timing.ts'))
  const oldTiming: { normalizeCliTiming: typeof normalizeCliTiming; mergeCliTiming: typeof mergeCliTiming } = await import(oldTimingUrl)
  const oldUsageSource = source('packages/hosted-execution/src/assistant-usage.ts')
  assert.ok(oldUsageSource.includes('"@murphai/runtime-state/cli-timing"'))
  const old: { parseAssistantUsageRecord: typeof parseAssistantUsageRecord } = await import(moduleUrl(
    oldUsageSource.replace('"@murphai/runtime-state/cli-timing"', JSON.stringify(oldTimingUrl))))
  let report!: CliTiming
  await exerciseSourceCauseFailures(true, value => { report = value })
  const oldReport = structuredClone(report)
  for (const command of oldReport.commands.filter(command => command.outcome === 'error')) {
    command.failures = [{ code: 'unknown', stage: command.failures![0]!.stage, count: command.calls }]
  }
  assert.deepEqual(oldTiming.normalizeCliTiming(report), oldReport)
  assert.deepEqual(normalizeCliTiming(oldReport), oldReport, 'New readers never backfill an old cause.')
  const mixed = structuredClone(report)
  mergeCliTiming(mixed, oldReport)
  const oldMixed = structuredClone(oldReport)
  oldTiming.mergeCliTiming(oldMixed, oldReport)
  assert.deepEqual(oldTiming.normalizeCliTiming(mixed), oldMixed)
  const baseline = buildAssistantCodexTurnProfileJson({ rawEvents: baseEvents, turnId })!
  for (const schema of ['murph.assistant-turn-profile.v1', 'murph.assistant-turn-profile.v2']) {
    for (const [timing, expectedTiming] of [[report, oldReport], [mixed, oldMixed]]) {
      const profile = { ...baseline, schema, tools: [], cliTiming: timing }
      const input = usage(profile)
      const expected = { ...input, turnProfileJson: { ...profile, cliTiming: expectedTiming } }
      assert.deepEqual(old.parseAssistantUsageRecord(JSON.parse(JSON.stringify(input))), expected)
      assert.deepEqual(parseAssistantUsageRecord(expected), expected)
      assert.equal(expected.inputTokens, 17)
      assert.equal(expected.outputTokens, 11)
      assert.equal(JSON.stringify(expected).includes('PRIVATE_SENTINEL'), false)
    }
  }
})
