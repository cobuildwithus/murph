import type {
  AssistantApprovalPolicy,
  AssistantChatProvider,
  AssistantProviderSessionOptions,
  AssistantSandbox,
} from '../assistant-cli-contracts.js'
import type { AssistantModelSpec } from '../model-harness.js'
import {
  normalizeNullableString,
  readAssistantEnvString,
} from './shared.js'

export interface AssistantCodexProviderConfig {
  approvalPolicy: AssistantApprovalPolicy | null
  apiKeyEnv: null
  baseUrl: null
  codexCommand: string | null
  headers: null
  model: string | null
  oss: boolean
  profile: string | null
  provider: 'codex-cli'
  providerName: null
  reasoningEffort: string | null
  sandbox: AssistantSandbox | null
}

export interface AssistantOpenAICompatibleProviderConfig {
  approvalPolicy: null
  apiKeyEnv: string | null
  baseUrl: string | null
  codexCommand: null
  headers: Record<string, string> | null
  model: string | null
  oss: false
  profile: null
  provider: 'openai-compatible'
  providerName: string | null
  reasoningEffort: null
  sandbox: null
}

export type AssistantProviderConfig =
  | AssistantCodexProviderConfig
  | AssistantOpenAICompatibleProviderConfig

export type AssistantProviderConfigInput = {
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  codexCommand?: string | null
  headers?: Record<string, string> | null
  model?: string | null
  oss?: boolean | null
  profile?: string | null
  provider?: AssistantChatProvider | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
}

const ASSISTANT_PROVIDER_CONFIG_FIELDS = [
  'approvalPolicy',
  'apiKeyEnv',
  'baseUrl',
  'codexCommand',
  'headers',
  'model',
  'oss',
  'profile',
  'providerName',
  'reasoningEffort',
  'sandbox',
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
    normalizeAssistantHeaders(input?.headers)
  ) {
    return 'openai-compatible'
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
      return {
        provider,
        approvalPolicy: null,
        apiKeyEnv: normalizeNullableString(input?.apiKeyEnv),
        baseUrl: normalizeNullableString(input?.baseUrl),
        codexCommand: null,
        headers: normalizeAssistantHeaders(input?.headers),
        model: normalizeNullableString(input?.model),
        oss: false,
        profile: null,
        providerName: normalizeNullableString(input?.providerName),
        reasoningEffort: null,
        sandbox: null,
      }
    case 'codex-cli':
    default:
      return {
        provider: 'codex-cli',
        approvalPolicy: input?.approvalPolicy ?? null,
        apiKeyEnv: null,
        baseUrl: null,
        codexCommand: normalizeNullableString(input?.codexCommand),
        headers: null,
        model: normalizeNullableString(input?.model),
        oss: input?.oss === true,
        profile: normalizeNullableString(input?.profile),
        providerName: null,
        reasoningEffort: normalizeNullableString(input?.reasoningEffort),
        sandbox: input?.sandbox ?? null,
      }
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
  return {
    model: normalized.model,
    reasoningEffort: normalized.reasoningEffort,
    sandbox: normalized.sandbox,
    approvalPolicy: normalized.approvalPolicy,
    profile: normalized.profile,
    oss: normalized.oss,
    ...(normalized.baseUrl ? { baseUrl: normalized.baseUrl } : {}),
    ...(normalized.apiKeyEnv ? { apiKeyEnv: normalized.apiKeyEnv } : {}),
    ...(normalized.providerName ? { providerName: normalized.providerName } : {}),
    ...(normalized.provider === 'openai-compatible' && normalized.headers
      ? { headers: normalized.headers }
      : {}),
  }
}

export function serializeAssistantProviderOperatorDefaults(
  input: AssistantProviderConfigInput | null | undefined,
): Omit<AssistantProviderConfig, 'provider'> {
  const normalized = normalizeAssistantProviderConfig(input)
  return {
    codexCommand: normalized.codexCommand,
    model: normalized.model,
    reasoningEffort: normalized.reasoningEffort,
    sandbox: normalized.sandbox,
    approvalPolicy: normalized.approvalPolicy,
    profile: normalized.profile,
    oss: normalized.oss,
    baseUrl: normalized.baseUrl,
    apiKeyEnv: normalized.apiKeyEnv,
    providerName: normalized.providerName,
    headers:
      normalized.provider === 'openai-compatible' ? normalized.headers : null,
  }
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

export function resolveAssistantModelSpecFromProviderConfig(
  input: AssistantProviderConfigInput | null | undefined,
  env: NodeJS.ProcessEnv = process.env,
): AssistantModelSpec | null {
  const normalized = normalizeAssistantProviderConfig(input)
  if (normalized.provider !== 'openai-compatible') {
    return null
  }

  const model = normalizeNullableString(normalized.model)
  const baseUrl = normalizeNullableString(normalized.baseUrl)
  if (!model || !baseUrl) {
    return null
  }

  const apiKeyEnv = normalizeNullableString(normalized.apiKeyEnv)
  const apiKeyValue = readAssistantEnvString(env, apiKeyEnv) ?? undefined

  return {
    baseUrl,
    model,
    ...(apiKeyValue ? { apiKey: apiKeyValue } : {}),
    ...(apiKeyEnv ? { apiKeyEnv } : {}),
    ...(normalized.headers ? { headers: normalized.headers } : {}),
    ...(normalized.providerName ? { providerName: normalized.providerName } : {}),
  }
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
