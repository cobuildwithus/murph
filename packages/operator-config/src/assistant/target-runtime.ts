import {
  getOpenAICompatibleProviderPreset,
  resolveOpenAICompatibleProviderPreset,
  resolveOpenAICompatibleProviderPresetFromId,
  type SetupAssistantProviderPreset,
} from './openai-compatible-provider-presets.js'
import {
  isAssistantOpenAIBaseUrl,
  isAssistantVercelAIGatewayBaseUrl,
  normalizeNullableString,
} from './shared.js'

export const assistantExecutionDriverValues = [
  'codex-cli',
  'openai-compatible',
  'openai-responses',
  'gateway',
] as const

export const assistantResumeKindValues = [
  'codex-session',
  'openai-response-id',
] as const

export const assistantWebSearchModeValues = [
  'auto',
  'provider',
  'gateway',
  'murph',
  'off',
] as const

export type AssistantExecutionDriver =
  (typeof assistantExecutionDriverValues)[number]
export type AssistantResumeKind = (typeof assistantResumeKindValues)[number]
export type AssistantWebSearchMode = (typeof assistantWebSearchModeValues)[number]

export interface AssistantRuntimeResolutionInput {
  apiKeyEnv?: string | null
  approvalPolicy?: string | null
  baseUrl?: string | null
  codexHome?: string | null
  headers?: Record<string, string> | null
  model?: string | null
  oss?: boolean | null
  presetId?: string | null
  profile?: string | null
  provider?: 'codex-cli' | 'openai-compatible' | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: string | null
  webSearch?: string | null
  zeroDataRetention?: boolean | null
}

export interface AssistantResolvedRuntimeTarget {
  continuityFingerprint: string
  executionDriver: AssistantExecutionDriver
  presetId: SetupAssistantProviderPreset | null
  providerOptionNamespaces: readonly string[]
  resumeKind: AssistantResumeKind | null
  supportsGatewayWebSearch: boolean
  supportsNativeResume: boolean
  supportsProviderWebSearch: boolean
  supportsReasoningEffort: boolean
  supportsZeroDataRetention: boolean
  webSearch: AssistantWebSearchMode | null
}

export function normalizeAssistantExecutionDriver(
  value: string | null | undefined,
): AssistantExecutionDriver | null {
  const normalized = normalizeNullableString(value)
  return normalized !== null &&
    assistantExecutionDriverValues.includes(normalized as AssistantExecutionDriver)
    ? (normalized as AssistantExecutionDriver)
    : null
}

export function normalizeAssistantResumeKind(
  value: string | null | undefined,
): AssistantResumeKind | null {
  const normalized = normalizeNullableString(value)
  return normalized !== null &&
    assistantResumeKindValues.includes(normalized as AssistantResumeKind)
    ? (normalized as AssistantResumeKind)
    : null
}

export function normalizeAssistantWebSearchMode(
  value: string | null | undefined,
): AssistantWebSearchMode | null {
  const normalized = normalizeNullableString(value)
  return normalized !== null &&
    assistantWebSearchModeValues.includes(normalized as AssistantWebSearchMode)
    ? (normalized as AssistantWebSearchMode)
    : null
}

export function resolveAssistantTargetPresetId(
  input: Pick<
    AssistantRuntimeResolutionInput,
    'apiKeyEnv' | 'baseUrl' | 'presetId' | 'providerName'
  >,
): SetupAssistantProviderPreset | null {
  const explicitPreset = resolveOpenAICompatibleProviderPresetFromId(input.presetId)
  if (explicitPreset) {
    return explicitPreset.id
  }

  return (
    resolveOpenAICompatibleProviderPreset({
      apiKeyEnv: input.apiKeyEnv,
      baseUrl: input.baseUrl,
      providerName: input.providerName,
    })?.id ?? null
  )
}

export function resolveAssistantRuntimeTarget(
  input: AssistantRuntimeResolutionInput | null | undefined,
): AssistantResolvedRuntimeTarget {
  const provider = input?.provider ?? 'codex-cli'
  const webSearch = normalizeAssistantWebSearchMode(input?.webSearch)

  if (provider === 'codex-cli') {
    return {
      continuityFingerprint: buildAssistantContinuityFingerprint({
        ...input,
        provider: 'codex-cli',
        webSearch,
      }),
      executionDriver: 'codex-cli',
      presetId: null,
      providerOptionNamespaces: [],
      resumeKind: 'codex-session',
      supportsGatewayWebSearch: false,
      supportsNativeResume: true,
      supportsProviderWebSearch: false,
      supportsReasoningEffort: true,
      supportsZeroDataRetention: false,
      webSearch,
    }
  }

  const presetId = resolveAssistantTargetPresetId({
    apiKeyEnv: input?.apiKeyEnv,
    baseUrl: input?.baseUrl,
    presetId: input?.presetId,
    providerName: input?.providerName,
  })
  const executionDriver = resolveAssistantOpenAICompatibleDriver({
    baseUrl: input?.baseUrl,
    presetId,
  })
  const resumeKind = resolveAssistantOpenAICompatibleResumeKind({
    executionDriver,
    model: input?.model,
  })
  const supportsProviderWebSearch = resolveAssistantProviderWebSearchSupport({
    executionDriver,
    model: input?.model,
  })
  const supportsGatewayWebSearch = executionDriver === 'gateway'
  const supportsZeroDataRetention = resolveAssistantZeroDataRetentionSupport({
    baseUrl: input?.baseUrl,
    executionDriver,
    presetId,
  })
  const supportsReasoningEffort = resolveAssistantReasoningEffortSupport({
    executionDriver,
    model: input?.model,
  })
  const providerOptionNamespaces = resolveAssistantProviderOptionNamespaces({
    executionDriver,
    model: input?.model,
    providerName: input?.providerName,
  })

  return {
    continuityFingerprint: buildAssistantContinuityFingerprint({
      ...input,
      presetId,
      provider: 'openai-compatible',
      webSearch,
      zeroDataRetention:
        supportsZeroDataRetention && input?.zeroDataRetention === true,
    }),
    executionDriver,
    presetId,
    providerOptionNamespaces,
    resumeKind,
    supportsGatewayWebSearch,
    supportsNativeResume: resumeKind !== null,
    supportsProviderWebSearch,
    supportsReasoningEffort,
    supportsZeroDataRetention,
    webSearch,
  }
}

export function shouldAssistantTargetUseProviderWebSearch(
  input: AssistantRuntimeResolutionInput | null | undefined,
): boolean {
  const resolved = resolveAssistantRuntimeTarget(input)
  if (!resolved.supportsProviderWebSearch) {
    return false
  }

  const webSearch = resolved.webSearch ?? 'auto'
  return webSearch === 'auto' || webSearch === 'provider'
}

export function shouldAssistantTargetUseGatewayWebSearch(
  input: AssistantRuntimeResolutionInput | null | undefined,
): boolean {
  const resolved = resolveAssistantRuntimeTarget(input)
  if (!resolved.supportsGatewayWebSearch) {
    return false
  }

  const webSearch = resolved.webSearch ?? 'auto'
  return webSearch === 'auto' || webSearch === 'gateway'
}

export function shouldAssistantTargetUseMurphWebSearch(
  input: AssistantRuntimeResolutionInput | null | undefined,
): boolean {
  const resolved = resolveAssistantRuntimeTarget(input)
  const webSearch = resolved.webSearch ?? 'auto'
  if (webSearch === 'off') {
    return false
  }

  if (webSearch === 'murph') {
    return true
  }

  if (webSearch === 'provider') {
    return !resolved.supportsProviderWebSearch
  }

  if (webSearch === 'gateway') {
    return !resolved.supportsGatewayWebSearch
  }

  return !resolved.supportsProviderWebSearch && !resolved.supportsGatewayWebSearch
}

function resolveAssistantOpenAICompatibleDriver(input: {
  baseUrl?: string | null
  presetId: SetupAssistantProviderPreset | null
}): AssistantExecutionDriver {
  const preset = input.presetId
    ? getOpenAICompatibleProviderPreset(input.presetId)
    : null

  switch (preset?.id) {
    case 'openai':
      return 'openai-responses'
    case 'vercel-ai-gateway':
      return 'gateway'
    case 'custom':
      break
    default:
      if (preset) {
        return 'openai-compatible'
      }
      break
  }

  if (isAssistantOpenAIBaseUrl(input.baseUrl)) {
    return 'openai-responses'
  }

  if (isAssistantVercelAIGatewayBaseUrl(input.baseUrl)) {
    return 'gateway'
  }

  return 'openai-compatible'
}

function resolveAssistantOpenAICompatibleResumeKind(input: {
  executionDriver: AssistantExecutionDriver
  model?: string | null
}): AssistantResumeKind | null {
  switch (input.executionDriver) {
    case 'openai-responses':
      return 'openai-response-id'
    case 'gateway':
      return isAssistantGatewayOpenAIModel(input.model)
        ? 'openai-response-id'
        : null
    case 'codex-cli':
      return 'codex-session'
    case 'openai-compatible':
    default:
      return null
  }
}

function resolveAssistantProviderWebSearchSupport(input: {
  executionDriver: AssistantExecutionDriver
  model?: string | null
}): boolean {
  switch (input.executionDriver) {
    case 'openai-responses':
      return true
    case 'gateway':
      return isAssistantGatewayOpenAIModel(input.model)
    default:
      return false
  }
}

function resolveAssistantReasoningEffortSupport(input: {
  executionDriver: AssistantExecutionDriver
  model?: string | null
}): boolean {
  switch (input.executionDriver) {
    case 'codex-cli':
    case 'openai-responses':
      return true
    case 'gateway':
      return isAssistantGatewayOpenAIModel(input.model)
    case 'openai-compatible':
    default:
      return false
  }
}

function resolveAssistantZeroDataRetentionSupport(input: {
  baseUrl?: string | null
  executionDriver: AssistantExecutionDriver
  presetId: SetupAssistantProviderPreset | null
}): boolean {
  return (
    input.executionDriver === 'gateway' &&
    (input.presetId === 'vercel-ai-gateway' ||
      isAssistantVercelAIGatewayBaseUrl(input.baseUrl))
  )
}

function resolveAssistantProviderOptionNamespaces(input: {
  executionDriver: AssistantExecutionDriver
  model?: string | null
  providerName?: string | null
}): readonly string[] {
  switch (input.executionDriver) {
    case 'codex-cli':
      return []
    case 'openai-responses':
      return ['openai']
    case 'gateway': {
      const upstream = resolveAssistantGatewayProviderNamespace(input.model)
      return upstream ? ['gateway', upstream] : ['gateway']
    }
    case 'openai-compatible':
    default:
      return [normalizeAssistantProviderOptionNamespace(input.providerName)]
  }
}

function resolveAssistantGatewayProviderNamespace(
  model: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(model)
  if (!normalized) {
    return null
  }

  const slashIndex = normalized.indexOf('/')
  if (slashIndex <= 0) {
    return null
  }

  return normalizeAssistantProviderOptionNamespace(
    normalized.slice(0, slashIndex),
  )
}

function normalizeAssistantProviderOptionNamespace(
  value: string | null | undefined,
): string {
  const normalized = normalizeNullableString(value)
  const source = normalized ?? 'murph-assistant'
  const segments = source
    .split(/[^a-zA-Z0-9]+/u)
    .map((segment) => segment.trim())
    .filter(Boolean)

  if (segments.length === 0) {
    return 'murphAssistant'
  }

  const [first, ...rest] = segments
  return [
    first!.charAt(0).toLowerCase() + first!.slice(1),
    ...rest.map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1)),
  ].join('')
}

function isAssistantGatewayOpenAIModel(model: string | null | undefined): boolean {
  return normalizeNullableString(model)?.startsWith('openai/') === true
}

function buildAssistantContinuityFingerprint(
  input: AssistantRuntimeResolutionInput & {
    provider: 'codex-cli' | 'openai-compatible'
    presetId?: string | null
    webSearch?: AssistantWebSearchMode | null
  },
): string {
  return JSON.stringify({
    provider: input.provider,
    presetId: input.presetId ?? null,
    model: normalizeNullableString(input.model),
    reasoningEffort: normalizeNullableString(input.reasoningEffort),
    sandbox: normalizeNullableString(input.sandbox),
    approvalPolicy: normalizeNullableString(input.approvalPolicy),
    profile: normalizeNullableString(input.profile),
    oss: input.oss === true,
    codexHome: normalizeNullableString(input.codexHome),
    baseUrl: normalizeNullableString(input.baseUrl),
    apiKeyEnv: normalizeNullableString(input.apiKeyEnv),
    providerName: normalizeNullableString(input.providerName),
    headers: serializeHeaders(input.headers),
    zeroDataRetention: input.zeroDataRetention === true,
    webSearch: input.webSearch ?? 'auto',
  })
}

function serializeHeaders(
  value: Record<string, string> | null | undefined,
): readonly (readonly [string, string])[] {
  if (!value || Object.keys(value).length === 0) {
    return []
  }

  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
}
