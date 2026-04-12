import {
  assistantProviderSessionOptionsSchema,
  type AssistantApprovalPolicy,
  type AssistantChatProvider,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
} from '../assistant-cli-contracts.js'
import { splitAssistantHeadersForPersistence } from './redaction.js'
import { normalizeNullableString } from './shared.js'
import {
  normalizeAssistantWebSearchMode,
  resolveAssistantRuntimeTarget,
  shouldAssistantTargetUseGatewayWebSearch,
  shouldAssistantTargetUseMurphWebSearch,
  shouldAssistantTargetUseProviderWebSearch,
  type AssistantResolvedRuntimeTarget,
  type AssistantWebSearchMode,
} from './target-runtime.js'
import {
  resolveOpenAICompatibleProviderPresetFromId,
  type SetupAssistantProviderPreset,
} from './openai-compatible-provider-presets.js'

export interface AssistantProviderConfig {
  approvalPolicy: AssistantApprovalPolicy | null
  apiKeyEnv: string | null
  baseUrl: string | null
  codexCommand: string | null
  codexHome: string | null
  headers: Record<string, string> | null
  model: string | null
  oss: boolean
  presetId: SetupAssistantProviderPreset | null
  profile: string | null
  provider: AssistantChatProvider
  providerName: string | null
  reasoningEffort: string | null
  sandbox: AssistantSandbox | null
  webSearch: AssistantWebSearchMode | null
  zeroDataRetention: boolean | null
}

export const DEFAULT_MURPH_CODEX_REASONING_EFFORT = 'medium'

export type AssistantProviderConfigInput = {
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  codexCommand?: string | null
  codexHome?: string | null
  headers?: Record<string, string> | null
  model?: string | null
  oss?: boolean | null
  presetId?: string | null
  profile?: string | null
  provider?: AssistantChatProvider | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  webSearch?: string | null
  zeroDataRetention?: boolean | null
}

const ASSISTANT_PROVIDER_CONFIG_FIELDS = [
  'approvalPolicy',
  'apiKeyEnv',
  'baseUrl',
  'codexCommand',
  'codexHome',
  'headers',
  'model',
  'oss',
  'presetId',
  'profile',
  'providerName',
  'reasoningEffort',
  'sandbox',
  'webSearch',
  'zeroDataRetention',
] as const satisfies readonly (keyof AssistantProviderConfigInput)[]

export function resolveAssistantProvider(
  provider: AssistantChatProvider | null | undefined,
): AssistantChatProvider {
  return provider ?? 'codex-cli'
}

export function inferAssistantProviderFromConfigInput(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantChatProvider | null {
  if (input?.provider) {
    return input.provider
  }

  if (
    normalizeNullableString(input?.baseUrl) ||
    normalizeNullableString(input?.apiKeyEnv) ||
    normalizeNullableString(input?.providerName) ||
    normalizeAssistantPresetId(input?.presetId) ||
    normalizeAssistantHeaders(input?.headers) ||
    normalizeAssistantWebSearchMode(input?.webSearch) ||
    input?.zeroDataRetention === true
  ) {
    return 'openai-compatible'
  }

  if (
    normalizeNullableString(input?.codexCommand) ||
    normalizeNullableString(input?.codexHome) ||
    normalizeNullableString(input?.profile) ||
    input?.approvalPolicy !== null && input?.approvalPolicy !== undefined ||
    input?.sandbox !== null && input?.sandbox !== undefined ||
    input?.oss === true
  ) {
    return 'codex-cli'
  }

  return null
}

export function normalizeAssistantProviderConfig(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderConfig {
  return sanitizeAssistantProviderConfig(
    resolveAssistantProvider(inferAssistantProviderFromConfigInput(input)),
    input,
  )
}

export function sanitizeAssistantProviderConfig(
  provider: AssistantChatProvider,
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderConfig {
  switch (provider) {
    case 'openai-compatible':
      return sanitizeOpenAiCompatibleProviderConfig({
        provider,
        approvalPolicy: null,
        apiKeyEnv: normalizeNullableString(input?.apiKeyEnv),
        baseUrl: normalizeNullableString(input?.baseUrl),
        codexCommand: null,
        codexHome: null,
        headers: normalizeAssistantHeaders(input?.headers),
        model: normalizeNullableString(input?.model),
        oss: false,
        presetId: normalizeAssistantPresetId(input?.presetId),
        profile: null,
        providerName: normalizeNullableString(input?.providerName),
        reasoningEffort: normalizeNullableString(input?.reasoningEffort),
        sandbox: null,
        webSearch: normalizeAssistantWebSearchMode(input?.webSearch),
        zeroDataRetention: input?.zeroDataRetention === true ? true : null,
      })
    case 'codex-cli':
    default:
      return {
        provider: 'codex-cli',
        approvalPolicy: input?.approvalPolicy ?? null,
        apiKeyEnv: null,
        baseUrl: null,
        codexCommand: normalizeNullableString(input?.codexCommand),
        codexHome: normalizeNullableString(input?.codexHome),
        headers: null,
        model: normalizeNullableString(input?.model),
        oss: input?.oss === true,
        presetId: null,
        profile: normalizeNullableString(input?.profile),
        providerName: null,
        reasoningEffort:
          normalizeNullableString(input?.reasoningEffort) ??
          DEFAULT_MURPH_CODEX_REASONING_EFFORT,
        sandbox: input?.sandbox ?? null,
        webSearch: null,
        zeroDataRetention: null,
      }
  }
}

function sanitizeOpenAiCompatibleProviderConfig(
  config: AssistantProviderConfig,
): AssistantProviderConfig {
  const resolved = resolveAssistantRuntimeTarget(config)

  return {
    ...config,
    presetId: resolved.presetId,
    zeroDataRetention:
      resolved.supportsZeroDataRetention && config.zeroDataRetention === true
        ? true
        : null,
  }
}

export function mergeAssistantProviderConfigsForProvider(
  provider: AssistantChatProvider,
  ...inputs: ReadonlyArray<AssistantProviderConfigInput | null | undefined>
): AssistantProviderConfig {
  const merged: AssistantProviderConfigInput = {
    provider,
  }

  for (const input of inputs) {
    if (!input) {
      continue
    }

    for (const field of ASSISTANT_PROVIDER_CONFIG_FIELDS) {
      if (!(field in input)) {
        continue
      }

      ;(merged as Record<string, unknown>)[field] = (
        input as Record<string, unknown>
      )[field]
    }
  }

  return sanitizeAssistantProviderConfig(provider, merged)
}

export function mergeAssistantProviderConfigs(
  ...inputs: ReadonlyArray<AssistantProviderConfigInput | null | undefined>
): AssistantProviderConfig {
  let provider: AssistantChatProvider = 'codex-cli'

  for (const input of inputs) {
    const inferredProvider = inferAssistantProviderFromConfigInput(input)
    if (inferredProvider) {
      provider = inferredProvider
    }
  }

  return mergeAssistantProviderConfigsForProvider(provider, ...inputs)
}

export function compactAssistantProviderConfigInput(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderConfigInput | null {
  if (!input) {
    return null
  }

  const compacted: AssistantProviderConfigInput = {}

  if (input.provider) {
    compacted.provider = input.provider
  }

  for (const field of ASSISTANT_PROVIDER_CONFIG_FIELDS) {
    const value = input[field]
    if (value === null || value === undefined) {
      continue
    }

    ;(compacted as Record<string, unknown>)[field] = value
  }

  return Object.keys(compacted).length > 0 ? compacted : null
}

export function serializeAssistantProviderSessionOptions(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderSessionOptions {
  const normalized = normalizeAssistantProviderConfig(input)
  const resolved = resolveAssistantRuntimeTarget(normalized)

  return assistantProviderSessionOptionsSchema.parse({
    continuityFingerprint: resolved.continuityFingerprint,
    executionDriver: resolved.executionDriver,
    model: normalized.model,
    reasoningEffort: normalized.reasoningEffort,
    resumeKind: resolved.resumeKind,
    sandbox: normalized.sandbox,
    approvalPolicy: normalized.approvalPolicy,
    profile: normalized.profile,
    oss: normalized.oss,
    ...(normalized.codexHome ? { codexHome: normalized.codexHome } : {}),
    ...(normalized.baseUrl ? { baseUrl: normalized.baseUrl } : {}),
    ...(normalized.apiKeyEnv ? { apiKeyEnv: normalized.apiKeyEnv } : {}),
    ...(normalized.providerName ? { providerName: normalized.providerName } : {}),
    ...(normalized.provider === 'openai-compatible' && resolved.presetId
      ? { presetId: resolved.presetId }
      : {}),
    ...(normalized.provider === 'openai-compatible' && normalized.headers
      ? { headers: normalized.headers }
      : {}),
    ...(normalized.provider === 'openai-compatible' && normalized.webSearch
      ? { webSearch: normalized.webSearch }
      : {}),
    ...(normalized.provider === 'openai-compatible' && normalized.zeroDataRetention
      ? { zeroDataRetention: true }
      : {}),
  })
}

export function serializeAssistantProviderOperatorDefaults(
  input: AssistantProviderConfigInput | null | undefined,
): Omit<AssistantProviderConfig, 'provider'> {
  const normalized = normalizeAssistantProviderConfig(input)
  return {
    codexCommand: normalized.codexCommand,
    codexHome: normalized.codexHome,
    model: normalized.model,
    reasoningEffort: normalized.reasoningEffort,
    sandbox: normalized.sandbox,
    approvalPolicy: normalized.approvalPolicy,
    profile: normalized.profile,
    oss: normalized.oss,
    baseUrl: normalized.baseUrl,
    apiKeyEnv: normalized.apiKeyEnv,
    presetId: normalized.presetId,
    providerName: normalized.providerName,
    headers:
      normalized.provider === 'openai-compatible'
        ? normalizeAssistantPersistedHeaders(normalized.headers)
        : null,
    webSearch:
      normalized.provider === 'openai-compatible' ? normalized.webSearch : null,
    zeroDataRetention:
      normalized.provider === 'openai-compatible' && normalized.zeroDataRetention
        ? true
        : null,
  }
}

export function normalizeAssistantPersistedHeaders(
  headers: Record<string, string> | null | undefined,
): Record<string, string> | null {
  const normalizedHeaders = normalizeAssistantHeaders(headers)

  return splitAssistantHeadersForPersistence(normalizedHeaders).persistedHeaders
}

export function assistantProviderConfigsEqual(
  left: AssistantProviderConfigInput | null | undefined,
  right: AssistantProviderConfigInput | null | undefined,
): boolean {
  const normalizedLeft = normalizeAssistantProviderConfig(left)
  const normalizedRight = normalizeAssistantProviderConfig(right)

  if (normalizedLeft.provider !== normalizedRight.provider) {
    return false
  }

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
}

export function resolveAssistantProviderRuntimeTarget(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantResolvedRuntimeTarget {
  return resolveAssistantRuntimeTarget(normalizeAssistantProviderConfig(input))
}

export function resolveAssistantProviderContinuityFingerprint(
  input: AssistantProviderConfigInput | null | undefined,
): string {
  return resolveAssistantProviderRuntimeTarget(input).continuityFingerprint
}

export function shouldUseAssistantOpenAIResponsesApi(
  input: AssistantProviderConfigInput | null | undefined,
): boolean {
  return (
    resolveAssistantProviderRuntimeTarget(input).executionDriver ===
    'openai-responses'
  )
}

export function supportsAssistantNativeResume(
  input: AssistantProviderConfigInput | null | undefined,
): boolean {
  return resolveAssistantProviderRuntimeTarget(input).supportsNativeResume
}

export function supportsAssistantReasoningEffort(
  input: AssistantProviderConfigInput | null | undefined,
): boolean {
  return resolveAssistantProviderRuntimeTarget(input).supportsReasoningEffort
}

export function supportsAssistantZeroDataRetention(
  input: AssistantProviderConfigInput | null | undefined,
): boolean {
  return resolveAssistantProviderRuntimeTarget(input).supportsZeroDataRetention
}

export function shouldAssistantProviderUseProviderWebSearch(
  input: AssistantProviderConfigInput | null | undefined,
): boolean {
  return shouldAssistantTargetUseProviderWebSearch(
    normalizeAssistantProviderConfig(input),
  )
}

export function shouldAssistantProviderUseGatewayWebSearch(
  input: AssistantProviderConfigInput | null | undefined,
): boolean {
  return shouldAssistantTargetUseGatewayWebSearch(
    normalizeAssistantProviderConfig(input),
  )
}

export function shouldAssistantProviderUseMurphWebSearch(
  input: AssistantProviderConfigInput | null | undefined,
): boolean {
  return shouldAssistantTargetUseMurphWebSearch(
    normalizeAssistantProviderConfig(input),
  )
}

export function normalizeAssistantHeaders(
  headers: Record<string, string> | null | undefined,
): Record<string, string> | null {
  if (!headers || typeof headers !== 'object') {
    return null
  }

  const dedupedEntries = new Map<string, readonly [string, string]>()

  for (const [rawKey, rawValue] of Object.entries(headers)) {
    const key = normalizeNullableString(rawKey)
    const value = normalizeNullableString(rawValue)
    if (!key || !value) {
      continue
    }

    const normalizedKey = canonicalizeAssistantHeaderName(key)
    dedupedEntries.set(normalizedKey.toLowerCase(), [normalizedKey, value])
  }

  const normalizedEntries = [...dedupedEntries.values()].sort(([left], [right]) =>
    left.localeCompare(right),
  )

  return normalizedEntries.length > 0
    ? Object.fromEntries(normalizedEntries)
    : null
}

function normalizeAssistantPresetId(
  value: SetupAssistantProviderPreset | string | null | undefined,
): SetupAssistantProviderPreset | null {
  return resolveOpenAICompatibleProviderPresetFromId(value)?.id ?? null
}

function canonicalizeAssistantHeaderName(key: string): string {
  return key
    .split('-')
    .map((part) => {
      const normalizedPart = part.trim().toLowerCase()
      if (normalizedPart.length === 0) {
        return ''
      }

      return `${normalizedPart[0]?.toUpperCase() ?? ''}${normalizedPart.slice(1)}`
    })
    .filter((part) => part.length > 0)
    .join('-')
}
