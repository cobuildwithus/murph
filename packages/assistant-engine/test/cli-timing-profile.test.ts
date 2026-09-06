import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { stripTypeScriptTypes } from 'node:module'
import { test } from 'vitest'

import { ASSISTANT_USAGE_SCHEMA, parseAssistantUsageRecord } from '@murphai/hosted-execution/assistant-usage'
import { emptyCliTiming, normalizeCliTiming, type CliTiming } from '@murphai/runtime-state/cli-timing'
import { timeCliDispatch, withCliTiming } from '@murphai/runtime-state/node/cli-timing'
import { VAULT_CLI_BATCH_RESULT_SCHEMA } from '@murphai/operator-config/vault-cli-contracts'
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
