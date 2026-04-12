import {
  resolveOpenAICompatibleProviderPresetFromId,
  type SetupAssistantProviderPreset,
} from './openai-compatible-provider-presets.js'
import { normalizeNullableString } from './shared.js'

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
  input: Pick<AssistantRuntimeResolutionInput, 'presetId'>,
): SetupAssistantProviderPreset | null {
  return resolveOpenAICompatibleProviderPresetFromId(input.presetId)?.id ?? null
}

export function resolveAssistantRuntimeTarget(
  input: AssistantRuntimeResolutionInput | null | undefined,
): AssistantResolvedRuntimeTarget {
  const provider = input?.provider ?? 'codex-cli'
  const webSearch = normalizeAssistantWebSearchMode(input?.webSearch)

  if (provider === 'codex-cli') {
    const continuityFingerprint = buildAssistantContinuityFingerprint({
      approvalPolicy: input?.approvalPolicy,
      codexHome: input?.codexHome,
      model: input?.model,
      oss: input?.oss,
      profile: input?.profile,
      provider: 'codex-cli',
      reasoningEffort: input?.reasoningEffort,
      sandbox: input?.sandbox,
      webSearch: null,
    })

    return {
      continuityFingerprint,
      executionDriver: 'codex-cli',
      presetId: null,
      resumeKind: 'codex-session',
      supportsGatewayWebSearch: false,
      supportsNativeResume: true,
      supportsProviderWebSearch: false,
      supportsReasoningEffort: true,
      supportsZeroDataRetention: false,
      webSearch: null,
    }
  }

  const presetId = resolveAssistantTargetPresetId({
    presetId: input?.presetId,
  })
  const runtimeBehavior = resolveAssistantOpenAICompatibleRuntimeBehavior({
    model: input?.model,
    presetId,
  })
  const continuityFingerprint = buildAssistantContinuityFingerprint({
    apiKeyEnv: input?.apiKeyEnv,
    baseUrl: input?.baseUrl,
    headers: input?.headers,
    model: input?.model,
    presetId,
    provider: 'openai-compatible',
    providerName: input?.providerName,
    reasoningEffort: input?.reasoningEffort,
    webSearch,
    zeroDataRetention:
      runtimeBehavior.supportsZeroDataRetention && input?.zeroDataRetention === true,
  })

  return {
    continuityFingerprint,
    executionDriver: runtimeBehavior.executionDriver,
    presetId,
    resumeKind: runtimeBehavior.resumeKind,
    supportsGatewayWebSearch: runtimeBehavior.supportsGatewayWebSearch,
    supportsNativeResume: runtimeBehavior.resumeKind !== null,
    supportsProviderWebSearch: runtimeBehavior.supportsProviderWebSearch,
    supportsReasoningEffort: runtimeBehavior.supportsReasoningEffort,
    supportsZeroDataRetention: runtimeBehavior.supportsZeroDataRetention,
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

interface AssistantOpenAICompatibleRuntimeBehavior {
  executionDriver: AssistantExecutionDriver
  resumeKind: AssistantResumeKind | null
  supportsGatewayWebSearch: boolean
  supportsProviderWebSearch: boolean
  supportsReasoningEffort: boolean
  supportsZeroDataRetention: boolean
}

function resolveAssistantOpenAICompatibleRuntimeBehavior(input: {
  model?: string | null
  presetId: SetupAssistantProviderPreset | null
}): AssistantOpenAICompatibleRuntimeBehavior {
  const gatewayOpenAIModel =
    input.presetId === 'vercel-ai-gateway' &&
    isAssistantGatewayOpenAIModel(input.model)

  switch (input.presetId) {
    case 'openai':
      return {
        executionDriver: 'openai-responses',
        resumeKind: 'openai-response-id',
        supportsGatewayWebSearch: false,
        supportsProviderWebSearch: true,
        supportsReasoningEffort: true,
        supportsZeroDataRetention: false,
      }
    case 'vercel-ai-gateway':
      return {
        executionDriver: 'gateway',
        resumeKind: gatewayOpenAIModel ? 'openai-response-id' : null,
        supportsGatewayWebSearch: true,
        supportsProviderWebSearch: gatewayOpenAIModel,
        supportsReasoningEffort: gatewayOpenAIModel,
        supportsZeroDataRetention: true,
      }
    default:
      return {
        executionDriver: 'openai-compatible',
        resumeKind: null,
        supportsGatewayWebSearch: false,
        supportsProviderWebSearch: false,
        supportsReasoningEffort: false,
        supportsZeroDataRetention: false,
      }
  }
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
