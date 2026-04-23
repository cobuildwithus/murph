import {
  resolveOpenAICompatibleProviderTargetPresetId,
  type SetupAssistantProviderPreset,
} from './openai-compatible-provider-presets.js'
import { normalizeNullableString } from './shared.js'

export const assistantExecutionDriverValues = [
  'codex-app-server',
  'responses',
  'openai-compatible',
] as const

export const assistantResumeKindValues = [
  'codex-thread',
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
  gatewayOnlyProviders?: readonly string[] | null
  headers?: Record<string, string> | null
  model?: string | null
  oss?: boolean | null
  presetId?: string | null
  profile?: string | null
  provider?: 'codex-cli' | 'openai-compatible' | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: string | null
  target?:
    | {
        kind?: 'codex-cli'
        model?: string | null
        codexHome?: string | null
        oss?: boolean
        profile?: string | null
        baseUrl?: never
        apiKeyEnv?: never
        gatewayOnlyProviders?: never
        providerName?: never
        presetId?: never
        headers?: never
      }
    | {
        kind?: 'responses' | 'openai-compatible'
        model?: string | null
        baseUrl?: string | null
        apiKeyEnv?: string | null
        gatewayOnlyProviders?: readonly string[] | null
        providerName?: string | null
        presetId?: string | null
        headers?: Record<string, string> | null
        codexHome?: never
        oss?: never
        profile?: never
      }
  policy?: {
    approvalPolicy?: string | null
    reasoningEffort?: string | null
    sandbox?: string | null
    webSearch?: string | null
    zeroDataRetention?: boolean | null
  }
  webSearch?: string | null
  zeroDataRetention?: boolean | null
}

export type AssistantTargetVia = 'openai' | 'vercel-ai-gateway'

export type AssistantResolvedTargetKind =
  | { kind: 'codex-cli' }
  | { kind: 'responses'; via: AssistantTargetVia }
  | { kind: 'openai-compatible' }

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
  target: AssistantResolvedTargetKind
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
  return resolveOpenAICompatibleProviderTargetPresetId(input)
}

export function resolveAssistantRuntimeTarget(
  input: AssistantRuntimeResolutionInput | null | undefined,
): AssistantResolvedRuntimeTarget {
  const provider = resolveAssistantRuntimeResolutionProvider(input)
  const webSearch = normalizeAssistantWebSearchMode(
    input?.policy?.webSearch ?? input?.webSearch,
  )

  if (provider === 'codex-cli') {
    const continuityFingerprint = buildAssistantContinuityFingerprint({
      approvalPolicy: input?.policy?.approvalPolicy ?? input?.approvalPolicy,
      codexHome:
        input?.target?.kind === 'codex-cli'
          ? input.target.codexHome
          : input?.codexHome,
      model: input?.target?.model ?? input?.model,
      oss: input?.target?.kind === 'codex-cli' ? input.target.oss : input?.oss,
      profile:
        input?.target?.kind === 'codex-cli' ? input.target.profile : input?.profile,
      provider: 'codex-cli',
      reasoningEffort: input?.policy?.reasoningEffort ?? input?.reasoningEffort,
      sandbox: input?.policy?.sandbox ?? input?.sandbox,
      webSearch: null,
    })

    return {
      continuityFingerprint,
      executionDriver: 'codex-app-server',
      presetId: null,
      resumeKind: 'codex-thread',
      supportsGatewayWebSearch: false,
      supportsNativeResume: true,
      supportsProviderWebSearch: false,
      supportsReasoningEffort: true,
      supportsZeroDataRetention: false,
      target: { kind: 'codex-cli' },
      webSearch: null,
    }
  }

  const presetId = resolveAssistantTargetPresetId({
    apiKeyEnv:
      input?.target && input.target.kind !== 'codex-cli'
        ? input.target.apiKeyEnv
        : input?.apiKeyEnv,
    baseUrl:
      input?.target && input.target.kind !== 'codex-cli'
        ? input.target.baseUrl
        : input?.baseUrl,
    presetId:
      input?.target && input.target.kind !== 'codex-cli'
        ? input.target.presetId
        : input?.presetId,
    providerName:
      input?.target && input.target.kind !== 'codex-cli'
        ? input.target.providerName
        : input?.providerName,
  })
  const runtimeBehavior = resolveAssistantOpenAICompatibleRuntimeBehavior({
    model: input?.target?.model ?? input?.model,
    presetId,
  })
  const continuityFingerprint = buildAssistantContinuityFingerprint({
    apiKeyEnv:
      input?.target && input.target.kind !== 'codex-cli'
        ? input.target.apiKeyEnv
        : input?.apiKeyEnv,
    baseUrl:
      input?.target && input.target.kind !== 'codex-cli'
        ? input.target.baseUrl
        : input?.baseUrl,
    headers:
      input?.target && input.target.kind !== 'codex-cli'
        ? input.target.headers
        : input?.headers,
    gatewayOnlyProviders: readAssistantRuntimeGatewayOnlyProviders(input),
    model: input?.target?.model ?? input?.model,
    presetId,
    provider: 'openai-compatible',
    providerName:
      input?.target && input.target.kind !== 'codex-cli'
        ? input.target.providerName
        : input?.providerName,
    reasoningEffort: input?.policy?.reasoningEffort ?? input?.reasoningEffort,
    webSearch,
    zeroDataRetention:
      runtimeBehavior.supportsZeroDataRetention &&
      (input?.policy?.zeroDataRetention ?? input?.zeroDataRetention) === true,
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
    target:
      runtimeBehavior.executionDriver === 'responses'
        ? {
            kind: 'responses',
            via: presetId === 'vercel-ai-gateway' ? 'vercel-ai-gateway' : 'openai',
          }
        : { kind: 'openai-compatible' },
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

const DEFAULT_OPENAI_COMPATIBLE_RUNTIME_BEHAVIOR: AssistantOpenAICompatibleRuntimeBehavior =
  {
    executionDriver: 'openai-compatible',
    resumeKind: null,
    supportsGatewayWebSearch: false,
    supportsProviderWebSearch: false,
    supportsReasoningEffort: false,
    supportsZeroDataRetention: false,
  }

const OPENAI_COMPATIBLE_PRESET_RUNTIME_BEHAVIORS: Partial<
  Record<SetupAssistantProviderPreset, AssistantOpenAICompatibleRuntimeBehavior>
> = {
  openai: {
    executionDriver: 'responses',
    resumeKind: 'openai-response-id',
    supportsGatewayWebSearch: false,
    supportsProviderWebSearch: true,
    supportsReasoningEffort: true,
    supportsZeroDataRetention: false,
  },
}

const VERCEL_GATEWAY_RESPONSES_RUNTIME_BEHAVIOR = {
  executionDriver: 'responses',
  supportsGatewayWebSearch: true,
  supportsZeroDataRetention: true,
} as const satisfies Pick<
  AssistantOpenAICompatibleRuntimeBehavior,
  'executionDriver' | 'supportsGatewayWebSearch' | 'supportsZeroDataRetention'
>

function resolveAssistantOpenAICompatibleRuntimeBehavior(input: {
  model?: string | null
  presetId: SetupAssistantProviderPreset | null
}): AssistantOpenAICompatibleRuntimeBehavior {
  const gatewayOpenAiResponsesModel =
    input.presetId === 'vercel-ai-gateway' &&
    isAssistantGatewayOpenAIModel(input.model)

  if (input.presetId === 'vercel-ai-gateway') {
    return {
      ...VERCEL_GATEWAY_RESPONSES_RUNTIME_BEHAVIOR,
      resumeKind: gatewayOpenAiResponsesModel ? 'openai-response-id' : null,
      supportsProviderWebSearch: gatewayOpenAiResponsesModel,
      supportsReasoningEffort: gatewayOpenAiResponsesModel,
    }
  }

  return input.presetId
    ? (OPENAI_COMPATIBLE_PRESET_RUNTIME_BEHAVIORS[input.presetId] ??
        DEFAULT_OPENAI_COMPATIBLE_RUNTIME_BEHAVIOR)
    : DEFAULT_OPENAI_COMPATIBLE_RUNTIME_BEHAVIOR
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
    executionDriver:
      input.provider === 'codex-cli' ? 'codex-app-server' : undefined,
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
    gatewayOnlyProviders: serializeStringList(input.gatewayOnlyProviders),
    headers: serializeHeaders(input.headers),
    zeroDataRetention: input.zeroDataRetention === true,
    webSearch: input.webSearch ?? 'auto',
  })
}

function readAssistantRuntimeGatewayOnlyProviders(
  input: AssistantRuntimeResolutionInput | null | undefined,
): readonly string[] | null {
  if (input?.target && input.target.kind !== 'codex-cli') {
    return normalizeStringList(input.target.gatewayOnlyProviders)
  }

  return normalizeStringList(input?.gatewayOnlyProviders)
}

function serializeHeaders(
  value: Record<string, string> | null | undefined,
): readonly (readonly [string, string])[] {
  if (!value || Object.keys(value).length === 0) {
    return []
  }

  return Object.entries(value).sort(([left], [right]) => left.localeCompare(right))
}

function serializeStringList(
  value: readonly string[] | null | undefined,
): readonly string[] {
  return [...normalizeStringList(value)].sort((left, right) =>
    left.localeCompare(right),
  )
}

function normalizeStringList(
  value: readonly string[] | null | undefined,
): readonly string[] {
  if (!Array.isArray(value)) {
    return []
  }

  const seen = new Set<string>()
  const normalizedValues: string[] = []

  for (const item of value) {
    const normalized = normalizeNullableString(item)?.toLowerCase() ?? null
    if (!normalized || seen.has(normalized)) {
      continue
    }

    seen.add(normalized)
    normalizedValues.push(normalized)
  }

  return normalizedValues
}

function resolveAssistantRuntimeResolutionProvider(
  input: AssistantRuntimeResolutionInput | null | undefined,
): 'codex-cli' | 'openai-compatible' {
  if (input?.target?.kind === 'codex-cli') {
    return 'codex-cli'
  }

  if (input?.target) {
    return 'openai-compatible'
  }

  return input?.provider ?? 'codex-cli'
}
