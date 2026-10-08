import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

import { buildMurphMemberReadPermissionProfileTomlLines } from '@murphai/hosted-execution/assistant-permissions'
import { HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV } from '@murphai/hosted-execution/env'
import { HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID } from '@murphai/operator-config/assistant/target-runtime'
import { afterAll, describe, expect, it } from 'vitest'

import { stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import { classifyAssistantReaction } from '../src/assistant/reaction-routing.ts'
import { writeHostedOpenAiMixedModeModelCatalogJson } from './support/codex-model-catalog.ts'
import { prepareScriptedTurnScenario, readRecord, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'
import { readProviderNativeTools } from './support/codex-tool-contract-proof.ts'

// Real pinned App Server and production classifier, with a credential-free
// loopback provider. Only metadata about complete requests leaves this test.
const base = process.env.MURPH_REACTION_INPUT_BASE ?? 'ced760e2da3d06b352f3eb7e11329d03e2282d3f'
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const baseModule = new URL('../src/assistant/reaction-routing.input-measurement-base.ts', import.meta.url)
const baseHelperModule = new URL('../src/assistant-ask.reaction-measurement-base.ts', import.meta.url)
const temporaryPaths: string[] = []

afterAll(async () => {
  await stopWarmCodexAppServer()
  await Promise.all(temporaryPaths.map((directory) => rm(directory, { recursive: true, force: true })))
})

describe.skipIf(process.env.MURPH_MEASURE_REACTION_INPUT !== '1')('reaction gate complete input', () => {
  it.each([
    { label: 'classified-heart', reaction: 'Reacted with a heart reaction.', decision: 'quiet', bypass: false },
    { label: 'explicit-question', reaction: 'Reacted with a question reaction.', decision: 'escalate', bypass: true },
  ] as const)('captures actual base and candidate provider requests ($label)', { timeout: 90_000 }, async (fixture) => {
    await writeFile(baseHelperModule, execFileSync('git', ['show', `${base}:packages/assistant-engine/src/assistant-ask.ts`], {
      cwd: repository, encoding: 'utf8',
    }), { flag: 'wx' })
    await writeFile(baseModule, execFileSync('git', ['show', `${base}:packages/assistant-engine/src/assistant/reaction-routing.ts`], {
      cwd: repository, encoding: 'utf8',
    }).replace("'../assistant-ask.js'", "'../assistant-ask.reaction-measurement-base.js'"), { flag: 'wx' })
    const stub = await startScriptedResponsesStub()
    try {
      const baseline: typeof import('../src/assistant/reaction-routing.ts') = await import(baseModule.href)
      const captures = []
      for (const phase of ['base', 'head'] as const) {
        const scenario = await prepareScriptedTurnScenario(stub, temporaryPaths, {
          model: 'gpt-6-luna', additionalTomlLines: buildMurphMemberReadPermissionProfileTomlLines(),
          modelProvider: HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
        })
        const catalog = await writeHostedOpenAiMixedModeModelCatalogJson({
          codexCommand: scenario.turnInput.codexCommand, directory: scenario.turnInput.codexHome,
        })
        const expectedCalls = phase === 'head' && fixture.bypass ? 0 : 1
        stub.captureProviderRequestDiagnostics({ completeInput: true })
        if (expectedCalls) stub.queue({ text: JSON.stringify({ decision: fixture.decision }) })
        const fallbacks: string[] = []
        let providerEntries = 0
        const decision = await (phase === 'base' ? baseline.classifyAssistantReaction : classifyAssistantReaction)({
          reaction: fixture.reaction, targetMessage: 'Your afternoon stretch is logged.',
          codexCommand: scenario.turnInput.codexCommand, codexHome: scenario.turnInput.codexHome,
          modelProvider: scenario.turnInput.modelProvider,
          env: { ...scenario.turnInput.env, [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: catalog },
          beforeProviderEntry: async () => { providerEntries += 1 },
          onFallback: (reason) => { fallbacks.push(reason) },
        })
        expect(decision).toBe(fixture.decision)
        expect(fallbacks).toEqual([])
        expect(providerEntries).toBe(expectedCalls)
        expect(stub.requestCountSinceBaseline()).toBe(expectedCalls)
        const capture = stub.requestSummariesSinceBaseline()[0]?.completeProviderInput
        if (!expectedCalls) {
          expect(capture).toBeUndefined()
          captures.push({ phase, providerCalls: 0, bytes: 0, providerFields: [], exclusions: [] })
          continue
        }
        assert.ok(capture)
        const body = readRecord(JSON.parse(capture.json))
        assert.ok(body)
        expect(body.model).toBe('gpt-6-luna')
        expect(body.service_tier).toBe('priority')
        expect(readRecord(body.reasoning)?.effort).toBe('low')
        const nativeToolNames = readProviderNativeTools(capture.json)
          .map(({ namespace, name }) => [namespace, name].filter(Boolean).join('.'))
        expect(nativeToolNames).not.toContain('functions.exec_command')
        if (phase === 'head') {
          expect(nativeToolNames.filter((name) => name.startsWith('collaboration.'))).toEqual([])
          for (const name of ['write_stdin', 'apply_patch', 'view_image', 'get_goal', 'create_goal', 'update_goal']) {
            expect(nativeToolNames).not.toContain(`functions.${name}`)
          }
        }
        captures.push({ phase, providerCalls: expectedCalls, bytes: Buffer.byteLength(capture.json),
          providerFields: Object.keys(body).sort(), exclusions: capture.excludedTransportFields, nativeToolNames })
      }
      const [before, after] = captures
      assert.ok(before && after)
      process.stdout.write(`[reaction-input-proof] ${JSON.stringify({
        scenario: fixture.label, base, model: 'gpt-6-luna', reasoningEffort: 'low', serviceTier: 'priority', captures,
        deltaBytes: after.bytes - before.bytes, deltaPercent: (after.bytes - before.bytes) / before.bytes * 100,
        tokens: null, tokenLimitation: 'Exact Luna tokenizer unavailable; no token or billed-cost estimate.',
      })}\n`)
    } finally {
      await stopWarmCodexAppServer()
      await stub.close()
      await Promise.all([baseModule, baseHelperModule].map((file) => rm(file, { force: true })))
    }
  })
})
