import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import { describe, expect, it } from 'vitest'

import {
  executeCodexAppServerTurn,
  resolveMurphDynamicTools,
  type CodexAppServerTurnInput,
} from '../src/assistant-codex.ts'
import { extractCodexAssistantProviderUsage } from '../src/assistant/providers/helpers.ts'

const RUN_REAL_CODEX_E2E = process.env.MURPH_RUN_REAL_CODEX_E2E === '1'
const describeRealCodex = RUN_REAL_CODEX_E2E ? describe : describe.skip
const DEFAULT_REAL_CODEX_MODEL = 'gpt-5.5'
const OPENAI_ENV_MODEL_PROVIDER = 'openai-env'
const OPENAI_BASE_URL = 'https://api.openai.com/v1'
const OPENAI_API_KEY_ENV = 'OPENAI_API_KEY'
const VERCEL_AI_GATEWAY_MODEL_PROVIDER = 'vercel-ai-gateway'
const VERCEL_AI_GATEWAY_BASE_URL = 'https://ai-gateway.vercel.sh/v1'
const VERCEL_AI_GATEWAY_API_KEY_ENV = 'VERCEL_AI_API_KEY'
const REAL_CODEX_E2E_ENV_ALLOWLIST = [
  'PATH',
  'TMPDIR',
  'TMP',
  'TEMP',
  'LANG',
  'LC_ALL',
  'LC_CTYPE',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'NODE_EXTRA_CA_CERTS',
] as const

interface RealCodexE2eConfig {
  codexHome: string
  env: NodeJS.ProcessEnv
  model: string
  modelProvider: string
  temporaryPaths: string[]
}

interface CodexUsageSnapshot {
  cachedInputTokens: number
  inputTokens: number
  outputTokens: number
  reasoningOutputTokens: number
  totalTokens: number
}

interface CodexTokenUsageEvent {
  last: CodexUsageSnapshot
  total: CodexUsageSnapshot
}

interface CacheProbeSummary {
  finalContainsOk: boolean
  finalLastCachedInputTokens: number
  finalLastInputTokens: number
  finalTotalCachedInputTokens: number
  finalTotalInputTokens: number
  modelProvider: string
  providerActionCount: number
  summedLastCachedInputTokens: number
  summedLastInputTokens: number
  usageCount: number
}

interface ResumeCacheProbeSummary {
  first: {
    finalContainsOk: boolean
    finalLastUsage: CodexUsageSnapshot | null
    providerActionCount: number
    usageCount: number
  }
  second: {
    allUsageEvents: CodexTokenUsageEvent[]
    currentPostStartLastUsage: CodexUsageSnapshot
    eventSequence: Array<{
      index: number
      type: string | null
      usage?: {
        last: CodexUsageSnapshot
        total: CodexUsageSnapshot
      }
    }>
    finalContainsOk: boolean
    providerActionCount: number
    turnIdPresent: boolean
    usageCount: number
  }
}

describeRealCodex('real Codex app-server cache usage e2e', () => {
  it(
    'returns the resumed turn id in the real turn/start result contract',
    async () => {
      const config = await resolveRealCodexE2eConfig()
      const workingDirectory = await mkdtemp(
        path.join(tmpdir(), 'murph-codex-turn-start-contract-e2e-'),
      )

      try {
        const commonInput = {
          approvalPolicy: 'never',
          codexCommand: normalizeEnvString(process.env.MURPH_REAL_CODEX_COMMAND)
            ?? undefined,
          codexHome: config.codexHome,
          env: config.env,
          excludeResumeTurns: true,
          model: config.model,
          modelProvider: config.modelProvider,
          reasoningEffort: 'low',
          sandbox: 'workspace-write' as const,
          workingDirectory,
        }
        const first = await executeRealCodexAppServerTurn({
          ...commonInput,
          prompt: 'Reply exactly TURN_START_CONTRACT_ONE_OK.',
        })
        const secondTraceEvents: unknown[] = []
        const second = await executeRealCodexAppServerTurn({
          ...commonInput,
          onTraceEvent: (event) => {
            secondTraceEvents.push(event)
          },
          prompt: 'Reply exactly TURN_START_CONTRACT_TWO_OK.',
          resumeSessionId: first.sessionId,
        })
        const turnStartResultTurnIds = readCodexTurnStartResultTurnIds(
          second.jsonEvents,
        )
        const turnStartedEventTurnIds = readCodexTurnStartedEventTurnIds(
          second.jsonEvents,
        )
        const secondTurnId = second.turnId

        expect(second.finalMessage).toContain('TURN_START_CONTRACT_TWO_OK')
        expect(secondTurnId).not.toBeNull()
        if (!secondTurnId) {
          throw new Error('Real Codex resumed turn did not expose a turn id.')
        }
        expect(hasCodexTimingStage(secondTraceEvents, 'warm-reused')).toBe(true)
        expect(turnStartResultTurnIds).toContain(secondTurnId)
        expect(turnStartedEventTurnIds).toContain(secondTurnId)
      } finally {
        await removeRealCodexTemporaryPaths([
          workingDirectory,
          ...config.temporaryPaths,
        ])
      }
    },
    360_000,
  )

  it(
    'uses current-turn total delta usage from a real tool-using Codex turn',
    async () => {
      const config = await resolveRealCodexE2eConfig()

      try {
        const attempts = readPositiveIntegerEnv(
          process.env.MURPH_REAL_CODEX_CACHE_ATTEMPTS,
        ) ?? 2
        const summaries: CacheProbeSummary[] = []

        for (let attempt = 1; attempt <= attempts; attempt += 1) {
          const probe = await runCacheProbeAttempt({
            attempt,
            config,
          })
          summaries.push(probe.summary)

          if (!hasTotalUsageRegressionShape(probe.summary)) {
            continue
          }

          const extractedUsage = extractCodexAssistantProviderUsage({
            providerConfig: normalizeAssistantProviderConfig({
              provider: 'codex-cli',
              model: config.model,
              modelProvider: config.modelProvider,
              oss: false,
            }),
            rawEvents: probe.rawEvents,
          })

          expect(extractedUsage.usageExtractionSourcePath).toBe(
            'thread.tokenUsage.total.delta',
          )
          expect(extractedUsage.inputTokens).toBe(
            probe.summary.finalTotalInputTokens,
          )
          expect(extractedUsage.cachedInputTokens).toBe(
            probe.summary.finalTotalCachedInputTokens,
          )
          expect(probe.summary.finalTotalInputTokens).toBeGreaterThan(
            probe.summary.finalLastInputTokens,
          )
          expect(probe.summary.finalTotalCachedInputTokens).toBeGreaterThan(
            probe.summary.finalLastCachedInputTokens,
          )
          return
        }

        throw new Error(
          [
            'Real Codex cache regression did not observe current-turn total usage exceeding final last usage.',
            `attempt summaries: ${JSON.stringify(summaries)}`,
          ].join(' '),
        )
      } finally {
        await removeRealCodexTemporaryPaths(config.temporaryPaths)
      }
    },
    360_000,
  )

  it(
    'records resumed low-reasoning usage from the current post-start provider request',
    async () => {
      const config = await resolveRealCodexE2eConfig()

      try {
        const probe = await runResumeCacheProbeAttempt({
          config,
        })
        const currentUsage = probe.summary.second.currentPostStartLastUsage
        const summaryJson = JSON.stringify(probe.summary)
        const extractedUsage = extractCodexAssistantProviderUsage({
          providerConfig: normalizeAssistantProviderConfig({
            provider: 'codex-cli',
            model: config.model,
            modelProvider: config.modelProvider,
            oss: false,
          }),
          rawEvents: probe.rawEvents,
        })

        expect(probe.summary.first.finalContainsOk).toBe(true)
        expect(probe.summary.second.finalContainsOk).toBe(true)
        expect(currentUsage.inputTokens).toBeGreaterThan(1024)
        expect(extractedUsage.inputTokens, summaryJson).toBe(
          currentUsage.inputTokens,
        )
        expect(extractedUsage.cachedInputTokens, summaryJson).toBe(
          currentUsage.cachedInputTokens,
        )
        expect(extractedUsage.outputTokens, summaryJson).toBe(
          currentUsage.outputTokens,
        )
        expect(extractedUsage.reasoningTokens, summaryJson).toBe(
          currentUsage.reasoningOutputTokens,
        )

        if (process.env.MURPH_REAL_CODEX_EXPECT_RESUME_CACHE_MISS === '1') {
          expect(
            currentUsage.cachedInputTokens,
            `expected local resumed cache miss, summary=${JSON.stringify(probe.summary)}`,
          ).toBe(0)
        }
      } finally {
        await removeRealCodexTemporaryPaths(config.temporaryPaths)
      }
    },
    360_000,
  )
})

describe('real Codex app-server cache usage e2e harness', () => {
  it('passes only a minimal environment to live Codex probes', () => {
    const env = buildRealCodexE2eEnv({
      apiKeyEnv: 'PROVIDER_KEY',
      sourceEnv: {
        AWS_SECRET_ACCESS_KEY: 'ignored-aws-value',
        CODEX_HOME: 'ignored-codex-home',
        DATABASE_URL: 'ignored-database-url',
        HOME: 'ignored-home',
        OPENAI_API_KEY: 'ignored-openai-value',
        PATH: '/usr/bin:/bin',
        PROVIDER_KEY: 'provider-value',
        TMPDIR: '/tmp',
      },
    })

    expect(env).toEqual({
      PATH: '/usr/bin:/bin',
      PROVIDER_KEY: 'provider-value',
      TMPDIR: '/tmp',
    })
  })

  it('writes provider-key config without embedding the provider key value', () => {
    const configToml = buildRealCodexConfigToml({
      apiKeyEnv: 'PROVIDER_KEY',
      model: 'gpt-5.5',
      modelProvider: OPENAI_ENV_MODEL_PROVIDER,
    })

    expect(configToml).toContain('[shell_environment_policy]')
    expect(configToml).toContain('include_only = [')
    expect(configToml).toContain('[model_providers.openai-env]')
    expect(configToml).toContain('env_key = "PROVIDER_KEY"')
    expect(configToml).not.toContain('provider-value')
  })

  it('sanitizes live provider failures before Vitest prints them', () => {
    const rawError = Object.assign(
      new Error('Quota exceeded for request req_sensitive_123'),
      {
        code: 'ASSISTANT_CODEX_FAILED',
        context: {
          codexFailureStage: 'turn_failed',
          codexTurnStatus: 'failed',
          providerActionCount: 2,
          codexThreadId: 'thread_sensitive_123',
        },
      },
    )

    const message = buildRealCodexE2eFailureMessage(rawError)

    expect(message).toBe(
      'Real Codex cache probe failed: code=ASSISTANT_CODEX_FAILED stage=turn_failed status=failed providerActionCount=2',
    )
    expect(message).not.toContain('Quota')
    expect(message).not.toContain('req_sensitive')
    expect(message).not.toContain('thread_sensitive')
  })

  it('distinguishes turn/start result ids from turn/started event ids', () => {
    const events = [
      {
        id: 1,
        result: {},
      },
      {
        method: 'turn/started',
        params: {
          turn: {
            id: 'turn-event-only',
          },
        },
      },
      {
        id: 2,
        result: {
          turn: {
            id: 'turn-result',
          },
        },
      },
      {
        id: 3,
        result: {
          turnId: 'turn-result-flat',
        },
      },
      {
        id: 4,
        result: {
          turn_id: 'turn-result-snake',
        },
      },
      {
        method: 'turn/started',
        data: {
          turn: {
            id: 'turn-data-event',
          },
        },
        result: {
          turn: {
            id: 'ignored-result-on-event',
          },
        },
      },
      {
        type: 'turn.started',
        turn_id: 'turn-record-snake-event',
      },
    ]

    expect(readCodexTurnStartResultTurnIds(events)).toEqual([
      'turn-result',
      'turn-result-flat',
      'turn-result-snake',
    ])
    expect(readCodexTurnStartedEventTurnIds(events)).toEqual([
      'turn-event-only',
      'turn-data-event',
      'turn-record-snake-event',
    ])
  })
})

async function runCacheProbeAttempt(input: {
  attempt: number
  config: RealCodexE2eConfig
}): Promise<{
  rawEvents: unknown[]
  summary: CacheProbeSummary
}> {
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), 'murph-codex-cache-e2e-'),
  )

  try {
    await writeFile(
      path.join(workingDirectory, 'cache_a.txt'),
      'alpha-cache-probe-data\n'.repeat(31),
      'utf8',
    )
    await writeFile(
      path.join(workingDirectory, 'cache_b.txt'),
      'beta-cache-probe-data\n'.repeat(37),
      'utf8',
    )

    const result = await executeRealCodexAppServerTurn({
      approvalPolicy: 'never',
      codexCommand: normalizeEnvString(process.env.MURPH_REAL_CODEX_COMMAND)
        ?? undefined,
      codexHome: input.config.codexHome,
      env: input.config.env,
      model: input.config.model,
      modelProvider: input.config.modelProvider,
      prompt: buildCacheProbePrompt(input.attempt),
      reasoningEffort: 'low',
      sandbox: 'workspace-write',
      workingDirectory,
    })
    const usageEvents = readCodexTokenUsageEvents(result.jsonEvents)
    const finalUsage = usageEvents.at(-1) ?? null
    const summedLastUsage = sumCodexLastUsageSnapshots(usageEvents)

    return {
      rawEvents: result.jsonEvents,
      summary: {
        finalContainsOk: result.finalMessage.includes('CACHE_PROBE_OK'),
        finalLastCachedInputTokens: finalUsage?.last.cachedInputTokens ?? 0,
        finalLastInputTokens: finalUsage?.last.inputTokens ?? 0,
        finalTotalCachedInputTokens: finalUsage?.total.cachedInputTokens ?? 0,
        finalTotalInputTokens: finalUsage?.total.inputTokens ?? 0,
        modelProvider: input.config.modelProvider,
        providerActionCount: result.providerActionCount,
        summedLastCachedInputTokens: summedLastUsage.cachedInputTokens,
        summedLastInputTokens: summedLastUsage.inputTokens,
        usageCount: usageEvents.length,
      },
    }
  } finally {
    await removeRealCodexTemporaryPaths([workingDirectory])
  }
}

async function runResumeCacheProbeAttempt(input: {
  config: RealCodexE2eConfig
}): Promise<{
  rawEvents: unknown[]
  summary: ResumeCacheProbeSummary
}> {
  const workingDirectory = await mkdtemp(
    path.join(tmpdir(), 'murph-codex-resume-cache-e2e-'),
  )

  try {
    const commonInput = {
      approvalPolicy: 'never',
      codexCommand: normalizeEnvString(process.env.MURPH_REAL_CODEX_COMMAND)
        ?? undefined,
      codexHome: input.config.codexHome,
      developerInstructions: buildResumeCacheProbeInstructions(),
      env: input.config.env,
      excludeResumeTurns: true,
      model: input.config.model,
      modelProvider: input.config.modelProvider,
      reasoningEffort: 'low',
      sandbox: 'workspace-write' as const,
      workingDirectory,
    }
    const first = await executeRealCodexAppServerTurn({
      ...commonInput,
      prompt: 'Reply exactly RESUME_CACHE_PROBE_ONE_OK.',
    })
    const second = await executeRealCodexAppServerTurn({
      ...commonInput,
      prompt: 'Reply exactly RESUME_CACHE_PROBE_TWO_OK.',
      resumeSessionId: first.sessionId,
    })
    const firstUsageEvents = readCodexTokenUsageEvents(first.jsonEvents)
    const secondUsageEvents = readCodexTokenUsageEvents(second.jsonEvents)
    const currentPostStartUsage =
      readFinalCodexPostStartTokenUsageEvent({
        events: second.jsonEvents,
        turnId: second.turnId,
      })?.last

    if (!currentPostStartUsage) {
      throw new Error(
        `Real Codex resume cache probe produced no post-start token usage event: ${JSON.stringify({
          secondTurnIdPresent: second.turnId !== null,
          secondUsageCount: secondUsageEvents.length,
        })}`,
      )
    }

    return {
      rawEvents: second.jsonEvents,
      summary: {
        first: {
          finalContainsOk: first.finalMessage.includes(
            'RESUME_CACHE_PROBE_ONE_OK',
          ),
          finalLastUsage: firstUsageEvents.at(-1)?.last ?? null,
          providerActionCount: first.providerActionCount,
          usageCount: firstUsageEvents.length,
        },
        second: {
          allUsageEvents: secondUsageEvents,
          currentPostStartLastUsage: currentPostStartUsage,
          eventSequence: summarizeCodexEventSequence(second.jsonEvents),
          finalContainsOk: second.finalMessage.includes(
            'RESUME_CACHE_PROBE_TWO_OK',
          ),
          providerActionCount: second.providerActionCount,
          turnIdPresent: second.turnId !== null,
          usageCount: secondUsageEvents.length,
        },
      },
    }
  } finally {
    await removeRealCodexTemporaryPaths([workingDirectory])
  }
}

async function executeRealCodexAppServerTurn(
  input: Omit<CodexAppServerTurnInput, 'dynamicTools'> & {
    dynamicTools?: CodexAppServerTurnInput['dynamicTools']
  },
): ReturnType<typeof executeCodexAppServerTurn> {
  try {
    return await executeCodexAppServerTurn({
      ...input,
      dynamicTools: input.dynamicTools ?? resolveMurphDynamicTools({
        allowFinishWithoutReply: input.allowFinishWithoutReply,
        allowMessageReactions: input.allowMessageReactions,
        computerToolsAvailable:
          input.hostedToolContext?.computerToolsAvailable === true,
        connectedAppsAvailable: input.hostedToolContext?.connectedApps != null,
        productFeedbackAvailable:
          typeof input.productFeedbackRecorder?.recordProductFeedback === 'function',
        progressUpdatesAvailable: input.progressDelivery != null,
      }),
    })
  } catch (error) {
    throw new Error(buildRealCodexE2eFailureMessage(error))
  }
}

function buildRealCodexE2eFailureMessage(error: unknown): string {
  const record = readRecord(error)
  const context = readRecord(record?.context)
  const parts = [
    `code=${readSafeDiagnosticString(record?.code, 'UNKNOWN')}`,
  ]
  const stage = readSafeDiagnosticString(context?.codexFailureStage)
  if (stage) {
    parts.push(`stage=${stage}`)
  }
  const status = readSafeDiagnosticString(context?.codexTurnStatus)
  if (status) {
    parts.push(`status=${status}`)
  }
  const providerActionCount = readNonNegativeInteger(context?.providerActionCount)
  if (providerActionCount !== null) {
    parts.push(`providerActionCount=${providerActionCount}`)
  }

  return `Real Codex cache probe failed: ${parts.join(' ')}`
}

async function removeRealCodexTemporaryPaths(paths: readonly string[]): Promise<void> {
  await Promise.all(paths.map((targetPath) => removeRealCodexTemporaryPath(targetPath)))
}

async function removeRealCodexTemporaryPath(targetPath: string): Promise<void> {
  for (let attempt = 1; attempt <= 5; attempt += 1) {
    try {
      await rm(targetPath, {
        force: true,
        recursive: true,
      })
      return
    } catch {
      await delay(50 * attempt)
    }
  }
}

async function delay(milliseconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })
}

function buildCacheProbePrompt(attempt: number): string {
  const staticPrefix = Array.from(
    { length: 2200 },
    (_, index) =>
      `cache-probe-static-prefix-${String(index).padStart(4, '0')} keep-this-prefix-stable`,
  ).join('\n')

  return [
    staticPrefix,
    `Cache probe attempt ${attempt}.`,
    'You must run exactly two separate shell commands before answering.',
    'First run a shell command that counts bytes in cache_a.txt.',
    'After that result is observed, run a separate shell command that counts bytes in cache_b.txt.',
    'Then reply exactly CACHE_PROBE_OK followed by both byte counts.',
  ].join('\n\n')
}

function buildResumeCacheProbeInstructions(): string {
  return Array.from(
    { length: 3600 },
    (_, index) =>
      `resume-cache-static-instruction-${String(index).padStart(4, '0')} preserve-this-prefix-for-cache-diagnosis`,
  ).join('\n')
}

function hasTotalUsageRegressionShape(summary: CacheProbeSummary): boolean {
  return summary.finalContainsOk
    && summary.providerActionCount >= 2
    && summary.usageCount >= 2
    && summary.finalTotalInputTokens > summary.finalLastInputTokens
    && summary.finalTotalCachedInputTokens > summary.finalLastCachedInputTokens
}

function sumCodexLastUsageSnapshots(
  events: readonly CodexTokenUsageEvent[],
): CodexUsageSnapshot {
  return events.reduce<CodexUsageSnapshot>(
    (total, event) => ({
      cachedInputTokens:
        total.cachedInputTokens + event.last.cachedInputTokens,
      inputTokens: total.inputTokens + event.last.inputTokens,
      outputTokens: total.outputTokens + event.last.outputTokens,
      reasoningOutputTokens:
        total.reasoningOutputTokens + event.last.reasoningOutputTokens,
      totalTokens: total.totalTokens + event.last.totalTokens,
    }),
    {
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningOutputTokens: 0,
      totalTokens: 0,
    },
  )
}

function readCodexTokenUsageEvents(
  events: readonly unknown[],
): CodexTokenUsageEvent[] {
  return events.flatMap((event) => {
    const record = readRecord(event)
    const eventType = readString(record?.method, record?.type, record?.event)

    if (eventType !== 'thread/tokenUsage/updated') {
      return []
    }

    const params = readRecord(record?.params)
    const tokenUsage = readRecord(params?.tokenUsage)
    const last = readRecord(tokenUsage?.last)
    const total = readRecord(tokenUsage?.total)

    if (!last || !total) {
      return []
    }

    return [
      {
        last: readCodexUsageSnapshot(last),
        total: readCodexUsageSnapshot(total),
      },
    ]
  })
}

function readCodexUsageSnapshot(record: Record<string, unknown>): CodexUsageSnapshot {
  return {
    cachedInputTokens: readIntegerTokenCount(
      record.cachedInputTokens,
      record.cached_input_tokens,
      readRecord(record.input_tokens_details)?.cached_tokens,
    ),
    inputTokens: readIntegerTokenCount(
      record.inputTokens,
      record.input_tokens,
      record.promptTokens,
      record.prompt_tokens,
    ),
    outputTokens: readIntegerTokenCount(
      record.outputTokens,
      record.output_tokens,
      record.completionTokens,
      record.completion_tokens,
    ),
    reasoningOutputTokens: readIntegerTokenCount(
      record.reasoningOutputTokens,
      record.reasoningTokens,
      record.reasoning_tokens,
      readRecord(record.output_tokens_details)?.reasoning_tokens,
    ),
    totalTokens: readIntegerTokenCount(record.totalTokens, record.total_tokens),
  }
}

function readFinalCodexPostStartTokenUsageEvent(input: {
  events: readonly unknown[]
  turnId: string | null
}): CodexTokenUsageEvent | null {
  const turnStartedIndex = input.events.findIndex((event) => {
    const record = readRecord(event)
    const eventType = readString(record?.method, record?.type, record?.event)
    if (eventType !== 'turn/started' && eventType !== 'turn.started') {
      return false
    }

    if (!input.turnId) {
      return true
    }

    const params = readRecord(record?.params)
    const turn = readRecord(params?.turn) ?? readRecord(record?.turn)
    return readString(
      params?.turnId,
      params?.turn_id,
      turn?.id,
      record?.turnId,
      record?.turn_id,
    ) === input.turnId
  })
  const eligibleEvents =
    turnStartedIndex >= 0
      ? input.events.slice(turnStartedIndex)
      : input.events

  return readCodexTokenUsageEvents(eligibleEvents).at(-1) ?? null
}

function readCodexTurnStartResultTurnIds(
  events: readonly unknown[],
): string[] {
  return events.flatMap((event) => {
    const record = readRecord(event)
    if (!record || readString(record.method, record.type, record.event)) {
      return []
    }

    const result = readRecord(record.result)
    const turn = readRecord(result?.turn)
    const turnId = readString(
      turn?.id,
      result?.turnId,
      result?.turn_id,
    )
    return turnId ? [turnId] : []
  })
}

function readCodexTurnStartedEventTurnIds(
  events: readonly unknown[],
): string[] {
  return events.flatMap((event) => {
    const record = readRecord(event)
    const eventType = readString(record?.method, record?.type, record?.event)
    if (eventType !== 'turn/started' && eventType !== 'turn.started') {
      return []
    }

    const params = readRecord(record?.params)
    const data = readRecord(record?.data)
    const turn =
      readRecord(params?.turn)
      ?? readRecord(data?.turn)
      ?? readRecord(record?.turn)
    const turnId = readString(
      params?.turnId,
      params?.turn_id,
      turn?.id,
      data?.turnId,
      data?.turn_id,
      record?.turnId,
      record?.turn_id,
    )
    return turnId ? [turnId] : []
  })
}

function hasCodexTimingStage(
  events: readonly unknown[],
  stage: string,
): boolean {
  return events.some((event) => {
    const rawEvent = readRecord(readRecord(event)?.rawEvent)
    return rawEvent?.codexTimingStage === stage
  })
}

function summarizeCodexEventSequence(
  events: readonly unknown[],
): ResumeCacheProbeSummary['second']['eventSequence'] {
  return events.flatMap((event, index) => {
    const record = readRecord(event)
    const eventType = readString(record?.method, record?.type, record?.event)
    if (!eventType) {
      return []
    }

    const tokenUsage = readRecord(readRecord(record?.params)?.tokenUsage)
    const last = readRecord(tokenUsage?.last)
    const total = readRecord(tokenUsage?.total)

    return [
      {
        index,
        type: eventType,
        ...(last && total
          ? {
              usage: {
                last: readCodexUsageSnapshot(last),
                total: readCodexUsageSnapshot(total),
              },
            }
          : {}),
      },
    ]
  })
}

async function resolveRealCodexE2eConfig(): Promise<RealCodexE2eConfig> {
  const model =
    normalizeEnvString(process.env.MURPH_REAL_CODEX_MODEL)
    ?? DEFAULT_REAL_CODEX_MODEL
  const configuredCodexHome = normalizeEnvString(process.env.MURPH_REAL_CODEX_HOME)
  if (configuredCodexHome) {
    throw new Error(
      'MURPH_REAL_CODEX_HOME is not supported for this e2e; it always creates an isolated Codex home.',
    )
  }

  const explicitModelProvider =
    normalizeEnvString(process.env.MURPH_REAL_CODEX_MODEL_PROVIDER)
  const modelProvider =
    explicitModelProvider
    ?? (
      normalizeEnvString(process.env[VERCEL_AI_GATEWAY_API_KEY_ENV])
        ? VERCEL_AI_GATEWAY_MODEL_PROVIDER
        : OPENAI_ENV_MODEL_PROVIDER
    )
  if (modelProvider === 'openai') {
    throw new Error(
      `Use ${OPENAI_ENV_MODEL_PROVIDER} for this e2e; the built-in openai provider would require the normal Codex auth store.`,
    )
  }
  if (
    modelProvider !== OPENAI_ENV_MODEL_PROVIDER
    && modelProvider !== VERCEL_AI_GATEWAY_MODEL_PROVIDER
  ) {
    throw new Error(
      `${modelProvider} is not supported by this e2e harness; use ${OPENAI_ENV_MODEL_PROVIDER} or ${VERCEL_AI_GATEWAY_MODEL_PROVIDER}.`,
    )
  }

  const apiKeyEnv =
    normalizeEnvString(process.env.MURPH_REAL_CODEX_PROVIDER_ENV_KEY)
    ?? resolveRealCodexProviderApiKeyEnv(modelProvider)
  if (!apiKeyEnv) {
    throw new Error(
      `MURPH_REAL_CODEX_PROVIDER_ENV_KEY is required for ${modelProvider} real Codex e2e.`,
    )
  }
  if (!normalizeEnvString(process.env[apiKeyEnv])) {
    throw new Error(
      `${apiKeyEnv} is required for ${modelProvider} real Codex e2e.`,
    )
  }

  const temporaryPaths: string[] = []
  const codexHome = await mkdtemp(path.join(tmpdir(), 'murph-codex-home-'))
  temporaryPaths.push(codexHome)
  await mkdir(codexHome, {
    recursive: true,
  })
  await writeFile(
    path.join(codexHome, 'config.toml'),
    buildRealCodexConfigToml({
      apiKeyEnv,
      model,
      modelProvider,
    }),
    {
      encoding: 'utf8',
      mode: 0o600,
    },
  )

  return {
    codexHome,
    env: buildRealCodexE2eEnv({
      apiKeyEnv,
    }),
    model,
    modelProvider,
    temporaryPaths,
  }
}

function resolveRealCodexProviderApiKeyEnv(modelProvider: string): string | null {
  if (modelProvider === VERCEL_AI_GATEWAY_MODEL_PROVIDER) {
    return VERCEL_AI_GATEWAY_API_KEY_ENV
  }

  if (modelProvider === OPENAI_ENV_MODEL_PROVIDER) {
    return OPENAI_API_KEY_ENV
  }

  return null
}

function buildRealCodexConfigToml(input: {
  apiKeyEnv: string
  model: string
  modelProvider: string
}): string {
  const baseUrl =
    input.modelProvider === VERCEL_AI_GATEWAY_MODEL_PROVIDER
      ? VERCEL_AI_GATEWAY_BASE_URL
      : OPENAI_BASE_URL
  const providerName =
    input.modelProvider === VERCEL_AI_GATEWAY_MODEL_PROVIDER
      ? 'Vercel AI Gateway'
      : 'OpenAI'

  return [
    `model = ${tomlString(input.model)}`,
    `model_provider = ${tomlString(input.modelProvider)}`,
    'model_reasoning_effort = "low"',
    'approval_policy = "never"',
    'sandbox_mode = "workspace-write"',
    'allow_login_shell = false',
    '',
    '[shell_environment_policy]',
    'inherit = "all"',
    'ignore_default_excludes = false',
    'include_only = [',
    ...REAL_CODEX_E2E_ENV_ALLOWLIST.map((key) => `  ${tomlString(key)},`),
    ']',
    '',
    `[model_providers.${tomlKey(input.modelProvider)}]`,
    `name = ${tomlString(providerName)}`,
    `base_url = ${tomlString(baseUrl)}`,
    `env_key = ${tomlString(input.apiKeyEnv)}`,
    'wire_api = "responses"',
    'request_max_retries = 4',
    'stream_max_retries = 5',
    'supports_websockets = false',
    '',
  ].join('\n')
}

function buildRealCodexE2eEnv(input: {
  apiKeyEnv: string
  sourceEnv?: NodeJS.ProcessEnv
}): NodeJS.ProcessEnv {
  const sourceEnv = input.sourceEnv ?? process.env
  const env: NodeJS.ProcessEnv = {}

  for (const key of REAL_CODEX_E2E_ENV_ALLOWLIST) {
    const value = normalizeEnvString(sourceEnv[key])
    if (value) {
      env[key] = value
    }
  }

  const apiKey = normalizeEnvString(sourceEnv[input.apiKeyEnv])
  if (apiKey) {
    env[input.apiKeyEnv] = apiKey
  }

  return env
}

function normalizeEnvString(value: string | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }

  const normalized = value.trim()
  return normalized.length > 0 ? normalized : null
}

function readPositiveIntegerEnv(value: string | undefined): number | null {
  const normalized = normalizeEnvString(value)
  if (!normalized) {
    return null
  }

  const parsed = Number.parseInt(normalized, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null
}

function readSafeDiagnosticString(
  value: unknown,
  fallback?: string,
): string | null {
  if (typeof value !== 'string') {
    return fallback ?? null
  }

  const normalized = value.trim()
  if (/^[A-Za-z0-9_.:-]+$/u.test(normalized)) {
    return normalized
  }

  return fallback ?? 'present'
}

function readNonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null
}

function readIntegerTokenCount(...values: unknown[]): number {
  for (const value of values) {
    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value
    }
  }

  return 0
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function readString(...values: unknown[]): string | null {
  for (const value of values) {
    if (typeof value !== 'string') {
      continue
    }

    const normalized = value.trim()
    if (normalized.length > 0) {
      return normalized
    }
  }

  return null
}

function tomlString(value: string): string {
  return JSON.stringify(value)
}

function tomlKey(value: string): string {
  return /^[A-Za-z0-9_-]+$/u.test(value) ? value : tomlString(value)
}
