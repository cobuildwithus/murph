import { rm, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import { executeCodexAppServerTurn, resolveMurphDynamicTools, stopWarmCodexAppServer } from '../src/assistant-codex.ts'
import { MURPH_CODEX_BASE_INSTRUCTIONS } from '../src/assistant/codex-base-instructions.ts'
import { buildAssistantSystemPromptLayers } from '../src/assistant/system-prompt.ts'
import { readAssistantCliSurfaceBootstrapContext } from '../src/assistant/cli-surface-bootstrap.ts'
import { prepareScriptedTurnScenario, startScriptedResponsesStub, type ScriptedStub } from './support/codex-scripted-provider.ts'
import { writeHostedOpenAiMixedModeModelCatalogJson } from './support/codex-model-catalog.ts'

const paths: string[] = []
let stub: ScriptedStub | undefined
afterEach(async () => {
  await stopWarmCodexAppServer()
  await stub?.close()
  await Promise.all(paths.splice(0).map(root => rm(root, { force: true, recursive: true })))
})

// Opt-in, credential-free complete wire capture for identical base/head fixtures.
// The caller chooses a private temporary output directory; paths are normalized.
it.skipIf(!process.env.MURPH_TOKEN_INPUT_MEASUREMENT_DIR).each(['direct', 'group'] as const)(
  'token efficiency complete provider input %s', { timeout: 90_000 }, async scope => {
    stub = await startScriptedResponsesStub()
    const scenario = await prepareScriptedTurnScenario(stub, paths)
    const group = scope === 'group'
    const layers = buildAssistantSystemPromptLayers({
      assistantCliContract: group ? null : await readAssistantCliSurfaceBootstrapContext(),
      assistantHostedAutomationAvailable: true,
      assistantHostedGroupToolSurface: group ? 'families' : 'none',
      channel: 'linq', cliAccess: { rawCommand: 'vault-cli' }, conversationScope: scope,
      currentLocalDate: '2026-11-06', currentInstant: '2026-11-06T16:00:00.000Z', currentTimeZone: 'UTC',
      hostedRuntime: true, onboardingGuidance: false, ordinaryInboundTurn: true,
    })
    const tools = resolveMurphDynamicTools({
      allowFinishWithoutReply: true, automationAvailable: true, imageGenerationAvailable: true,
      progressUpdatesAvailable: true, progressUpdateMode: scope,
      groupSharedReadAvailable: group, groupRoomModelAvailable: group, gameReadAvailable: group, gamesAvailable: group,
      assistantStyleSettingsAvailable: true, deviceAvailable: !group, labsAvailable: !group,
      assistantConfigurationAvailable: !group, personalizationAvailable: !group, connectedAppsManageAvailable: !group,
      calendarLinkAvailable: !group, pollsAvailable: true, responseCardsAvailable: !group,
    })
    const catalog = await writeHostedOpenAiMixedModeModelCatalogJson({ codexCommand: scenario.turnInput.codexCommand, directory: scenario.turnInput.codexHome })
    stub.captureProviderRequestDiagnostics({ completeInput: true })
    stub.queue({ text: 'SYNTHETIC_CAPTURE_DONE' })
    const result = await executeCodexAppServerTurn({
      ...scenario.turnInput, baseInstructions: MURPH_CODEX_BASE_INSTRUCTIONS,
      developerInstructions: [layers.staticCacheableCorePrompt, layers.stableRouteCapabilityPrompt, layers.threadContextPrompt].join('\n\n'),
      dynamicTools: tools, groupConversation: group,
      prompt: [layers.dynamicTurnContextPrompt, 'Suggest a short walk.'].join('\n\n'),
      env: { ...scenario.turnInput.env, MURPH_HOSTED_CODEX_MODEL_CATALOG_JSON: catalog },
    })
    expect(result.finalMessage).toBe('SYNTHETIC_CAPTURE_DONE')
    const captured = stub.requestSummariesSinceBaseline()[0]?.completeProviderInput
    expect(captured).toBeDefined()
    const body = JSON.parse(captured!.json) as Record<string, unknown>
    delete body.prompt_cache_key
    const json = JSON.stringify(body)
      .replaceAll(scenario.turnInput.workingDirectory, '/synthetic-vault')
      .replaceAll(scenario.turnInput.codexHome, '/synthetic-codex-home')
      .replaceAll(homedir(), '<HOME_DIR>')
    await writeFile(path.join(process.env.MURPH_TOKEN_INPUT_MEASUREMENT_DIR!, `${scope}.json`), json)
    process.stdout.write(`[token-input-measurement] ${JSON.stringify({ scope, model: scenario.turnInput.model, bytes: Buffer.byteLength(json), tools: tools.length, exclusions: [...new Set([...captured!.excludedTransportFields, 'prompt_cache_key'])], normalizedPaths: true })}\n`)
  },
)
