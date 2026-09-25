import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'
import { buildMurphHostedPermissionProfileTomlLines } from '@murphai/hosted-execution/assistant-permissions'

import { executeCodexAppServerTurn, resolveMurphDynamicTools, stopWarmCodexAppServer } from '../src/assistant-codex.js'
import { buildAssistantSystemPromptWithCacheMetadata } from '../src/assistant/system-prompt.js'
import { executeClinicalDocumentExtraction } from '../src/clinical-document-extraction.js'
import { CacheReplayDiagnostics, type CacheReplayPolicy } from '../scripts/lib/prompt-cache-diagnostics.js'
import { startCacheReplayProxy } from '../scripts/lib/prompt-cache-proxy.js'

const live = process.env.MURPH_RUN_PROMPT_CACHE_REPLAY === '1'

it.skipIf(!live)('replays synthetic Murph workflows through native Codex with cache diagnostics', async () => {
  const apiKey = process.env.OPENAI_API_KEY
  if (!apiKey) throw new Error('cache_replay_requires_development_key')
  const transport = process.env.MURPH_CACHE_REPLAY_TRANSPORT ?? 'websocket'
  const scenario = process.env.MURPH_CACHE_REPLAY_SCENARIO ?? 'scheduled'
  const optimized = process.env.MURPH_CACHE_REPLAY_POLICY === 'stable'
  const explicit = process.env.MURPH_CACHE_REPLAY_POLICY === 'explicit'
  if (!['http', 'websocket'].includes(transport) || !['scheduled', 'document'].includes(scenario)) throw new Error('cache_replay_invalid_scenario')
  const policy: CacheReplayPolicy = {
    cohort: `${scenario}-${transport}`, key: optimized || explicit || process.env.MURPH_CACHE_REPLAY_POLICY === 'key' ? 'cohort' : 'preserve',
    breakpoint: optimized || explicit || process.env.MURPH_CACHE_REPLAY_POLICY === 'breakpoint' ? 'developer' : 'none', mode: explicit ? 'explicit' : 'implicit',
  }
  const events: Record<string, unknown>[] = []
  const diagnostics = new CacheReplayDiagnostics((event) => {
    events.push(event)
    process.stdout.write(`${JSON.stringify(event)}\n`)
  })
  const proxy = await startCacheReplayProxy({ apiKey, diagnostics, policy: () => policy })
  const root = await mkdtemp(path.join(tmpdir(), 'murph-cache-replay-'))
  const codexHome = path.join(root, 'codex')
  const workingDirectory = path.join(root, 'workspace')
  await mkdir(codexHome)
  await mkdir(workingDirectory)
  const env: NodeJS.ProcessEnv = { MURPH_CACHE_REPLAY_TOKEN: proxy.token }
  for (const key of ['PATH', 'TMPDIR', 'LANG', 'SSL_CERT_FILE', 'SSL_CERT_DIR']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  const model = 'gpt-5.6-terra'
  const modelProvider = 'cache-replay'
  await writeFile(path.join(codexHome, 'config.toml'), [
    `model = "${model}"`, `model_provider = "${modelProvider}"`,
    'approval_policy = "never"', 'check_for_update_on_startup = false',
    'include_environment_context = false',
    '[history]', 'persistence = "none"',
    `[model_providers.${modelProvider}]`, 'name = "Local cache replay"',
    `base_url = ${JSON.stringify(proxy.baseUrl)}`, 'env_key = "MURPH_CACHE_REPLAY_TOKEN"',
    'wire_api = "responses"', 'requires_openai_auth = false',
    `supports_websockets = ${transport === 'websocket'}`, 'stream_idle_timeout_ms = 90000',
    ...buildMurphHostedPermissionProfileTomlLines(),
  ].join('\n'), { mode: 0o600 })
  const common = {
    codexCommand: fileURLToPath(new URL('../node_modules/.bin/codex', import.meta.url)),
    codexHome, env, model, modelProvider, reasoningEffort: 'low',
    abortSignal: AbortSignal.timeout(240_000),
  }
  try {
    let sessionId: string | null = null
    for (let iteration = 0; iteration < 3; iteration++) {
      if (scenario === 'document') {
        const rawRef = `raw/clinical/fhir/source/batch/attachments/report-${iteration}.txt`
        const documentPath = path.join(workingDirectory, rawRef)
        const text = `Synthetic clinic visit. Event date 2026-09-01. Adult member's weight: ${72 + iteration} kg. Measured on a clinic scale. No other measurements documented.`
        await mkdir(path.dirname(documentPath), { recursive: true })
        await writeFile(documentPath, text)
        const result = await executeClinicalDocumentExtraction({
          ...common, workspaceRoot: workingDirectory, documentPath, extractedText: text,
          timeZone: 'UTC', family: 'measurements',
          source: { rawRef, sha256: createHash('sha256').update(text).digest('hex'), mediaType: 'text/plain' },
        })
        expect(result.status).toBe('complete')
        expect(result.records.length).toBeGreaterThan(0)
      } else {
        const { layers } = buildAssistantSystemPromptWithCacheMetadata({
          assistantCliContract: null, channel: 'imessage',
          cliAccess: { rawCommand: 'vault-cli', setupCommand: 'murph' },
          currentLocalDate: '2026-09-22', currentTimeZone: 'UTC',
          currentInstant: `2026-09-22T12:0${iteration}:00.000Z`,
          onboardingGuidance: false, modelBehaviorProfile: 'gpt5-agentic',
          hostedRuntime: true, assistantHostedAutomationAvailable: true,
          turnTrigger: 'automation-cron',
        })
        const result = await executeCodexAppServerTurn({
          ...common, approvalPolicy: 'never', sandbox: 'read-only', workingDirectory,
          resumeSessionId: sessionId,
          developerInstructions: [layers.staticCacheableCorePrompt, layers.stableRouteCapabilityPrompt, layers.threadContextPrompt].join('\n\n'),
          prompt: `${layers.dynamicTurnContextPrompt}\n\nScheduled reminder: take a brief walk. Return a short reminder. No tools or external delivery are needed in this synthetic replay.`,
          dynamicTools: resolveMurphDynamicTools({ progressUpdatesAvailable: false }),
        })
        expect(result.finalMessage.length).toBeGreaterThan(0)
        sessionId = result.sessionId
      }
    }
    expect(events.some((event) => event.transport === transport)).toBe(true)
    expect(events.some((event) => event.comparisonSent === true)).toBe(true)
    const generated = events.filter((event) => event.prewarm !== true)
    expect(generated.length).toBeGreaterThanOrEqual(3)
    for (const event of generated) {
      expect(event.status).toBe('completed')
      expect(typeof event.inputCostUnits).toBe('number')
    }
    process.stdout.write(`${JSON.stringify({ event: 'prompt_cache_replay_summary', scenario, transport, policy: process.env.MURPH_CACHE_REPLAY_POLICY ?? 'baseline',
      requests: generated.length, prewarmRequests: events.length - generated.length,
      inputTokens: generated.reduce((sum, event) => sum + Number(event.inputTokens ?? 0), 0),
      cachedTokens: generated.reduce((sum, event) => sum + Number(event.cachedTokens ?? 0), 0),
      cacheWriteTokens: generated.reduce((sum, event) => sum + Number(event.cacheWriteTokens ?? 0), 0),
      inputCostUnits: generated.reduce((sum, event) => sum + Number(event.inputCostUnits ?? 0), 0),
    })}\n`)
  } finally {
    await stopWarmCodexAppServer()
    await proxy.close()
    await rm(root, { recursive: true, force: true })
  }
}, 300_000)
