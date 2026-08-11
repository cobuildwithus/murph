import {
  assistantApprovalPolicyValues,
  assistantModelTargetSchema,
  assistantReasoningEffortValues,
  assistantSandboxValues,
  type AssistantModelTarget,
} from './assistant-cli-contracts.js'
import {
  DEFAULT_MURPH_CODEX_REASONING_EFFORT,
  normalizeAssistantProviderConfig,
  type AssistantProviderConfig,
  type AssistantProviderConfigLike,
  type AssistantProviderConfigInput,
} from './assistant/provider-config.js'
import {
  createUnsupportedAssistantRuntimeTargetError,
} from './assistant/target-runtime.js'
import { normalizeNullableString } from './assistant/shared.js'

export const assistantBackendTargetSchema = assistantModelTargetSchema
export type AssistantBackendTarget = AssistantModelTarget
export type { AssistantModelTarget }

export function createDefaultLocalAssistantModelTarget(): AssistantModelTarget {
  return assistantModelTargetSchema.parse({
    adapter: 'codex-cli',
    approvalPolicy: 'never',
    codexCommand: null,
    codexHome: null,
    model: null,
    modelProvider: null,
    oss: false,
    profile: null,
    reasoningEffort: DEFAULT_MURPH_CODEX_REASONING_EFFORT,
    sandbox: 'danger-full-access',
  })
}

export function createAssistantModelTarget(
  input: AssistantProviderConfigLike | null | undefined,
): AssistantModelTarget | null {
  if (!input) {
    return null
  }

  const normalized = normalizeAssistantProviderConfig(input)
  const target = assistantModelTargetSchema.parse(
    convertAssistantProviderConfigToModelTarget(normalized),
  )

  return hasAssistantModelTargetValues(target) ? target : null
}

export function normalizeAssistantModelTarget(
  target: unknown,
): AssistantModelTarget | null {
  if (!target) {
    return null
  }

  const normalized = coerceAssistantModelTargetToProviderConfigInput(target)
  return normalized ? createAssistantModelTarget(normalized) : null
}

export function assistantModelTargetToProviderConfigInput(
  target: AssistantModelTarget,
): AssistantProviderConfigInput {
  return {
    provider: 'codex-cli',
    approvalPolicy:
      normalizeNullableEnumValue(
        target.approvalPolicy,
        assistantApprovalPolicyValues,
      ) ?? null,
    codexCommand: normalizeNullableString(target.codexCommand),
    codexHome: normalizeNullableString(target.codexHome),
    model: normalizeNullableString(target.model),
    modelProvider: normalizeNullableString(target.modelProvider),
    oss: target.oss === true,
    profile: normalizeNullableString(target.profile),
    reasoningEffort:
      normalizeNullableEnumValue(
        target.reasoningEffort,
        assistantReasoningEffortValues,
      ) ?? null,
    sandbox:
      normalizeNullableEnumValue(target.sandbox, assistantSandboxValues) ?? null,
  }
}

export function assistantModelTargetsEqual(
  left: AssistantModelTarget | null | undefined,
  right: AssistantModelTarget | null | undefined,
): boolean {
  return JSON.stringify(normalizeAssistantModelTarget(left)) === JSON.stringify(
    normalizeAssistantModelTarget(right),
  )
}

export const createAssistantBackendTarget = createAssistantModelTarget
export const normalizeAssistantBackendTarget = normalizeAssistantModelTarget
export const assistantBackendTargetToProviderConfigInput =
  assistantModelTargetToProviderConfigInput
export const assistantBackendTargetsEqual = assistantModelTargetsEqual

export function sanitizeAssistantModelTargetForPersistence(
  target: AssistantModelTarget | null | undefined,
): AssistantModelTarget | null {
  return normalizeAssistantModelTarget(target)
}

export const sanitizeAssistantBackendTargetForPersistence =
  sanitizeAssistantModelTargetForPersistence

function convertAssistantProviderConfigToModelTarget(
  config: AssistantProviderConfig,
): AssistantModelTarget {
  return {
    adapter: 'codex-cli',
    approvalPolicy: config.policy.approvalPolicy,
    codexCommand: config.target.codexCommand,
    ...(config.target.codexHome ? { codexHome: config.target.codexHome } : {}),
    model: config.target.model,
    modelProvider: config.target.modelProvider,
    oss: config.target.oss,
    profile: config.target.profile,
    reasoningEffort: normalizeNullableEnumValue(
      config.policy.reasoningEffort,
      assistantReasoningEffortValues,
    ),
    sandbox: config.policy.sandbox,
  }
}

function coerceAssistantModelTargetToProviderConfigInput(
  target: unknown,
): AssistantProviderConfigInput | null {
  if (
    target &&
    typeof target === 'object' &&
    'adapter' in target &&
    (target as { adapter?: unknown }).adapter !== 'codex-cli'
  ) {
    throw createUnsupportedAssistantRuntimeTargetError()
  }

  const current = assistantModelTargetSchema.safeParse(target)
  return current.success
    ? assistantModelTargetToProviderConfigInput(current.data)
    : null
}

function hasAssistantModelTargetValues(target: AssistantModelTarget): boolean {
  return Boolean(
    target.model ??
      target.modelProvider ??
      target.reasoningEffort ??
      target.profile ??
      target.codexHome ??
      target.codexCommand ??
      target.sandbox ??
      target.approvalPolicy ??
      (target.oss ? 'oss' : null),
  )
}

function normalizeNullableEnumValue<T extends string>(
  value: string | null | undefined,
  values: readonly T[],
): T | null {
  const normalized = normalizeNullableString(value)
  return normalized && values.includes(normalized as T) ? (normalized as T) : null
}
