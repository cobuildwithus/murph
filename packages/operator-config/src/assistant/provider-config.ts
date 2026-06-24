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
  createUnsupportedAssistantRuntimeTargetError,
  normalizeAssistantCodexModelProvider,
  resolveStrictAssistantCodexModelProvider,
  resolveAssistantRuntimeTarget,
  type AssistantResolvedRuntimeTarget,
} from './target-runtime.js'

export interface AssistantCodexTargetConfig {
  kind: 'codex-cli'
  codexCommand: string | null
  codexHome: string | null
  model: string | null
  modelProvider: string | null
  oss: boolean
  profile: string | null
}

export type AssistantProviderTargetConfig = AssistantCodexTargetConfig

export interface AssistantProviderPolicyConfig {
  approvalPolicy: AssistantApprovalPolicy | null
  reasoningEffort: string | null
  sandbox: AssistantSandbox | null
}

export interface AssistantProviderConfig {
  policy: AssistantProviderPolicyConfig
  target: AssistantProviderTargetConfig
}

export interface AssistantProviderDefaultsConfig {
  approvalPolicy: AssistantApprovalPolicy | null
  codexCommand: string | null
  codexHome: string | null
  model: string | null
  modelProvider: string | null
  oss: boolean
  profile: string | null
  reasoningEffort: string | null
  sandbox: AssistantSandbox | null
}

export const DEFAULT_MURPH_CODEX_REASONING_EFFORT = 'low'

export type AssistantProviderConfigInput = {
  approvalPolicy?: AssistantApprovalPolicy | null
  codexCommand?: string | null
  codexHome?: string | null
  model?: string | null
  modelProvider?: string | null
  oss?: boolean | null
  profile?: string | null
  provider?: AssistantChatProvider | string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
}

export type AssistantProviderConfigLike =
  | AssistantProviderConfigInput
  | AssistantProviderConfig

const ASSISTANT_PROVIDER_CONFIG_FIELDS = [
  'approvalPolicy',
  'codexCommand',
  'codexHome',
  'model',
  'modelProvider',
  'oss',
  'profile',
  'reasoningEffort',
  'sandbox',
] as const satisfies readonly (keyof AssistantProviderConfigInput)[]

export function resolveAssistantProvider(
  provider: AssistantProviderConfigInput['provider'] | null | undefined,
): AssistantChatProvider {
  if (!provider || provider === 'codex-cli') {
    return 'codex-cli'
  }
  throw createUnsupportedAssistantRuntimeTargetError()
}

export function normalizeAssistantProviderConfig(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderConfig {
  const providerConfigInput = isAssistantProviderConfig(input)
    ? assistantProviderConfigToInput(input)
    : input

  return sanitizeAssistantProviderConfig(
    resolveAssistantProvider(providerConfigInput?.provider ?? 'codex-cli'),
    providerConfigInput,
  )
}

export function sanitizeAssistantProviderConfig(
  provider: AssistantProviderConfigInput['provider'],
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderConfig {
  resolveAssistantProvider(provider)

  const policy: AssistantProviderPolicyConfig = {
    approvalPolicy: input?.approvalPolicy ?? null,
    reasoningEffort:
      normalizeNullableString(input?.reasoningEffort) ??
      DEFAULT_MURPH_CODEX_REASONING_EFFORT,
    sandbox: input?.sandbox ?? null,
  }

  const modelProvider = normalizeAssistantCodexModelProvider(input?.modelProvider)
  const target: AssistantCodexTargetConfig = {
    kind: 'codex-cli',
    codexCommand: normalizeNullableString(input?.codexCommand),
    codexHome: normalizeNullableString(input?.codexHome),
    model: normalizeNullableString(input?.model),
    modelProvider,
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

export function mergeAssistantProviderConfigsForProvider(
  provider: AssistantProviderConfigInput['provider'],
  ...inputs: ReadonlyArray<AssistantProviderConfigLike | null | undefined>
): AssistantProviderConfig {
  resolveAssistantProvider(provider)
  const merged: AssistantProviderConfigInput = {}

  for (const rawInput of inputs) {
    const input = isAssistantProviderConfig(rawInput)
      ? assistantProviderConfigToInput(rawInput)
      : rawInput
    if (!input) {
      continue
    }

    if (input.provider) {
      resolveAssistantProvider(input.provider)
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

  return sanitizeAssistantProviderConfig('codex-cli', merged)
}

export function mergeAssistantProviderConfigs(
  ...inputs: ReadonlyArray<AssistantProviderConfigLike | null | undefined>
): AssistantProviderConfig {
  return mergeAssistantProviderConfigsForProvider('codex-cli', ...inputs)
}

export function compactAssistantProviderConfigInput(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderConfigInput | null {
  if (!input) {
    return null
  }

  const compacted: AssistantProviderConfigInput = {}

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
  const strictModelProvider = resolveStrictAssistantProviderModelProvider(input)
  const normalized = normalizeAssistantProviderConfig(input)
  const resolved = resolveAssistantRuntimeTarget(normalized)
  const provider = resolveAssistantChatProviderFromConfig(normalized)

  return assistantProviderSessionOptionsSchema.parse({
    continuityFingerprint: resolved.continuityFingerprint,
    executionDriver: resolved.executionDriver,
    provider,
    model: normalized.target.model,
    ...(strictModelProvider
      ? { modelProvider: strictModelProvider }
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
    reasoningEffort: normalized.policy.reasoningEffort,
    sandbox: normalized.policy.sandbox,
    approvalPolicy: normalized.policy.approvalPolicy,
    profile: isAssistantCodexTargetConfig(normalized) ? normalized.target.profile : null,
    oss: isAssistantCodexTargetConfig(normalized) ? normalized.target.oss : false,
  }
}

export function normalizeAssistantPersistedHeaders(
  headers: Record<string, string> | null | undefined,
): Record<string, string> | null {
  const normalizedHeaders = normalizeAssistantHeaders(headers)

  return splitAssistantHeadersForPersistence(normalizedHeaders).persistedHeaders
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
  resolveStrictAssistantProviderModelProvider(input)
  return resolveAssistantRuntimeTarget(normalizeAssistantProviderConfig(input))
}

export function resolveAssistantProviderContinuityFingerprint(
  input: AssistantProviderConfigLike | null | undefined,
): string {
  return resolveAssistantProviderRuntimeTarget(input).continuityFingerprint
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

function assistantProviderConfigToInput(
  config: AssistantProviderConfig,
): AssistantProviderConfigInput {
  if ((config.target as { kind?: string }).kind !== 'codex-cli') {
    throw createUnsupportedAssistantRuntimeTargetError()
  }

  return {
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
}

function resolveStrictAssistantProviderModelProvider(
  input: AssistantProviderConfigLike | null | undefined,
): string | null {
  const providerConfigInput = isAssistantProviderConfig(input)
    ? assistantProviderConfigToInput(input)
    : input
  return resolveStrictAssistantCodexModelProvider(
    providerConfigInput?.modelProvider,
  ).id
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
