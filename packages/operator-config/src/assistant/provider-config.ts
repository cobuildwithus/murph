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
  createUnsupportedAssistantRuntimeTargetError,
  normalizeAssistantCodexModelProvider,
  resolveAssistantCodexModelProviderConfig,
  resolveAssistantRuntimeTarget,
  type AssistantCodexModelProviderConfig,
  type AssistantResolvedRuntimeTarget,
  type AssistantTargetVia,
  type AssistantWebSearchMode,
} from './target-runtime.js'
import {
  resolveOpenAICompatibleProviderPresetFromId,
  type SetupAssistantProviderPreset,
} from './openai-compatible-provider-presets.js'

export interface AssistantCodexTargetConfig {
  kind: 'codex-cli'
  codexCommand: string | null
  codexHome: string | null
  model: string | null
  modelProvider: string | null
  modelProviderConfig: AssistantCodexModelProviderConfig | null
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
  modelProvider: string | null
  modelProviderConfig: AssistantCodexModelProviderConfig | null
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
  modelProvider?: string | null
  oss?: boolean | null
  presetId?: string | null
  profile?: string | null
  provider?: AssistantProviderInputProvider | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
  webSearch?: string | null
  zeroDataRetention?: boolean | null
}

type AssistantProviderInputProvider = AssistantChatProvider | 'openai-compatible'

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
  'modelProvider',
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
  provider: AssistantProviderInputProvider | null | undefined,
): AssistantProviderInputProvider {
  return provider ?? 'codex-cli'
}

export function inferAssistantProviderFromConfigInput(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderInputProvider | null {
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
  provider: AssistantProviderInputProvider,
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderConfig {
  if (provider !== 'codex-cli') {
    throw createUnsupportedAssistantRuntimeTargetError()
  }

  const policy: AssistantProviderPolicyConfig = {
    approvalPolicy: input?.approvalPolicy ?? null,
    reasoningEffort:
      normalizeNullableString(input?.reasoningEffort) ??
      DEFAULT_MURPH_CODEX_REASONING_EFFORT,
    sandbox: input?.sandbox ?? null,
    webSearch: null,
    zeroDataRetention: null,
  }

  const modelProvider = normalizeAssistantCodexModelProvider(input?.modelProvider)
  const target: AssistantCodexTargetConfig = {
    kind: 'codex-cli',
    codexCommand: normalizeNullableString(input?.codexCommand),
    codexHome: normalizeNullableString(input?.codexHome),
    model: normalizeNullableString(input?.model),
    modelProvider,
    modelProviderConfig: resolveAssistantCodexModelProviderConfig(modelProvider),
    oss: input?.oss === true,
    profile: normalizeNullableString(input?.profile),
  }

  return {
    policy,
    target,
  }
}

export function resolveAssistantChatProviderFromConfig(
  config: AssistantProviderConfig,
): AssistantChatProvider {
  if (config.target.kind !== 'codex-cli') {
    throw createUnsupportedAssistantRuntimeTargetError()
  }

  return 'codex-cli'
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
  provider: AssistantProviderInputProvider,
  ...inputs: ReadonlyArray<AssistantProviderConfigLike | null | undefined>
): AssistantProviderConfig {
  const merged: AssistantProviderConfigInput = {
    provider,
  }

  for (const rawInput of inputs) {
    const input = isAssistantProviderConfig(rawInput)
      ? assistantProviderConfigToInput(rawInput)
      : rawInput
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
  ...inputs: ReadonlyArray<AssistantProviderConfigLike | null | undefined>
): AssistantProviderConfig {
  let provider: AssistantProviderInputProvider = 'codex-cli'

  for (const rawInput of inputs) {
    const input = isAssistantProviderConfig(rawInput)
      ? assistantProviderConfigToInput(rawInput)
      : rawInput
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
    ...(isAssistantCodexTargetConfig(normalized) && normalized.target.modelProvider
      ? { modelProvider: normalized.target.modelProvider }
      : {}),
    ...(isAssistantCodexTargetConfig(normalized) &&
    normalized.target.modelProviderConfig
      ? { modelProviderConfig: normalized.target.modelProviderConfig }
      : {}),
    reasoningEffort: normalized.policy.reasoningEffort,
    resumeKind: resolved.resumeKind,
    sandbox: normalized.policy.sandbox,
    approvalPolicy: normalized.policy.approvalPolicy,
    profile: isAssistantCodexTargetConfig(normalized) ? normalized.target.profile : null,
    oss: isAssistantCodexTargetConfig(normalized) ? normalized.target.oss : false,
    ...(isAssistantCodexTargetConfig(normalized) && normalized.target.codexHome
      ? { codexHome: normalized.target.codexHome }
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
    modelProvider: isAssistantCodexTargetConfig(normalized)
      ? normalized.target.modelProvider
      : null,
    modelProviderConfig: isAssistantCodexTargetConfig(normalized)
      ? normalized.target.modelProviderConfig
      : null,
    reasoningEffort: normalized.policy.reasoningEffort,
    sandbox: normalized.policy.sandbox,
    approvalPolicy: normalized.policy.approvalPolicy,
    profile: isAssistantCodexTargetConfig(normalized) ? normalized.target.profile : null,
    oss: isAssistantCodexTargetConfig(normalized) ? normalized.target.oss : false,
    baseUrl: null,
    apiKeyEnv: null,
    presetId: null,
    providerName: null,
    headers: null,
    webSearch: null,
    zeroDataRetention: null,
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
  void input
  return false
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
  void input
  return false
}

export function shouldAssistantProviderUseProviderWebSearch(
  input: AssistantProviderConfigLike | null | undefined,
): boolean {
  void input
  return false
}

export function shouldAssistantProviderUseGatewayWebSearch(
  input: AssistantProviderConfigLike | null | undefined,
): boolean {
  void input
  return false
}

export function shouldAssistantProviderUseMurphWebSearch(
  input: AssistantProviderConfigLike | null | undefined,
): boolean {
  void input
  return false
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
        modelProvider: config.target.modelProvider,
        oss: config.target.oss,
        profile: config.target.profile,
        reasoningEffort: config.policy.reasoningEffort,
        sandbox: config.policy.sandbox,
      }
    case 'responses':
    case 'openai-compatible':
    default:
      throw createUnsupportedAssistantRuntimeTargetError()
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

function resolveAssistantProviderForNormalization(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderInputProvider | null {
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
    normalizeAssistantCodexModelProvider(input?.modelProvider) ||
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
