import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'
import { initializeVault } from '@murphai/core'
import { createAssistantModelTarget } from '@murphai/operator-config/assistant-backend'
import { HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID } from '@murphai/operator-config/assistant/target-runtime'
import { buildMurphHostedPermissionProfileTomlLines } from '@murphai/hosted-execution/assistant-permissions'
import { buildHostedCodexBehaviorTomlLines } from '@murphai/hosted-execution/codex-behavior'
import { HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV } from '@murphai/hosted-execution/env'
import { sendAssistantNotificationLocal } from '../src/assistant/notification-turn.ts'
import { appendAssistantTranscriptEntries, resolveAssistantSession } from '../src/assistant/store.ts'
import { stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import { MURPH_WEEKLY_USAGE_OPTIMIZER_AUTOMATION } from '../src/assistant/weekly-usage-optimizer.ts'
import { writeHostedOpenAiMixedModeModelCatalogJson } from './support/codex-model-catalog.ts'
import { prepareScriptedTurnScenario, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'
import { materializeUsageInputBaseline } from './support/usage-input-baseline.ts'

const temporaryPaths: string[] = []
const marker = 'SYNTHETIC_UNRELATED_CHAT_HISTORY'
const behavior = buildHostedCodexBehaviorTomlLines({ exposeSpawnAgentModelOverrides: false })
// The scripted transport already declares identical history persistence.
const behaviorWithoutHistory = behavior.slice(0, behavior.indexOf('[history]'))
afterAll(async () => {
  await stopWarmCodexAppServer()
  await Promise.all(temporaryPaths.map(directory => rm(directory, { recursive: true, force: true })))
})

describe.skipIf(process.env.MURPH_MEASURE_USAGE_ISOLATION_INPUT !== '1')('usage optimizer isolation input', () => {
  it.each(['direct', 'group'] as const)('complete provider request (%s)', async (scope) => {
    const repository = fileURLToPath(new URL('../../../', import.meta.url))
    const base = execFileSync('git', ['rev-parse', '--verify', '--end-of-options', `${process.env.MURPH_USAGE_INPUT_BASE ?? 'HEAD'}^{commit}`], {
      cwd: repository, encoding: 'utf8', timeout: 30_000,
    }).trim()
    const baselineRoot = await materializeUsageInputBaseline(repository, base)
    temporaryPaths.push(baselineRoot)
    const baseline: typeof import('../src/assistant/notification-turn.ts') = await import(pathToFileURL(`${baselineRoot}/src/assistant/notification-turn.ts`).href)
    const baselineCodex: typeof import('../src/assistant-codex.ts') = await import(pathToFileURL(`${baselineRoot}/src/assistant-codex.ts`).href)
    const stub = await startScriptedResponsesStub()
    const captures = []
    try {
      for (const phase of ['base', 'head'] as const) {
        const { turnInput } = await prepareScriptedTurnScenario(stub, temporaryPaths, { model: 'gpt-6.1-sol', modelProvider: HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID, additionalTomlLines: [...behaviorWithoutHistory, ...buildMurphHostedPermissionProfileTomlLines()] })
        const vault = turnInput.workingDirectory
        await initializeVault({ vaultRoot: vault, timezone: 'UTC' })
        const target = createAssistantModelTarget({ ...turnInput, approvalPolicy: 'never', provider: 'codex-cli' })
        assert.ok(target)
        const session = await resolveAssistantSession({ vault, target, channel: 'telegram', threadId: 'synthetic-thread', threadIsDirect: scope === 'direct' })
        await appendAssistantTranscriptEntries(vault, session.session.sessionId, [
          { kind: 'user', text: `${marker}: ${'Synthetic unrelated discussion. '.repeat(120)}` },
          { kind: 'assistant', text: 'The previous discussion is complete.' },
        ])
        const catalog = await writeHostedOpenAiMixedModeModelCatalogJson({ codexCommand: turnInput.codexCommand, directory: turnInput.codexHome })
        const occurrenceAt = '2030-01-10T12:00:00.000Z'
        stub.captureProviderRequestDiagnostics({ completeInput: true })
        stub.queue({ text: '{"kind":"skip","privateSummary":"Synthetic review complete."}' })
        const send = phase === 'base' ? baseline.sendAssistantNotificationLocal : sendAssistantNotificationLocal
        const result = await send({
          instructions: MURPH_WEEKLY_USAGE_OPTIMIZER_AUTOMATION.instructions,
          channel: 'telegram', threadId: 'synthetic-thread', threadIsDirect: scope === 'direct',
          sessionId: session.session.sessionId, workingDirectory: vault, vault,
          executionContext: { hosted: { defaultTarget: target, memberId: 'synthetic-member', userEnvKeys: [] } },
          scheduledInvocationAuthority: { automationId: MURPH_WEEKLY_USAGE_OPTIMIZER_AUTOMATION.automationId, occurrenceAt },
          scheduledOccurrenceAt: occurrenceAt, turnTrigger: 'automation-cron',
          turnEnvironment: { currentWorkingDirectory: vault, env: { ...turnInput.env, [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: catalog } },
        })
        expect(result.response).toBeNull()
        expect(stub.requestCountSinceBaseline()).toBe(1)
        const capture = stub.requestSummariesSinceBaseline()[0]?.completeProviderInput
        assert.ok(capture)
        const containsHistory = capture.json.includes(marker)
        expect(containsHistory).toBe(scope === 'group' || phase === 'base')
        captures.push({ phase, bytes: Buffer.byteLength(capture.json), containsHistory,
          providerFields: Object.keys(JSON.parse(capture.json)).sort(), exclusions: capture.excludedTransportFields })
        await baselineCodex.stopWarmCodexAppServer()
        await stopWarmCodexAppServer()
      }
      const [before, after] = captures
      assert.ok(before && after)
      process.stdout.write(`[usage-isolation-input] ${JSON.stringify({ scope, base, model: 'gpt-6.1-sol', captures,
        deltaBytes: after.bytes - before.bytes, deltaPercent: (after.bytes - before.bytes) / before.bytes * 100,
        tokens: null, tokenDelta: null, tokenLimitation: 'Exact Sol tokenizer unavailable; bytes are not token or billed-cost estimates.',
      })}\n`)
    } finally {
      await baselineCodex.stopWarmCodexAppServer()
      await stopWarmCodexAppServer()
      await stub.close()
    }
  }, 180_000)
})
