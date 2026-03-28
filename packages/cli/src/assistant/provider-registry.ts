import { generateText } from 'ai'
import type {
  AssistantApprovalPolicy,
  AssistantChatProvider,
  AssistantSandbox,
  AssistantSessionBinding,
} from '../assistant-cli-contracts.js'
import { getAssistantBindingContextLines } from './bindings.js'
import {
  executeCodexPrompt,
  type CodexProgressEvent,
} from '../assistant-codex.js'
import { resolveAssistantLanguageModel } from '../model-harness.js'
import { VaultCliError } from '../vault-cli-errors.js'
import type { AssistantProviderTraceEvent } from './provider-traces.js'
import {
  normalizeAssistantProviderConfig,
  resolveAssistantModelSpecFromProviderConfig,
  type AssistantProviderConfig,
  type AssistantProviderConfigInput,
} from './provider-config.js'
import { normalizeNullableString } from './shared.js'

const OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS = 10 * 60 * 1000
const OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES = 2
const MODEL_DISCOVERY_TIMEOUT_MS = 2_500
const MAX_DISCOVERED_MODELS = 12

export interface AssistantModelCapabilities {
  images: boolean
  pdf: boolean
  reasoning: boolean
  streaming: boolean
  tools: boolean
}

export interface AssistantCatalogModel {
  capabilities: AssistantModelCapabilities
  description: string
  id: string
  label: string
  source: 'current' | 'discovered' | 'manual' | 'static'
}

export interface AssistantModelDiscoveryResult {
  message?: string | null
  models: readonly AssistantCatalogModel[]
  status: 'ok' | 'unauthorized' | 'unreachable' | 'unsupported'
}

export interface AssistantProviderCapabilities {
  supportsDirectCliExecution: boolean
  supportsModelDiscovery: boolean
  supportsReasoningEffort: boolean
}

export interface AssistantProviderTraits {
  resumeKeyMode: 'none' | 'provider-session-id'
  sessionMode: 'stateful' | 'stateless'
  transcriptContextMode: 'local-transcript' | 'provider-session'
  workspaceMode: 'direct-cli' | 'none'
}

export interface AssistantProviderProgressEvent extends CodexProgressEvent {}

export interface AssistantProviderTurnInput {
  abortSignal?: AbortSignal
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  codexCommand?: string | null
  configOverrides?: readonly string[]
  continuityContext?: string | null
  conversationMessages?: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>
  env?: NodeJS.ProcessEnv
  headers?: Record<string, string> | null
  model?: string | null
  onEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  oss?: boolean | null
  profile?: string | null
  prompt?: string | null
  provider?: AssistantChatProvider | null
  providerName?: string | null
  reasoningEffort?: string | null
  resumeProviderSessionId?: string | null
  sandbox?: AssistantSandbox | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  userPrompt?: string | null
  workingDirectory: string
}

export interface AssistantProviderTurnExecutionInput {
  abortSignal?: AbortSignal
  configOverrides?: readonly string[]
  continuityContext?: string | null
  conversationMessages?: ReadonlyArray<{
    content: string
    role: 'assistant' | 'user'
  }>
  env?: NodeJS.ProcessEnv
  onEvent?: ((event: AssistantProviderProgressEvent) => void) | null
  onTraceEvent?: (event: AssistantProviderTraceEvent) => void
  prompt?: string | null
  providerConfig: AssistantProviderConfig
  resumeProviderSessionId?: string | null
  sessionContext?: {
    binding?: AssistantSessionBinding | null
  }
  showThinkingTraces?: boolean
  systemPrompt?: string | null
  userPrompt?: string | null
  workingDirectory: string
}

export interface AssistantProviderUsage {
  apiKeyEnv: string | null
  baseUrl: string | null
  cacheWriteTokens: number | null
  cachedInputTokens: number | null
  inputTokens: number | null
  outputTokens: number | null
  providerMetadataJson: unknown | null
  providerName: string | null
  providerRequestId: string | null
  rawUsageJson: unknown | null
  reasoningTokens: number | null
  requestedModel: string | null
  servedModel: string | null
  totalTokens: number | null
}

export interface AssistantProviderTurnExecutionResult {
  provider: AssistantChatProvider
  providerSessionId: string | null
  rawEvents: unknown[]
  response: string
  stderr: string
  stdout: string
  usage?: AssistantProviderUsage | null
}

interface AssistantProviderDefinition {
  capabilities: AssistantProviderCapabilities
  traits: AssistantProviderTraits
  discoverModels(input: {
    config: AssistantProviderConfig
    env?: NodeJS.ProcessEnv
  }): Promise<AssistantModelDiscoveryResult>
  executeTurn(
    input: AssistantProviderTurnExecutionInput,
  ): Promise<AssistantProviderTurnExecutionResult>
  resolveLabel(config: AssistantProviderConfig): string
  resolveStaticModels(config: AssistantProviderConfig): readonly AssistantCatalogModel[]
}

const DEFAULT_CODEX_MODEL_CAPABILITIES: AssistantModelCapabilities = {
  images: false,
  pdf: false,
  reasoning: true,
  streaming: true,
  tools: true,
}

const DEFAULT_OPENAI_COMPATIBLE_MODEL_CAPABILITIES: AssistantModelCapabilities = {
  images: false,
  pdf: false,
  reasoning: false,
  streaming: true,
  tools: true,
}

const DEFAULT_CODEX_MODELS: readonly AssistantCatalogModel[] = [
  {
    id: 'gpt-5.4',
    label: 'gpt-5.4',
    description: 'Latest frontier agentic coding model.',
    source: 'static',
    capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
  },
  {
    id: 'gpt-5.4-mini',
    label: 'gpt-5.4-mini',
    description: 'Smaller frontier agentic coding model.',
    source: 'static',
    capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
  },
  {
    id: 'gpt-5.3-codex',
    label: 'gpt-5.3-codex',
    description: 'Frontier Codex-optimized agentic coding model.',
    source: 'static',
    capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
  },
  {
    id: 'gpt-5.3-codex-spark',
    label: 'gpt-5.3-codex-spark',
    description: 'Ultra-fast coding model.',
    source: 'static',
    capabilities: DEFAULT_CODEX_MODEL_CAPABILITIES,
  },
] as const

const ASSISTANT_PROVIDER_DEFINITIONS: Record<
  AssistantChatProvider,
  AssistantProviderDefinition
> = {
  'codex-cli': {
    capabilities: {
      supportsDirectCliExecution: true,
      supportsModelDiscovery: false,
      supportsReasoningEffort: true,
    },
    traits: {
      resumeKeyMode: 'provider-session-id',
      sessionMode: 'stateful',
      transcriptContextMode: 'provider-session',
      workspaceMode: 'direct-cli',
    },
    async discoverModels() {
      return {
        models: [],
        status: 'unsupported',
        message: 'Codex model discovery is not available from the local CLI adapter.',
      }
    },
    async executeTurn(input) {
      const providerConfig = input.providerConfig
      if (providerConfig.provider !== 'codex-cli') {
        throw new VaultCliError(
          'ASSISTANT_PROVIDER_UNSUPPORTED',
          'Codex CLI execution requires a Codex provider config.',
        )
      }

      const result = await executeCodexPrompt({
        abortSignal: input.abortSignal,
        approvalPolicy: providerConfig.approvalPolicy ?? undefined,
        codexCommand: providerConfig.codexCommand ?? undefined,
        configOverrides: mergeCodexConfigOverrides({
          configOverrides: input.configOverrides,
          showThinkingTraces: input.showThinkingTraces ?? false,
        }),
        env: input.env,
        model: providerConfig.model ?? undefined,
        onProgress: input.onEvent ?? undefined,
        onTraceEvent: input.onTraceEvent,
        oss: providerConfig.oss,
        profile: providerConfig.profile ?? undefined,
        prompt: resolveAssistantProviderPrompt(input),
        reasoningEffort: providerConfig.reasoningEffort ?? undefined,
        resumeSessionId: input.resumeProviderSessionId,
        sandbox: providerConfig.sandbox ?? undefined,
        workingDirectory: input.workingDirectory,
      })

      return {
        provider: providerConfig.provider,
        providerSessionId: result.sessionId,
        response: result.finalMessage,
        stderr: result.stderr,
        stdout: result.stdout,
        rawEvents: result.jsonEvents,
        usage: extractCodexAssistantProviderUsage({
          providerConfig,
          rawEvents: result.jsonEvents,
        }),
      }
    },
    resolveLabel(config) {
      return config.oss ? 'Codex OSS' : 'Codex CLI'
    },
    resolveStaticModels() {
      return DEFAULT_CODEX_MODELS
    },
  },
  'openai-compatible': {
    capabilities: {
      supportsDirectCliExecution: false,
      supportsModelDiscovery: true,
      supportsReasoningEffort: false,
    },
    traits: {
      resumeKeyMode: 'none',
      sessionMode: 'stateless',
      transcriptContextMode: 'local-transcript',
      workspaceMode: 'none',
    },
    async discoverModels(input) {
      const providerConfig = input.config
      if (providerConfig.provider !== 'openai-compatible') {
        return {
          models: [],
          status: 'unsupported',
          message: 'OpenAI-compatible model discovery requires an OpenAI-compatible provider config.',
        }
      }

      const normalizedBaseUrl = normalizeNullableString(providerConfig.baseUrl)
      if (!normalizedBaseUrl) {
        return {
          models: [],
          status: 'unsupported',
          message: 'OpenAI-compatible model discovery requires a base URL.',
        }
      }

      try {
        const modelsUrl = new URL('models', ensureTrailingSlash(normalizedBaseUrl))
        const timeoutSignal =
          typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal
            ? AbortSignal.timeout(MODEL_DISCOVERY_TIMEOUT_MS)
            : undefined
        const response = await fetch(modelsUrl, {
          headers: buildOpenAICompatibleDiscoveryHeaders({
            config: providerConfig,
            env: input.env,
          }),
          signal: timeoutSignal,
        })

        if (response.status === 401 || response.status === 403) {
          return {
            models: [],
            status: 'unauthorized',
            message: 'The endpoint rejected the configured credentials while discovering models.',
          }
        }

        if (!response.ok) {
          return {
            models: [],
            status: 'unreachable',
            message: `The endpoint returned ${response.status} while discovering models.`,
          }
        }

        const payload = (await response.json()) as {
          data?: Array<{ id?: unknown }>
        }
        const models = normalizeDiscoveredModelIds(
          (payload.data ?? []).map((entry) =>
            typeof entry?.id === 'string' ? entry.id : null,
          ),
        ).map((model) =>
          createCatalogModel({
            id: model,
            description: `Discovered from ${resolveAssistantProviderLabel(providerConfig)}.`,
            source: 'discovered',
            capabilities: DEFAULT_OPENAI_COMPATIBLE_MODEL_CAPABILITIES,
          }),
        )

        return {
          models,
          status: 'ok',
          message: null,
        }
      } catch (error) {
        return {
          models: [],
          status: 'unreachable',
          message:
            error instanceof Error && error.message.trim().length > 0
              ? error.message
              : 'Unable to reach the configured endpoint while discovering models.',
        }
      }
    },
    async executeTurn(input) {
      const providerConfig = input.providerConfig
      if (providerConfig.provider !== 'openai-compatible') {
        throw new VaultCliError(
          'ASSISTANT_PROVIDER_UNSUPPORTED',
          'OpenAI-compatible execution requires an OpenAI-compatible provider config.',
        )
      }

      const languageModelSpec = resolveAssistantModelSpecFromProviderConfig(
        providerConfig,
        {
          ...process.env,
          ...(input.env ?? {}),
        },
      )
      if (!languageModelSpec) {
        if (!providerConfig.baseUrl) {
          throw new VaultCliError(
            'ASSISTANT_BASE_URL_REQUIRED',
            'The openai-compatible assistant provider requires a base URL.',
          )
        }
        throw new VaultCliError(
          'ASSISTANT_MODEL_REQUIRED',
          'The openai-compatible assistant provider requires a model id.',
        )
      }

      const result = await generateText({
        abortSignal: input.abortSignal,
        maxRetries: OPENAI_COMPATIBLE_PROVIDER_MAX_RETRIES,
        messages: buildAssistantProviderMessages(input),
        model: resolveAssistantLanguageModel(languageModelSpec),
        system: normalizeNullableString(input.systemPrompt) ?? undefined,
        timeout: OPENAI_COMPATIBLE_PROVIDER_TIMEOUT_MS,
      })

      return {
        provider: providerConfig.provider,
        providerSessionId: null,
        response: result.text,
        stderr: '',
        stdout: '',
        rawEvents: [],
        usage: extractOpenAICompatibleAssistantProviderUsage({
          providerConfig,
          result,
        }),
      }
    },
    resolveLabel(config) {
      return buildAssistantProviderLabel(config)
    },
    resolveStaticModels() {
      return []
    },
  },
}

function extractOpenAICompatibleAssistantProviderUsage(input: {
  providerConfig: Extract<AssistantProviderConfig, { provider: 'openai-compatible' }>
  result: unknown
}): AssistantProviderUsage {
  const resultRecord = readAssistantProviderRecord(input.result)
  const usageRecord =
    readAssistantProviderRecord(resultRecord?.totalUsage) ??
    readAssistantProviderRecord(resultRecord?.usage)
  const providerMetadata = readAssistantProviderRecord(resultRecord?.providerMetadata)
  const rawRecord = readAssistantProviderRecord(resultRecord?.raw)
  const responseRecord = readAssistantProviderRecord(resultRecord?.response)
  const requestRecord = readAssistantProviderRecord(resultRecord?.request)
  const inputTokens =
    readAssistantProviderInteger(
      usageRecord,
      'inputTokens',
      'promptTokens',
      'prompt_tokens',
      'input_tokens',
    ) ??
    readAssistantProviderInteger(rawRecord, 'inputTokens', 'promptTokens')
  const outputTokens =
    readAssistantProviderInteger(
      usageRecord,
      'outputTokens',
      'completionTokens',
      'completion_tokens',
      'output_tokens',
    ) ??
    readAssistantProviderInteger(rawRecord, 'outputTokens', 'completionTokens')

  return {
    apiKeyEnv: input.providerConfig.apiKeyEnv,
    baseUrl: input.providerConfig.baseUrl,
    cacheWriteTokens: readAssistantProviderInteger(
      usageRecord,
      'cacheWriteTokens',
      'cache_write_tokens',
    ),
    cachedInputTokens: readAssistantProviderInteger(
      usageRecord,
      'cachedInputTokens',
      'cached_input_tokens',
    ),
    inputTokens,
    outputTokens,
    providerMetadataJson: providerMetadata ?? null,
    providerName: input.providerConfig.providerName,
    providerRequestId: readAssistantProviderString(
      responseRecord?.requestId,
      responseRecord?.id,
      requestRecord?.id,
      rawRecord?.id,
    ),
    rawUsageJson:
      usageRecord
      ?? readAssistantProviderRecord(resultRecord?.usage)
      ?? rawRecord
      ?? null,
    reasoningTokens: readAssistantProviderInteger(
      usageRecord,
      'reasoningTokens',
      'reasoning_tokens',
    ),
    requestedModel: input.providerConfig.model,
    servedModel: readAssistantProviderString(
      responseRecord?.modelId,
      responseRecord?.model,
      rawRecord?.model,
      providerMetadata?.model,
    ) ?? input.providerConfig.model,
    totalTokens:
      readAssistantProviderInteger(usageRecord, 'totalTokens', 'total_tokens')
      ?? resolveAssistantProviderTotalTokens({
        inputTokens,
        outputTokens,
      }),
  }
}

function extractCodexAssistantProviderUsage(input: {
  providerConfig: Extract<AssistantProviderConfig, { provider: 'codex-cli' }>
  rawEvents: readonly unknown[]
}): AssistantProviderUsage {
  const completionEvent = findAssistantCodexCompletionEvent(input.rawEvents)
  const completionRecord = completionEvent ? readAssistantProviderRecord(completionEvent) : null
  const usageRecord =
    readAssistantProviderRecord(completionRecord?.usage) ??
    readAssistantProviderRecord(readAssistantProviderRecord(completionRecord?.turn)?.usage) ??
    readAssistantProviderRecord(readAssistantProviderRecord(completionRecord?.metrics)?.usage) ??
    null
  const inputTokens = readAssistantProviderInteger(
    usageRecord ?? completionRecord,
    'inputTokens',
    'input_tokens',
  )
  const outputTokens = readAssistantProviderInteger(
    usageRecord ?? completionRecord,
    'outputTokens',
    'output_tokens',
  )

  return {
    apiKeyEnv: input.providerConfig.apiKeyEnv,
    baseUrl: input.providerConfig.baseUrl,
    cacheWriteTokens: readAssistantProviderInteger(
      usageRecord ?? completionRecord,
      'cacheWriteTokens',
      'cache_write_tokens',
    ),
    cachedInputTokens: readAssistantProviderInteger(
      usageRecord ?? completionRecord,
      'cachedInputTokens',
      'cached_input_tokens',
    ),
    inputTokens,
    outputTokens,
    providerMetadataJson: completionRecord ?? null,
    providerName: input.providerConfig.providerName,
    providerRequestId: readAssistantProviderString(
      completionRecord?.request_id,
      completionRecord?.requestId,
      completionRecord?.id,
    ),
    rawUsageJson: usageRecord ?? completionRecord ?? null,
    reasoningTokens: readAssistantProviderInteger(
      usageRecord ?? completionRecord,
      'reasoningTokens',
      'reasoning_tokens',
    ),
    requestedModel: input.providerConfig.model,
    servedModel: readAssistantProviderString(
      completionRecord?.model,
      completionRecord?.model_id,
      completionRecord?.modelId,
    ) ?? input.providerConfig.model,
    totalTokens:
      readAssistantProviderInteger(usageRecord ?? completionRecord, 'totalTokens', 'total_tokens')
      ?? resolveAssistantProviderTotalTokens({
        inputTokens,
        outputTokens,
      }),
  }
}

function findAssistantCodexCompletionEvent(
  rawEvents: readonly unknown[],
): Record<string, unknown> | null {
  for (let index = rawEvents.length - 1; index >= 0; index -= 1) {
    const record = readAssistantProviderRecord(rawEvents[index])
    const eventType = readAssistantProviderString(record?.type, record?.event)

    if (eventType === 'turn.completed' || eventType === 'turn/completed') {
      return record ?? null
    }
  }

  return null
}

function readAssistantProviderRecord(
  value: unknown,
): Record<string, unknown> | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  return value as Record<string, unknown>
}

function readAssistantProviderString(
  ...values: unknown[]
): string | null {
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

function readAssistantProviderInteger(
  record: Record<string, unknown> | null | undefined,
  ...keys: string[]
): number | null {
  if (!record) {
    return null
  }

  for (const key of keys) {
    const value = record[key]

    if (typeof value === 'number' && Number.isInteger(value) && value >= 0) {
      return value
    }
  }

  return null
}

function resolveAssistantProviderTotalTokens(input: {
  inputTokens: number | null
  outputTokens: number | null
}): number | null {
  if (input.inputTokens === null && input.outputTokens === null) {
    return null
  }

  return (input.inputTokens ?? 0) + (input.outputTokens ?? 0)
}

function resolveAssistantProviderDefinition(
  provider: AssistantChatProvider,
): AssistantProviderDefinition {
  return ASSISTANT_PROVIDER_DEFINITIONS[provider]
}

export function resolveAssistantProviderCapabilities(
  provider: AssistantChatProvider,
): AssistantProviderCapabilities {
  return {
    ...resolveAssistantProviderDefinition(provider).capabilities,
  }
}

export function resolveAssistantProviderTraits(
  provider: AssistantChatProvider,
): AssistantProviderTraits {
  return {
    ...resolveAssistantProviderDefinition(provider).traits,
  }
}

export function resolveAssistantProviderLabel(
  input: AssistantProviderConfigInput | null | undefined,
): string {
  const normalized = normalizeAssistantProviderConfig(input)
  const definition = resolveAssistantProviderDefinition(normalized.provider)
  return definition.resolveLabel(normalized)
}

export async function discoverAssistantProviderModels(input: {
  apiKeyEnv?: string | null
  baseUrl?: string | null
  env?: NodeJS.ProcessEnv
  headers?: Record<string, string> | null
  provider: AssistantChatProvider
  providerName?: string | null
}): Promise<AssistantModelDiscoveryResult> {
  const normalized = normalizeAssistantProviderConfig(input)
  return resolveAssistantProviderDefinition(normalized.provider).discoverModels({
    config: normalized,
    env: input.env,
  })
}

export function resolveAssistantProviderStaticModels(
  input: AssistantProviderConfigInput | null | undefined,
): readonly AssistantCatalogModel[] {
  const normalized = normalizeAssistantProviderConfig(input)
  return resolveAssistantProviderDefinition(normalized.provider).resolveStaticModels(
    normalized,
  )
}

export async function executeAssistantProviderTurnWithDefinition(
  input: AssistantProviderTurnExecutionInput,
): Promise<AssistantProviderTurnExecutionResult> {
  return await resolveAssistantProviderDefinition(input.providerConfig.provider).executeTurn(
    input,
  )
}

export async function executeAssistantProviderTurn(
  input: AssistantProviderTurnInput,
): Promise<AssistantProviderTurnExecutionResult> {
  const providerConfig = normalizeAssistantProviderConfig(input)

  return await executeAssistantProviderTurnWithDefinition({
    abortSignal: input.abortSignal,
    configOverrides: input.configOverrides,
    continuityContext: input.continuityContext,
    conversationMessages: input.conversationMessages,
    env: input.env,
    onEvent: input.onEvent,
    onTraceEvent: input.onTraceEvent,
    prompt: input.prompt,
    providerConfig,
    resumeProviderSessionId: input.resumeProviderSessionId,
    sessionContext: input.sessionContext,
    showThinkingTraces: input.showThinkingTraces,
    systemPrompt: input.systemPrompt,
    userPrompt: input.userPrompt,
    workingDirectory: input.workingDirectory,
  })
}

export function shouldUseAssistantLocalTranscriptContext(
  provider: AssistantChatProvider,
): boolean {
  return (
    resolveAssistantProviderDefinition(provider).traits.transcriptContextMode ===
    'local-transcript'
  )
}

export function createCatalogModel(input: {
  capabilities: AssistantModelCapabilities
  description: string
  id: string
  source: AssistantCatalogModel['source']
}): AssistantCatalogModel {
  return {
    id: input.id,
    label: input.id,
    description: input.description,
    source: input.source,
    capabilities: {
      ...input.capabilities,
    },
  }
}

function normalizeDiscoveredModelIds(
  models: readonly (string | null | undefined)[],
): string[] {
  const normalizedModels = models
    .map((model) => normalizeNullableString(model))
    .filter((model): model is string => Boolean(model))

  return [...new Set(normalizedModels)].slice(0, MAX_DISCOVERED_MODELS)
}

function buildOpenAICompatibleDiscoveryHeaders(input: {
  config: Extract<AssistantProviderConfig, { provider: 'openai-compatible' }>
  env?: NodeJS.ProcessEnv
}): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...(input.config.headers ?? {}),
  }
  const env = {
    ...process.env,
    ...(input.env ?? {}),
  }
  const apiKeyEnv = normalizeNullableString(input.config.apiKeyEnv)
  const apiKeyValue =
    apiKeyEnv && typeof env[apiKeyEnv] === 'string' && env[apiKeyEnv].trim().length > 0
      ? env[apiKeyEnv].trim()
      : null

  if (apiKeyValue && !('Authorization' in headers)) {
    headers.Authorization = `Bearer ${apiKeyValue}`
  }

  return headers
}

function buildAssistantProviderLabel(config: AssistantProviderConfig): string {
  const explicitProviderName = normalizeNullableString(config.providerName)
  if (explicitProviderName) {
    return explicitProviderName
  }

  if (config.provider === 'codex-cli') {
    return config.oss ? 'Codex OSS' : 'Codex CLI'
  }

  const normalizedBaseUrl = normalizeNullableString(config.baseUrl)
  if (!normalizedBaseUrl) {
    return 'OpenAI-compatible endpoint'
  }

  try {
    const parsed = new URL(normalizedBaseUrl)
    return parsed.host
      ? `OpenAI-compatible endpoint at ${parsed.host}`
      : 'OpenAI-compatible endpoint'
  } catch {
    return 'OpenAI-compatible endpoint'
  }
}

function ensureTrailingSlash(baseUrl: string): string {
  return baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`
}

function normalizeConversationMessages(
  messages: AssistantProviderTurnExecutionInput['conversationMessages'],
): Array<{
  content: string
  role: 'assistant' | 'user'
}> {
  return (messages ?? [])
    .map((message) => ({
      role: message.role,
      content: message.content.trim(),
    }))
    .filter((message) => message.content.length > 0)
}

function resolveAssistantProviderPrompt(
  input: AssistantProviderTurnExecutionInput,
): string {
  const explicitPrompt = normalizeNullableString(input.prompt)
  if (explicitPrompt) {
    return explicitPrompt
  }

  const userPrompt = normalizeNullableString(input.userPrompt)
  if (!userPrompt) {
    throw new Error(
      'Assistant provider turns require either prompt or userPrompt.',
    )
  }

  const systemPrompt = normalizeNullableString(input.systemPrompt)
  const contextLines =
    input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.sessionContext.binding)
      : []

  return [
    systemPrompt,
    contextLines.length > 0
      ? `Conversation context:\n${contextLines.join('\n')}`
      : null,
    normalizeNullableString(input.continuityContext),
    `User message:\n${userPrompt}`,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n\n')
}

function buildAssistantProviderMessages(
  input: AssistantProviderTurnExecutionInput,
): Array<{
  content: string
  role: 'assistant' | 'user'
}> {
  const messages = normalizeConversationMessages(input.conversationMessages)
  const prompt = normalizeNullableString(input.prompt)
  if (prompt) {
    messages.push({
      role: 'user',
      content: prompt,
    })
    return messages
  }

  const userPrompt = normalizeNullableString(input.userPrompt)
  if (!userPrompt) {
    throw new Error(
      'Assistant provider turns require either prompt or userPrompt.',
    )
  }

  const sessionContextLines =
    input.sessionContext?.binding
      ? getAssistantBindingContextLines(input.sessionContext.binding)
      : []
  const continuityContext = normalizeNullableString(input.continuityContext)
  const userParts = [
    sessionContextLines.length > 0
      ? `Conversation context:\n${sessionContextLines.join('\n')}`
      : null,
    continuityContext,
    userPrompt,
  ].filter((part): part is string => Boolean(part))

  messages.push({
    role: 'user',
    content: userParts.join('\n\n'),
  })
  return messages
}

function mergeCodexConfigOverrides(input: {
  configOverrides?: readonly string[]
  showThinkingTraces: boolean
}): readonly string[] | undefined {
  const overrides = [...(input.configOverrides ?? [])]

  if (!input.showThinkingTraces) {
    return overrides.length > 0 ? overrides : input.configOverrides
  }

  upsertCodexConfigOverride(overrides, 'model_reasoning_summary', '"auto"')
  upsertCodexConfigOverride(overrides, 'hide_agent_reasoning', 'false')

  return overrides
}

function upsertCodexConfigOverride(
  overrides: string[],
  key: string,
  value: string,
): void {
  const assignmentPrefix = `${key}=`
  const existingIndex = overrides.findIndex((override) =>
    override.trim().startsWith(assignmentPrefix),
  )

  if (existingIndex >= 0) {
    overrides[existingIndex] = `${key}=${value}`
    return
  }

  overrides.push(`${key}=${value}`)
}
