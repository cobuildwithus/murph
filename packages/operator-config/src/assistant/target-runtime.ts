import type { SetupAssistantProviderPreset } from './openai-compatible-provider-presets.js'
import { normalizeNullableString } from './shared.js'

export const assistantExecutionDriverValues = [
  'codex-app-server',
] as const

export const assistantResumeKindValues = [
  'codex-thread',
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

export const assistantCodexModelProviderWireApiValues = ['responses'] as const

export type AssistantCodexModelProviderWireApi =
  (typeof assistantCodexModelProviderWireApiValues)[number]

export interface AssistantCodexModelProviderConfig {
  id: string
  name: string
  baseUrl: string
  envKey: string
  wireApi: AssistantCodexModelProviderWireApi
}

export const VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_ID = 'vercel-ai-gateway'

export const VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG = {
  id: VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_ID,
  name: 'Vercel AI Gateway',
  baseUrl: 'https://ai-gateway.vercel.sh/v1',
  envKey: 'VERCEL_AI_API_KEY',
  wireApi: 'responses',
} as const satisfies AssistantCodexModelProviderConfig

const ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS = new Map<
  string,
  AssistantCodexModelProviderConfig
>([
  [
    VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_ID,
    VERCEL_AI_GATEWAY_CODEX_MODEL_PROVIDER_CONFIG,
  ],
])

export class UnsupportedAssistantRuntimeTargetError extends Error {
  readonly code = 'ASSISTANT_RUNTIME_TARGET_UNSUPPORTED'

  constructor(message = unsupportedAssistantRuntimeTargetMessage()) {
    super(message)
    this.name = 'UnsupportedAssistantRuntimeTargetError'
  }
}

export function createUnsupportedAssistantRuntimeTargetError(): UnsupportedAssistantRuntimeTargetError {
  return new UnsupportedAssistantRuntimeTargetError()
}

export interface AssistantRuntimeResolutionInput {
  apiKeyEnv?: string | null
  approvalPolicy?: string | null
  baseUrl?: string | null
  codexHome?: string | null
  gatewayOnlyProviders?: readonly string[] | null
  headers?: Record<string, string> | null
  model?: string | null
  modelProvider?: string | null
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
        modelProvider?: string | null
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

export type AssistantResolvedTargetKind = { kind: 'codex-cli' }

export interface AssistantResolvedRuntimeTarget {
  continuityFingerprint: string
  executionDriver: AssistantExecutionDriver
  modelProvider: string | null
  modelProviderConfig: AssistantCodexModelProviderConfig | null
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
  void input
  return null
}

export function resolveAssistantRuntimeTarget(
  input: AssistantRuntimeResolutionInput | null | undefined,
): AssistantResolvedRuntimeTarget {
  const provider = resolveAssistantRuntimeResolutionProvider(input)

  if (provider === 'codex-cli') {
    const modelProvider = normalizeAssistantCodexModelProvider(
      input?.target?.kind === 'codex-cli'
        ? input.target.modelProvider
        : input?.modelProvider,
    )
    const continuityFingerprint = buildAssistantContinuityFingerprint({
      approvalPolicy: input?.policy?.approvalPolicy ?? input?.approvalPolicy,
      codexHome:
        input?.target?.kind === 'codex-cli'
          ? input.target.codexHome
          : input?.codexHome,
      model: input?.target?.model ?? input?.model,
      modelProvider,
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
      modelProvider,
      modelProviderConfig: resolveAssistantCodexModelProviderConfig(modelProvider),
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

  throw createUnsupportedAssistantRuntimeTargetError()
}

export function shouldAssistantTargetUseProviderWebSearch(
  input: AssistantRuntimeResolutionInput | null | undefined,
): boolean {
  void input
  return false
}

export function shouldAssistantTargetUseGatewayWebSearch(
  input: AssistantRuntimeResolutionInput | null | undefined,
): boolean {
  void input
  return false
}

export function shouldAssistantTargetUseMurphWebSearch(
  input: AssistantRuntimeResolutionInput | null | undefined,
): boolean {
  void input
  return false
}

export function normalizeAssistantCodexModelProvider(
  value: string | null | undefined,
): string | null {
  const normalized = normalizeNullableString(value)?.toLowerCase() ?? null
  return normalized && /^[a-z0-9][a-z0-9._-]*$/u.test(normalized)
    ? normalized
    : null
}

export function resolveAssistantCodexModelProviderConfig(
  value: string | null | undefined,
): AssistantCodexModelProviderConfig | null {
  const normalized = normalizeAssistantCodexModelProvider(value)
  return normalized
    ? ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS.get(normalized) ?? null
    : null
}

function buildAssistantContinuityFingerprint(
  input: AssistantRuntimeResolutionInput & {
    provider: 'codex-cli'
  },
): string {
  return JSON.stringify({
    provider: input.provider,
    executionDriver: 'codex-app-server',
    model: normalizeNullableString(input.model),
    modelProvider: normalizeAssistantCodexModelProvider(input.modelProvider),
    reasoningEffort: normalizeNullableString(input.reasoningEffort),
    sandbox: normalizeNullableString(input.sandbox),
    approvalPolicy: normalizeNullableString(input.approvalPolicy),
    profile: normalizeNullableString(input.profile),
    oss: input.oss === true,
    codexHome: normalizeNullableString(input.codexHome),
  })
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

function unsupportedAssistantRuntimeTargetMessage(): string {
  return [
    'OpenAI-compatible assistant runtimes are no longer supported.',
    'Reconfigure the assistant for Codex App Server.',
  ].join(' ')
}
