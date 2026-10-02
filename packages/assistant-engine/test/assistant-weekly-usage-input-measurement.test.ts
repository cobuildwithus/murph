import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, rm, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

import { HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV } from '@murphai/hosted-execution/env'
import { afterAll, describe, expect, it } from 'vitest'

import { executeCodexAppServerTurn, resolveMurphDynamicTools, stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import { MURPH_CODEX_BASE_INSTRUCTIONS } from '../src/assistant/codex-base-instructions.ts'
import { buildAssistantSystemPromptLayers } from '../src/assistant/system-prompt.ts'
import { writeHostedOpenAiMixedModeModelCatalogJson } from './support/codex-model-catalog.ts'
import { prepareScriptedTurnScenario, readRecord, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'

// Credential-free, opt-in complete request measurement. The baseline module is
// materialized beside its original imports and removed afterwards. Its unchanged
// dependencies are shared with the candidate; changed tool definitions use their
// exact base modules as well.
const base = process.env.MURPH_USAGE_INPUT_BASE ?? '4cd1e58609'
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const promptPath = 'packages/assistant-engine/src/assistant/system-prompt.ts'
const configPath = 'packages/assistant-runtime/src/hosted-runtime/codex-config.ts'
const baseModule = new URL('../src/assistant/system-prompt.weekly-measurement-base.ts', import.meta.url)
const baseCatalogModule = new URL('../src/assistant-codex/dynamic-tool-catalog.weekly-measurement-base.ts', import.meta.url)
const baseAutomationModule = new URL('../src/assistant-codex/dynamic-tools/automation.weekly-measurement-base.ts', import.meta.url)
const temporaryPaths: string[] = []

function gitSource(file: string): string {
  return execFileSync('git', ['show', `${base}:${file}`], { cwd: repository, encoding: 'utf8' })
}

function nativeDelegationConfig(source: string): string[] {
  const names = [
    ['usage_hint_text', 'HOSTED_CODEX_MULTI_AGENT_USAGE_HINT_TEXT'],
    ['multi_agent_mode_hint_text', 'HOSTED_CODEX_MULTI_AGENT_MODE_HINT_TEXT'],
    ['subagent_usage_hint_text', 'HOSTED_CODEX_SUBAGENT_USAGE_HINT_TEXT'],
    ['subagent_developer_instructions', 'HOSTED_CODEX_SUBAGENT_DEVELOPER_INSTRUCTIONS_TEXT'],
  ] as const
  return [
    '[features.multi_agent_v2]', 'enabled = true',
    'expose_spawn_agent_model_overrides = true', 'max_concurrent_threads_per_session = 4',
    ...names.flatMap(([key, name]) => {
      const expression = new RegExp(`const ${name} =\\s*([\\s\\S]*?);\\n`).exec(source)?.[1]
      if (!expression && key === 'subagent_developer_instructions') return []
      assert.ok(expression, `Expected production constant ${name}`)
      // Evaluate only a trusted repository string expression, never a prompt or
      // external response. Do not duplicate or shorten production hint text.
      const value: unknown = runInNewContext(`(${expression})`, {}, { timeout: 100 })
      assert.equal(typeof value, 'string')
      return [`${key} = ${JSON.stringify(value)}`]
    }),
  ]
}

afterAll(async () => {
  await stopWarmCodexAppServer()
  await Promise.all(temporaryPaths.map((directory) => rm(directory, { recursive: true, force: true })))
})

describe.skipIf(process.env.MURPH_MEASURE_WEEKLY_USAGE_INPUT !== '1')('weekly usage optimizer initial input', () => {
  it.each(['direct', 'group'] as const)('complete first provider request (%s)', { timeout: 180_000 }, async (scope) => {
    await writeFile(baseModule, gitSource(promptPath), { flag: 'wx' })
    await writeFile(baseAutomationModule, gitSource('packages/assistant-engine/src/assistant-codex/dynamic-tools/automation.ts'), { flag: 'wx' })
    await writeFile(baseCatalogModule, gitSource('packages/assistant-engine/src/assistant-codex/dynamic-tool-catalog.ts').replaceAll(
      "'./dynamic-tools/automation.js'", "'./dynamic-tools/automation.weekly-measurement-base.js'",
    ), { flag: 'wx' })
    const stub = await startScriptedResponsesStub()
    try {
      const baseline: typeof import('../src/assistant/system-prompt.ts') = await import(baseModule.href)
      const baselineCatalog: typeof import('../src/assistant-codex/dynamic-tool-catalog.ts') = await import(baseCatalogModule.href)
      const availability = {
        allowFinishWithoutReply: true, automationAvailable: true,
        personalizationAvailable: scope === 'direct', groupSharedReadAvailable: scope === 'group',
        imageGenerationAvailable: false, progressUpdatesAvailable: true, progressUpdateMode: scope,
        productFeedbackAvailable: true, usageDiagnosticsAvailable: scope === 'direct',
      }
      const captures = []
      for (const phase of ['base', 'head'] as const) {
        const tools = (phase === 'base' ? baselineCatalog.resolveMurphDynamicTools : resolveMurphDynamicTools)(availability)
        const configSource = phase === 'base' ? gitSource(configPath) : await readFile(new URL(`../../../${configPath}`, import.meta.url), 'utf8')
        const scenario = await prepareScriptedTurnScenario(stub, temporaryPaths, {
          model: 'gpt-6.1-sol', additionalTomlLines: nativeDelegationConfig(configSource),
        })
        const build = phase === 'base' ? baseline.buildAssistantSystemPromptLayers : buildAssistantSystemPromptLayers
        const layers = build({
          assistantCliContract: null, assistantHostedAutomationAvailable: true,
          assistantProgressUpdatesAvailable: true, channel: 'linq',
          cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' }, conversationScope: scope,
          currentLocalDate: '2030-01-10', currentInstant: '2030-01-10T16:00:00.000Z', currentTimeZone: 'UTC',
          hostedRuntime: true, modelBehaviorProfile: 'gpt5-agentic', onboardingGuidance: false,
          ordinaryInboundTurn: true,
        })
        const catalog = await writeHostedOpenAiMixedModeModelCatalogJson({
          codexCommand: scenario.turnInput.codexCommand, directory: scenario.turnInput.codexHome,
        })
        stub.captureProviderRequestDiagnostics({ completeInput: true })
        stub.queue({ text: 'SYNTHETIC_USAGE_INPUT_CAPTURED' })
        const result = await executeCodexAppServerTurn({
          ...scenario.turnInput, dynamicTools: tools, groupConversation: scope === 'group',
          baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
          developerInstructions: [layers.staticCacheableCorePrompt, layers.stableRouteCapabilityPrompt, layers.threadContextPrompt].join('\n\n'),
          prompt: [layers.dynamicTurnContextPrompt, 'Review the existing reminders and summarize which need attention.'].join('\n\n'),
          env: { ...scenario.turnInput.env, [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: catalog },
        })
        expect(result.finalMessage).toBe('SYNTHETIC_USAGE_INPUT_CAPTURED')
        expect(stub.requestCountSinceBaseline()).toBe(1)
        const capture = stub.requestSummariesSinceBaseline()[0]?.completeProviderInput
        assert.ok(capture)
        const body = readRecord(JSON.parse(capture.json))
        assert.ok(body)
        expect(body.model).toBe('gpt-6.1-sol')
        expect(capture.json).toContain('functions')
        captures.push({
          phase, bytes: Buffer.byteLength(capture.json),
          sha256: createHash('sha256').update(capture.json).digest('hex'),
          providerFields: Object.keys(body).sort(), exclusions: capture.excludedTransportFields,
          registeredTools: tools.map((tool) => `${tool.namespace}.${tool.name}`),
          registeredToolBytes: Buffer.byteLength(JSON.stringify(tools)),
          usageDiagnosticsAdvertised: capture.json.includes('usage_diagnostics'),
        })
        await stopWarmCodexAppServer()
      }
      const [before, after] = captures
      assert.ok(before && after)
      process.stdout.write(`[weekly-usage-input-proof] ${JSON.stringify({
        scope, base, model: 'gpt-6.1-sol', nativeDelegation: true, captures,
        deltaBytes: after.bytes - before.bytes, deltaPercent: (after.bytes - before.bytes) / before.bytes * 100,
        tokens: null, tokenDelta: null, tokenLimitation: 'No exact GPT-6.1 Sol tokenizer is configured; no estimate is substituted.',
      })}\n`)
    } finally {
      await stopWarmCodexAppServer()
      await stub.close()
      await Promise.all([baseModule, baseCatalogModule, baseAutomationModule].map((file) => rm(file, { force: true })))
    }
  })
})
