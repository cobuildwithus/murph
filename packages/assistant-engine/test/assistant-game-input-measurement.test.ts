import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runInNewContext } from 'node:vm'

import { HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV } from '@murphai/hosted-execution/env'
import { afterAll, describe, expect, it, vi } from 'vitest'
import * as gameTools from '../src/assistant-codex/dynamic-tools/games.js'
import type { AssistantHostedToolContext } from '../src/assistant/hosted-tool-context.js'
import { hostedGameToolResponseSchema } from '@murphai/hosted-execution/runtime-control'

import { executeCodexAppServerTurn, resolveMurphDynamicTools, stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import { MURPH_CODEX_BASE_INSTRUCTIONS } from '../src/assistant/codex-base-instructions.ts'
import { buildAssistantSystemPromptLayers } from '../src/assistant/system-prompt.ts'
import { writeHostedOpenAiMixedModeModelCatalogJson } from './support/codex-model-catalog.ts'
import { prepareScriptedTurnScenario, readRecord, startScriptedResponsesStub } from './support/codex-scripted-provider.ts'

// Credential-free, opt-in complete request measurement. The baseline module is
// materialized beside its original imports and removed afterwards. Its unchanged
// dependencies are shared with the candidate; changed tool definitions use their
// exact base modules as well.
const base = process.env.MURPH_GAME_INPUT_BASE ?? 'b2694496c0665990fa0fd283b5041e5018a38d3e'
const repository = fileURLToPath(new URL('../../../', import.meta.url))
const promptPath = 'packages/assistant-engine/src/assistant/system-prompt.ts'
const configPath = 'packages/assistant-runtime/src/hosted-runtime/codex-config.ts'
const baseModule = new URL('../src/assistant/system-prompt.game-measurement-base.ts', import.meta.url)
const baseBehaviorModule = new URL('../src/assistant/model-behavior.game-measurement-base.ts', import.meta.url)
const baseCatalogModule = new URL('../src/assistant-codex/dynamic-tool-catalog.game-measurement-base.ts', import.meta.url)
const baseGameModule = new URL('../src/assistant-codex/dynamic-tools/games.game-measurement-base.ts', import.meta.url)
const temporaryPaths: string[] = []

function gitSource(file: string): string {
  return execFileSync('git', ['show', `${base}:${file}`], { cwd: repository, encoding: 'utf8' })
}

async function nativeDelegationSource(phase: 'base' | 'head'): Promise<string> {
  const sharedPath = 'packages/hosted-execution/src/codex-behavior.ts'
  if (phase === 'base') {
    const committed = execFileSync('git', ['ls-tree', '--name-only', base, '--', sharedPath], { cwd: repository, encoding: 'utf8' }).trim()
    return gitSource(committed === sharedPath ? sharedPath : configPath)
  }
  return readFile(new URL(`../../../${sharedPath}`, import.meta.url), 'utf8')
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

describe.skipIf(process.env.MURPH_MEASURE_GAME_INPUT !== '1')('group game tools initial input', () => {
  it.skipIf(process.env.MURPH_VERIFY_GAME_SKEW !== "1").each(['direct', 'group', 'mixed'] as const)('complete provider requests before and after read_game (%s)', { timeout: 180_000 }, async (fixture) => {
    const scope: 'direct' | 'group' = fixture === 'direct' ? 'direct' : 'group'
    await writeFile(baseBehaviorModule, gitSource('packages/assistant-engine/src/assistant/model-behavior.ts'), { flag: 'wx' })
    await writeFile(baseModule, gitSource(promptPath).replaceAll(
      '"./model-behavior.js"', '"./model-behavior.game-measurement-base.js"',
    ), { flag: 'wx' })
    const prize = /^export const GAME_PRIZE_WORDS = (.+);$/mu.exec(gitSource('packages/hosted-execution/src/game-chat-notifications.ts'))?.[1]
    assert.ok(prize)
    await writeFile(baseGameModule, `const GAME_PRIZE_WORDS = ${prize}\n` + gitSource('packages/assistant-engine/src/assistant-codex/dynamic-tools/games.ts').replace('GAME_PRIZE_WORDS, ', ''), { flag: 'wx' })
    await writeFile(baseCatalogModule, gitSource('packages/assistant-engine/src/assistant-codex/dynamic-tool-catalog.ts').replaceAll(
      "'./dynamic-tools/games.js'", "'./dynamic-tools/games.game-measurement-base.js'",
    ), { flag: 'wx' })
    const stub = await startScriptedResponsesStub()
    try {
      const baseline: typeof import('../src/assistant/system-prompt.ts') = await import(baseModule.href)
      const baselineCatalog: typeof import('../src/assistant-codex/dynamic-tool-catalog.ts') = await import(baseCatalogModule.href)
      const baselineGame: typeof gameTools = await import(baseGameModule.href)
      const candidateExecute = gameTools.executeGameTool
      const inputId = 'ain_' + 'a'.repeat(32)
      const players = ['Alex', 'Sam', 'River'].map((firstName, seat) => ({ memberId: `player_${seat}`, firstName, timeZone: 'UTC', seat, dayOne: null }))
      const group = { id: 'game_group_measurement', maxPlayers: 10, pendingInviteeCount: 1, status: 'invited', startsOn: null, lengthDays: 7,
        players: players.slice(0, 1), terms: { n: 1, fromDay: 0, defaultTask: 'Walk outside', tasks: [{ seat: 0, text: 'Walk outside' }], schedule: { count: 5 }, stakes: [{ kind: 'prize', item: 'Choose lunch' }] },
        pendingChange: null, changeControls: { canStartNow: false, canEdit: true, canEditSchedule: false, canEditStartDate: false, editableFromDay: null } }
      const response = hostedGameToolResponseSchema.parse({ action: 'read_game', result: { status: 'ok', state: { players: players.map(player => ({ memberId: player.memberId, firstName: player.firstName, timeZone: player.timeZone, isSender: player.seat === 0 })), games: [group,
        ...(fixture === 'mixed' ? [{ ...group, maxPlayers: undefined, pendingInviteeCount: undefined, id: 'game_pair_measurement', status: 'live', players: players.slice(0, 2) }] : []),
      ] } } })
      const context: AssistantHostedToolContext = { computerToolsAvailable: false, vaultFileSendAvailable: false,
        groupTool: { request: async () => response }, currentUserActionScope: () => ({ conversationId: 'room', inboundMailboxItemIds: [], recipientKey: 'recipient', acceptedInputIds: [inputId], originSessionId: 'session', conversationScope: 'group' }),
        currentHostedDeliveryContext: () => null, currentHostedMailboxItemIds: () => [], sendVaultFile: async () => { throw new Error('No media') } }
      const availability = {
        allowFinishWithoutReply: true, automationAvailable: true,
        myGameRemindersAvailable: scope === 'direct',
        personalizationAvailable: scope === 'direct', groupSharedReadAvailable: scope === 'group', gameReadAvailable: scope === 'group', gamesAvailable: scope === 'group', gamePhotosAvailable: scope === 'group',
        imageGenerationAvailable: false, progressUpdatesAvailable: true, progressUpdateMode: scope,
        productFeedbackAvailable: true, usageDiagnosticsAvailable: scope === 'direct',
      }
      const captures = []
      for (const phase of ['base', 'head'] as const) {
        vi.spyOn(gameTools, 'executeGameTool').mockImplementation(phase === 'base' ? baselineGame.executeGameTool : candidateExecute)
        const tools = (phase === 'base' ? baselineCatalog.resolveMurphDynamicTools : resolveMurphDynamicTools)(availability)
        const configSource = await nativeDelegationSource(phase)
        const scenario = await prepareScriptedTurnScenario(stub, temporaryPaths, {
          model: 'gpt-6.1-sol', additionalTomlLines: nativeDelegationConfig(configSource),
        })
        const build = phase === 'base' ? baseline.buildAssistantSystemPromptLayers : buildAssistantSystemPromptLayers
        const layers = build({
          assistantCliContract: null, assistantHostedAutomationAvailable: true,
          assistantProgressUpdatesAvailable: true, channel: 'linq',
          cliAccess: { rawCommand: 'vault-cli' }, conversationScope: scope,
          currentLocalDate: '2030-01-10', currentInstant: '2030-01-10T16:00:00.000Z', currentTimeZone: 'UTC',
          hostedRuntime: true,onboardingGuidance: false,
          ordinaryInboundTurn: true,
        })
        const catalog = await writeHostedOpenAiMixedModeModelCatalogJson({
          codexCommand: scenario.turnInput.codexCommand, directory: scenario.turnInput.codexHome,
        })
        stub.captureProviderRequestDiagnostics({ completeInput: true })
        if (scope === 'group') stub.queue({ functionCall: { namespace: 'murph', name: 'read_game', arguments: { messageRef: inputId } } })
        stub.queue({ text: 'SYNTHETIC_USAGE_INPUT_CAPTURED' })
        const result = await executeCodexAppServerTurn({
          ...scenario.turnInput, dynamicTools: tools, groupConversation: scope === 'group',
          hostedToolContext: scope === 'group' ? context : null,
          baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
          developerInstructions: [layers.staticCacheableCorePrompt, layers.stableRouteCapabilityPrompt, layers.threadContextPrompt,
            ...(scope === 'direct'
              ? [(phase === 'base' ? baselineGame : gameTools).GAME_PRIVATE_REMINDER_DIRECT_GUIDANCE].filter(Boolean)
              : [])].join('\n\n'),
          prompt: [layers.dynamicTurnContextPrompt, 'Read the current games and summarize their tasks.'].join('\n\n'),
          env: { ...scenario.turnInput.env, [HOSTED_RUNTIME_CODEX_MODEL_CATALOG_JSON_ENV]: catalog },
        })
        expect(result.finalMessage).toBe('SYNTHETIC_USAGE_INPUT_CAPTURED')
        expect(stub.requestCountSinceBaseline()).toBe(scope === 'group' ? 2 : 1)
        const capture = stub.requestSummariesSinceBaseline()[0]?.completeProviderInput
        assert.ok(capture)
        const body = readRecord(JSON.parse(capture.json))
        assert.ok(body)
        expect(body.model).toBe('gpt-6.1-sol')
        expect(capture.json).toContain('functions')
        const outputDirectory = process.env.MURPH_GAME_INPUT_OUTPUT_DIRECTORY
        if (outputDirectory) {
          await mkdir(outputDirectory, { recursive: true })
          await writeFile(path.join(outputDirectory, `${fixture}-${phase}.json`), capture.json.replaceAll(homedir(), '<HOME_DIR>'))
        }
        captures.push({
          phase, bytes: Buffer.byteLength(capture.json),
          sha256: createHash('sha256').update(capture.json).digest('hex'),
          providerFields: Object.keys(body).sort(), exclusions: capture.excludedTransportFields,
          registeredTools: tools.map((tool) => `${tool.namespace}.${tool.name}`),
          registeredToolBytes: Buffer.byteLength(JSON.stringify(tools)),
          usageDiagnosticsAdvertised: capture.json.includes('usage_diagnostics'),
          afterReadBytes: scope === 'group' ? Buffer.byteLength(stub.requestSummariesSinceBaseline()[1]!.completeProviderInput!.json) : null,
        })
        await stopWarmCodexAppServer()
      }
      const [before, after] = captures
      assert.ok(before && after)
      process.stdout.write(`[game-input-proof] ${JSON.stringify({
        scope, fixture, base, model: 'gpt-6.1-sol', nativeDelegation: true, captures,
        deltaBytes: after.bytes - before.bytes, deltaPercent: (after.bytes - before.bytes) / before.bytes * 100,
        afterReadDeltaBytes: before.afterReadBytes && after.afterReadBytes ? after.afterReadBytes - before.afterReadBytes : null,
        afterReadDeltaPercent: before.afterReadBytes && after.afterReadBytes ? (after.afterReadBytes - before.afterReadBytes) / before.afterReadBytes * 100 : null,
        tokens: null, tokenDelta: null, tokenLimitation: 'No exact GPT-6.1 Sol tokenizer is configured; no estimate is substituted.',
      })}\n`)
    } finally {
      vi.restoreAllMocks()
      await stopWarmCodexAppServer()
      await stub.close()
      await Promise.all([baseModule, baseBehaviorModule, baseCatalogModule, baseGameModule].map((file) => rm(file, { force: true })))
    }
  })
})
