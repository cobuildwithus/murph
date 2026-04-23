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
  type AssistantTargetVia,
  type AssistantWebSearchMode,
} from './target-runtime.js'
import {
  resolveOpenAICompatibleProviderPresetFromId,
  resolveOpenAICompatibleProviderTargetPresetId,
  type SetupAssistantProviderPreset,
} from './openai-compatible-provider-presets.js'

export interface AssistantCodexTargetConfig {
  kind: 'codex-cli'
  codexCommand: string | null
  codexHome: string | null
  model: string | null
  oss: boolean
  profile: string | null
}

export interface AssistantResponsesTargetConfig {
  kind: 'responses'
  via: AssistantTargetVia
  apiKeyEnv: string | null
  baseUrl: string | null
  gatewayOnlyProviders?: readonly string[] | null
  headers: Record<string, string> | null
  model: string | null
  presetId: SetupAssistantProviderPreset | null
  providerName: string | null
}

export interface AssistantOpenAICompatibleTargetConfig {
  kind: 'openai-compatible'
  apiKeyEnv: string | null
  baseUrl: string | null
  gatewayOnlyProviders?: readonly string[] | null
  headers: Record<string, string> | null
  model: string | null
  presetId: SetupAssistantProviderPreset | null
  providerName: string | null
}

export type AssistantProviderTargetConfig =
  | AssistantCodexTargetConfig
  | AssistantResponsesTargetConfig
  | AssistantOpenAICompatibleTargetConfig

export interface AssistantProviderPolicyConfig {
  approvalPolicy: AssistantApprovalPolicy | null
  reasoningEffort: string | null
  sandbox: AssistantSandbox | null
  webSearch: AssistantWebSearchMode | null
  zeroDataRetention: boolean | null
}

export interface AssistantProviderConfig {
  policy: AssistantProviderPolicyConfig
  target: AssistantProviderTargetConfig
}

export interface AssistantProviderDefaultsConfig {
  approvalPolicy: AssistantApprovalPolicy | null
  apiKeyEnv: string | null
  baseUrl: string | null
  codexCommand: string | null
  codexHome: string | null
  gatewayOnlyProviders?: readonly string[] | null
  headers: Record<string, string> | null
  model: string | null
  oss: boolean
  presetId: SetupAssistantProviderPreset | null
  profile: string | null
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
  gatewayOnlyProviders?: readonly string[] | null
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

export type AssistantProviderConfigLike =
  | AssistantProviderConfigInput
  | AssistantProviderConfig

const ASSISTANT_PROVIDER_CONFIG_FIELDS = [
  'approvalPolicy',
  'apiKeyEnv',
  'baseUrl',
  'codexCommand',
  'codexHome',
  'gatewayOnlyProviders',
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
  return input?.provider ?? null
}

export function normalizeAssistantProviderConfig(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderConfig {
  const providerConfigInput = isAssistantProviderConfig(input)
    ? assistantProviderConfigToInput(input)
    : input

  return sanitizeAssistantProviderConfig(
    resolveAssistantProvider(
      resolveAssistantProviderForNormalization(providerConfigInput),
    ),
    providerConfigInput,
  )
}

export function sanitizeAssistantProviderConfig(
  provider: AssistantChatProvider,
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderConfig {
  const policy: AssistantProviderPolicyConfig = {
    approvalPolicy: provider === 'codex-cli' ? input?.approvalPolicy ?? null : null,
    reasoningEffort:
      normalizeNullableString(input?.reasoningEffort) ??
      (provider === 'codex-cli' ? DEFAULT_MURPH_CODEX_REASONING_EFFORT : null),
    sandbox: provider === 'codex-cli' ? input?.sandbox ?? null : null,
    webSearch:
      provider === 'openai-compatible'
        ? normalizeAssistantWebSearchMode(input?.webSearch)
        : null,
    zeroDataRetention:
      provider === 'openai-compatible' && input?.zeroDataRetention === true
        ? true
        : null,
  }

  if (provider === 'codex-cli') {
    const target: AssistantCodexTargetConfig = {
      kind: 'codex-cli',
      codexCommand: normalizeNullableString(input?.codexCommand),
      codexHome: normalizeNullableString(input?.codexHome),
      model: normalizeNullableString(input?.model),
      oss: input?.oss === true,
      profile: normalizeNullableString(input?.profile),
    }

    return {
      policy,
      target,
    }
  }

  const presetId = resolveAssistantCompatiblePresetId(input)
  const resolved = resolveAssistantRuntimeTarget({
    apiKeyEnv: input?.apiKeyEnv,
    baseUrl: input?.baseUrl,
    gatewayOnlyProviders: input?.gatewayOnlyProviders,
    headers: input?.headers,
    model: input?.model,
    presetId,
    provider: 'openai-compatible',
    providerName: input?.providerName,
    reasoningEffort: policy.reasoningEffort,
    webSearch: policy.webSearch,
    zeroDataRetention: policy.zeroDataRetention,
  })

  const normalizedBaseUrl = normalizeNullableString(input?.baseUrl)
  const normalizedProviderName = normalizeNullableString(input?.providerName)
  const gatewayOnlyProviders = isAssistantGatewayOnlyProviderTarget({
    baseUrl: normalizedBaseUrl,
    presetId: resolved.presetId,
    providerName: normalizedProviderName,
  })
    ? normalizeAssistantGatewayOnlyProviders(input?.gatewayOnlyProviders)
    : null
  const sharedTargetFields = {
    apiKeyEnv: normalizeNullableString(input?.apiKeyEnv),
    baseUrl: normalizedBaseUrl,
    gatewayOnlyProviders,
    headers: normalizeAssistantHeaders(input?.headers),
    model: normalizeNullableString(input?.model),
    presetId: resolved.presetId,
    providerName: normalizedProviderName,
  }

  const nextPolicy: AssistantProviderPolicyConfig = {
    ...policy,
    zeroDataRetention:
      resolved.supportsZeroDataRetention && policy.zeroDataRetention === true
        ? true
        : null,
  }
  const target: AssistantProviderTargetConfig =
    resolved.target.kind === 'responses'
      ? {
          kind: 'responses',
          via: resolved.target.via,
          ...sharedTargetFields,
        }
      : {
          kind: 'openai-compatible',
          ...sharedTargetFields,
        }

  return {
    policy: nextPolicy,
    target,
  }
}

export function resolveAssistantChatProviderFromConfig(
  config: AssistantProviderConfig,
): AssistantChatProvider {
  return config.target.kind === 'codex-cli' ? 'codex-cli' : 'openai-compatible'
}

export function isAssistantCodexTargetConfig(
  config: AssistantProviderConfig,
): config is AssistantProviderConfig & { target: AssistantCodexTargetConfig } {
  return config.target.kind === 'codex-cli'
}

export function isAssistantResponsesTargetConfig(
  config: AssistantProviderConfig,
): config is AssistantProviderConfig & { target: AssistantResponsesTargetConfig } {
  return config.target.kind === 'responses'
}

export function isAssistantOpenAICompatibleTargetConfig(
  config: AssistantProviderConfig,
): config is
  | (AssistantProviderConfig & { target: AssistantOpenAICompatibleTargetConfig })
  | (AssistantProviderConfig & { target: AssistantResponsesTargetConfig }) {
  return config.target.kind !== 'codex-cli'
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
    if (input?.provider) {
      provider = input.provider
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
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderSessionOptions {
  const normalized = normalizeAssistantProviderConfig(input)
  const resolved = resolveAssistantRuntimeTarget(normalized)
  const provider = resolveAssistantChatProviderFromConfig(normalized)

  return assistantProviderSessionOptionsSchema.parse({
    continuityFingerprint: resolved.continuityFingerprint,
    executionDriver: resolved.executionDriver,
    provider,
    model: normalized.target.model,
    reasoningEffort: normalized.policy.reasoningEffort,
    resumeKind: resolved.resumeKind,
    sandbox: normalized.policy.sandbox,
    approvalPolicy: normalized.policy.approvalPolicy,
    profile: isAssistantCodexTargetConfig(normalized) ? normalized.target.profile : null,
    oss: isAssistantCodexTargetConfig(normalized) ? normalized.target.oss : false,
    ...(isAssistantCodexTargetConfig(normalized) && normalized.target.codexHome
      ? { codexHome: normalized.target.codexHome }
      : {}),
    ...(isAssistantOpenAICompatibleTargetConfig(normalized) &&
    normalized.target.baseUrl
      ? { baseUrl: normalized.target.baseUrl }
      : {}),
    ...(isAssistantOpenAICompatibleTargetConfig(normalized) &&
    normalized.target.apiKeyEnv
      ? { apiKeyEnv: normalized.target.apiKeyEnv }
      : {}),
    ...(isAssistantOpenAICompatibleTargetConfig(normalized) &&
    normalized.target.providerName
      ? { providerName: normalized.target.providerName }
      : {}),
    ...(isAssistantOpenAICompatibleTargetConfig(normalized) && resolved.presetId
      ? { presetId: resolved.presetId }
      : {}),
    ...(isAssistantOpenAICompatibleTargetConfig(normalized) &&
    normalized.target.headers
      ? { headers: normalized.target.headers }
      : {}),
    ...(isAssistantOpenAICompatibleTargetConfig(normalized) &&
    normalized.target.gatewayOnlyProviders
      ? { gatewayOnlyProviders: normalized.target.gatewayOnlyProviders }
      : {}),
    ...(isAssistantOpenAICompatibleTargetConfig(normalized) &&
    normalized.policy.webSearch
      ? { webSearch: normalized.policy.webSearch }
      : {}),
    ...(isAssistantOpenAICompatibleTargetConfig(normalized) &&
    normalized.policy.zeroDataRetention
      ? { zeroDataRetention: true }
      : {}),
  })
}

export function serializeAssistantProviderOperatorDefaults(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderDefaultsConfig {
  const normalized = normalizeAssistantProviderConfig(input)

  return {
    codexCommand: isAssistantCodexTargetConfig(normalized)
      ? normalized.target.codexCommand
      : null,
    codexHome: isAssistantCodexTargetConfig(normalized)
      ? normalized.target.codexHome
      : null,
    model: normalized.target.model,
    reasoningEffort: normalized.policy.reasoningEffort,
    sandbox: normalized.policy.sandbox,
    approvalPolicy: normalized.policy.approvalPolicy,
    profile: isAssistantCodexTargetConfig(normalized) ? normalized.target.profile : null,
    oss: isAssistantCodexTargetConfig(normalized) ? normalized.target.oss : false,
    baseUrl: isAssistantOpenAICompatibleTargetConfig(normalized)
      ? normalized.target.baseUrl
      : null,
    apiKeyEnv: isAssistantOpenAICompatibleTargetConfig(normalized)
      ? normalized.target.apiKeyEnv
      : null,
    presetId: isAssistantOpenAICompatibleTargetConfig(normalized)
      ? normalized.target.presetId
      : null,
    providerName: isAssistantOpenAICompatibleTargetConfig(normalized)
      ? normalized.target.providerName
      : null,
    headers: isAssistantOpenAICompatibleTargetConfig(normalized)
      ? normalizeAssistantPersistedHeaders(normalized.target.headers)
      : null,
    ...(isAssistantOpenAICompatibleTargetConfig(normalized) &&
    normalized.target.gatewayOnlyProviders
      ? { gatewayOnlyProviders: normalized.target.gatewayOnlyProviders }
      : {}),
    webSearch: isAssistantOpenAICompatibleTargetConfig(normalized)
      ? normalized.policy.webSearch
      : null,
    zeroDataRetention:
      isAssistantOpenAICompatibleTargetConfig(normalized) &&
      normalized.policy.zeroDataRetention
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

export function normalizeAssistantGatewayOnlyProviders(
  providers: readonly string[] | null | undefined,
): readonly string[] | null {
  if (!Array.isArray(providers)) {
    return null
  }

  const seen = new Set<string>()
  const normalizedProviders: string[] = []

  for (const provider of providers) {
    const normalized = normalizeAssistantGatewayProviderSlug(provider)
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    normalizedProviders.push(normalized)
  }

  return normalizedProviders.length > 0 ? normalizedProviders : null
}

export function assistantProviderConfigsEqual(
  left: AssistantProviderConfigLike | null | undefined,
  right: AssistantProviderConfigLike | null | undefined,
): boolean {
  const normalizedLeft = normalizeAssistantProviderConfig(left)
  const normalizedRight = normalizeAssistantProviderConfig(right)

  return JSON.stringify(normalizedLeft) === JSON.stringify(normalizedRight)
}

export function resolveAssistantProviderRuntimeTarget(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantResolvedRuntimeTarget {
  return resolveAssistantRuntimeTarget(normalizeAssistantProviderConfig(input))
}

export function resolveAssistantProviderContinuityFingerprint(
  input: AssistantProviderConfigLike | null | undefined,
): string {
  return resolveAssistantProviderRuntimeTarget(input).continuityFingerprint
}

export function shouldUseAssistantOpenAIResponsesApi(
  input: AssistantProviderConfigLike | null | undefined,
): boolean {
  return resolveAssistantProviderRuntimeTarget(input).executionDriver === 'responses'
}

export function supportsAssistantNativeResume(
  input: AssistantProviderConfigLike | null | undefined,
): boolean {
  return resolveAssistantProviderRuntimeTarget(input).supportsNativeResume
}

export function supportsAssistantReasoningEffort(
  input: AssistantProviderConfigLike | null | undefined,
): boolean {
  return resolveAssistantProviderRuntimeTarget(input).supportsReasoningEffort
}

export function supportsAssistantZeroDataRetention(
  input: AssistantProviderConfigLike | null | undefined,
): boolean {
  return resolveAssistantProviderRuntimeTarget(input).supportsZeroDataRetention
}

export function shouldAssistantProviderUseProviderWebSearch(
  input: AssistantProviderConfigLike | null | undefined,
): boolean {
  return shouldAssistantTargetUseProviderWebSearch(
    normalizeAssistantProviderConfig(input),
  )
}

export function shouldAssistantProviderUseGatewayWebSearch(
  input: AssistantProviderConfigLike | null | undefined,
): boolean {
  return shouldAssistantTargetUseGatewayWebSearch(
    normalizeAssistantProviderConfig(input),
  )
}

export function shouldAssistantProviderUseMurphWebSearch(
  input: AssistantProviderConfigLike | null | undefined,
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

function normalizeAssistantGatewayProviderSlug(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null
  return normalized && /^[a-z0-9][a-z0-9._-]*$/u.test(normalized)
    ? normalized
    : null
}

function isAssistantGatewayOnlyProviderTarget(input: {
  baseUrl: string | null
  presetId: SetupAssistantProviderPreset | null
  providerName: string | null
}): boolean {
  return (
    resolveOpenAICompatibleProviderTargetPresetId({
      baseUrl: input.baseUrl,
      presetId: input.presetId,
      providerName: input.providerName,
    }) === 'vercel-ai-gateway'
  )
}

function assistantProviderConfigToInput(
  config: AssistantProviderConfig,
): AssistantProviderConfigInput {
  switch (config.target.kind) {
    case 'codex-cli':
      return {
        provider: 'codex-cli',
        approvalPolicy: config.policy.approvalPolicy,
        codexCommand: config.target.codexCommand,
        codexHome: config.target.codexHome,
        model: config.target.model,
        oss: config.target.oss,
        profile: config.target.profile,
        reasoningEffort: config.policy.reasoningEffort,
        sandbox: config.policy.sandbox,
      }
    case 'responses':
    case 'openai-compatible':
    default:
      return {
        provider: 'openai-compatible',
        apiKeyEnv: config.target.apiKeyEnv,
        baseUrl: config.target.baseUrl,
        ...(config.target.gatewayOnlyProviders
          ? { gatewayOnlyProviders: config.target.gatewayOnlyProviders }
          : {}),
        headers: config.target.headers,
        model: config.target.model,
        presetId: config.target.presetId,
        providerName: config.target.providerName,
        reasoningEffort: config.policy.reasoningEffort,
        webSearch: config.policy.webSearch,
        zeroDataRetention: config.policy.zeroDataRetention === true ? true : null,
      }
  }
}

function isAssistantProviderConfig(
  input: AssistantProviderConfigLike | null | undefined,
): input is AssistantProviderConfig {
  return (
    typeof input === 'object' &&
    input !== null &&
    'policy' in input &&
    'target' in input
  )
}

function resolveAssistantCompatiblePresetId(
  input: AssistantProviderConfigInput | null | undefined,
): SetupAssistantProviderPreset | null {
  return resolveOpenAICompatibleProviderTargetPresetId({
    apiKeyEnv: input?.apiKeyEnv,
    baseUrl: input?.baseUrl,
    presetId: input?.presetId,
    providerName: input?.providerName,
  })
}

function resolveAssistantProviderForNormalization(
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
    normalizeAssistantGatewayOnlyProviders(input?.gatewayOnlyProviders) ||
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
