import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { normalizeAssistantProviderConfig } from '@murphai/operator-config/assistant/provider-config'
import { describe, expect, it } from 'vitest'

import { executeCodexAppServerTurn } from '../src/assistant-codex.ts'
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

describeRealCodex('real Codex app-server cache usage e2e', () => {
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
        await Promise.all(
          config.temporaryPaths.map((targetPath) =>
            rm(targetPath, {
              force: true,
              recursive: true,
            })
          ),
        )
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

    const result = await executeCodexAppServerTurn({
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
    await rm(workingDirectory, {
      force: true,
      recursive: true,
    })
  }
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
      totalTokens: total.totalTokens + event.last.totalTokens,
    }),
    {
      cachedInputTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
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
    totalTokens: readIntegerTokenCount(record.totalTokens, record.total_tokens),
  }
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
    'request_max_retries = 0',
    'stream_max_retries = 0',
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
