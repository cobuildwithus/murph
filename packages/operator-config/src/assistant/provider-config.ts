import {
  assistantProviderSessionOptionsSchema,
  type AssistantApprovalPolicy,
  type AssistantChatProvider,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
} from '../assistant-cli-contracts.js'

import { normalizeNullableString } from './shared.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  buildCodexAssistantContinuityFingerprint,
  createUnsupportedAssistantRuntimeTargetError,
  resolveStrictAssistantCodexModelProvider,
} from './target-runtime.js'

export interface AssistantCodexTargetConfig {
  codexCommand: string | null
  codexHome: string | null
  model: string | null
  modelProvider: string | null
  oss: boolean
  profile: string | null
}

export interface AssistantProviderPolicyConfig {
  approvalPolicy: AssistantApprovalPolicy | null
  reasoningEffort: string | null
  sandbox: AssistantSandbox | null
}

export interface AssistantProviderConfig {
  policy: AssistantProviderPolicyConfig
  target: AssistantCodexTargetConfig
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

export function normalizeAssistantProviderConfig(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderConfig {
  const providerConfigInput = isAssistantProviderConfig(input)
    ? assistantProviderConfigToInput(input)
    : input
  assertSupportedAssistantRuntimeIdentifier(providerConfigInput?.provider)
  if (providerConfigInput?.oss === true) {
    throw new VaultCliError(
      'invalid_option',
      'Assistant models must use OpenAI. Local model execution is no longer supported.',
    )
  }

  return {
    policy: {
      approvalPolicy: providerConfigInput?.approvalPolicy ?? null,
      reasoningEffort:
        normalizeNullableString(providerConfigInput?.reasoningEffort) ??
        DEFAULT_MURPH_CODEX_REASONING_EFFORT,
      sandbox: providerConfigInput?.sandbox ?? null,
    },
    target: {
      codexCommand: normalizeNullableString(providerConfigInput?.codexCommand),
      codexHome: normalizeNullableString(providerConfigInput?.codexHome),
      model: normalizeNullableString(providerConfigInput?.model),
      modelProvider: resolveStrictAssistantCodexModelProvider(
        providerConfigInput?.modelProvider,
      ).id,
      oss: false,
      profile: normalizeNullableString(providerConfigInput?.profile),
    },
  }
}

export function mergeAssistantProviderConfigs(
  ...inputs: ReadonlyArray<AssistantProviderConfigLike | null | undefined>
): AssistantProviderConfig {
  const merged: AssistantProviderConfigInput = {}

  for (const rawInput of inputs) {
    const input = isAssistantProviderConfig(rawInput)
      ? assistantProviderConfigToInput(rawInput)
      : rawInput
    if (!input) {
      continue
    }

    assertSupportedAssistantRuntimeIdentifier(input.provider)

    for (const field of ASSISTANT_PROVIDER_CONFIG_FIELDS) {
      if (!(field in input)) {
        continue
      }

      ;(merged as Record<string, unknown>)[field] = (
        input as Record<string, unknown>
      )[field]
    }
  }

  return normalizeAssistantProviderConfig(merged)
}

export function compactAssistantProviderConfigInput(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderConfigInput | null {
  if (!input) {
    return null
  }

  assertSupportedAssistantRuntimeIdentifier(input.provider)
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

  return assistantProviderSessionOptionsSchema.parse({
    continuityFingerprint: buildCodexAssistantContinuityFingerprint({
      approvalPolicy: normalized.policy.approvalPolicy,
      codexHome: normalized.target.codexHome,
      model: normalized.target.model,
      modelProvider: strictModelProvider,
      oss: normalized.target.oss,
      profile: normalized.target.profile,
      sandbox: normalized.policy.sandbox,
    }),
    executionDriver: 'codex-app-server',
    provider: 'codex-cli',
    model: normalized.target.model,
    ...(strictModelProvider ? { modelProvider: strictModelProvider } : {}),
    reasoningEffort: normalized.policy.reasoningEffort,
    resumeKind: 'codex-thread',
    sandbox: normalized.policy.sandbox,
    approvalPolicy: normalized.policy.approvalPolicy,
    profile: normalized.target.profile,
    oss: normalized.target.oss,
    ...(normalized.target.codexHome
      ? { codexHome: normalized.target.codexHome }
      : {}),
  })
}

export function serializeAssistantProviderOperatorDefaults(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantProviderDefaultsConfig {
  const normalized = normalizeAssistantProviderConfig(input)

  return {
    codexCommand: normalized.target.codexCommand,
    codexHome: normalized.target.codexHome,
    model: normalized.target.model,
    modelProvider: normalized.target.modelProvider,
    reasoningEffort: normalized.policy.reasoningEffort,
    sandbox: normalized.policy.sandbox,
    approvalPolicy: normalized.policy.approvalPolicy,
    profile: normalized.target.profile,
    oss: normalized.target.oss,
  }
}

function assistantProviderConfigToInput(
  config: AssistantProviderConfig,
): AssistantProviderConfigInput {
  const legacyProvider = (config as { provider?: unknown }).provider
  const legacyKind = (config.target as { kind?: unknown }).kind
  if (
    (legacyProvider !== undefined &&
      legacyProvider !== null &&
      legacyProvider !== 'codex-cli') ||
    (legacyKind !== undefined && legacyKind !== 'codex-cli')
  ) {
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

function assertSupportedAssistantRuntimeIdentifier(
  provider: AssistantProviderConfigInput['provider'],
): void {
  if (provider && provider !== 'codex-cli') {
    throw createUnsupportedAssistantRuntimeTargetError()
  }
}
