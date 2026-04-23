import {
  assistantApprovalPolicyValues,
  assistantModelTargetSchema,
  assistantReasoningEffortValues,
  assistantSandboxValues,
  type AssistantModelTarget,
} from './assistant-cli-contracts.js'
import {
  normalizeAssistantHeaders,
  normalizeAssistantPersistedHeaders,
  normalizeAssistantProviderConfig,
  type AssistantProviderConfig,
  type AssistantProviderConfigLike,
  type AssistantProviderConfigInput,
} from './assistant/provider-config.js'
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
    oss: false,
    profile: null,
    reasoningEffort: 'medium',
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
  switch (target.adapter) {
    case 'openai-compatible':
      return {
        provider: 'openai-compatible',
        apiKeyEnv: normalizeNullableString(target.apiKeyEnv),
        baseUrl: normalizeNullableString(target.endpoint),
        ...(target.gatewayOnlyProviders
          ? { gatewayOnlyProviders: target.gatewayOnlyProviders }
          : {}),
        headers: normalizeAssistantHeaders(target.headers),
        model: normalizeNullableString(target.model),
        presetId: target.presetId ?? null,
        providerName: normalizeNullableString(target.providerName),
        reasoningEffort: normalizeNullableString(target.reasoningEffort),
        webSearch: target.webSearch ?? null,
        zeroDataRetention: target.zeroDataRetention === true ? true : null,
      }
    case 'codex-cli':
    default:
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
  const normalized = normalizeAssistantModelTarget(target)

  if (!normalized || normalized.adapter !== 'openai-compatible') {
    return normalized
  }

  return assistantModelTargetSchema.parse({
    ...normalized,
    headers: normalizeAssistantPersistedHeaders(normalized.headers),
  })
}

export const sanitizeAssistantBackendTargetForPersistence =
  sanitizeAssistantModelTargetForPersistence

function convertAssistantProviderConfigToModelTarget(
  config: AssistantProviderConfig,
): AssistantModelTarget {
  switch (config.target.kind) {
    case 'responses':
    case 'openai-compatible':
      return {
        adapter: 'openai-compatible',
        apiKeyEnv: config.target.apiKeyEnv,
        endpoint: config.target.baseUrl,
        ...(config.target.gatewayOnlyProviders
          ? { gatewayOnlyProviders: [...config.target.gatewayOnlyProviders] }
          : {}),
        headers: config.target.headers,
        model: config.target.model,
        presetId: config.target.presetId,
        providerName: config.target.providerName,
        reasoningEffort: normalizeNullableEnumValue(
          config.policy.reasoningEffort,
          assistantReasoningEffortValues,
        ),
        webSearch: config.policy.webSearch,
        ...(config.policy.zeroDataRetention ? { zeroDataRetention: true } : {}),
      }
    case 'codex-cli':
    default:
      return {
        adapter: 'codex-cli',
        approvalPolicy: config.policy.approvalPolicy,
        codexCommand: config.target.codexCommand,
        ...(config.target.codexHome ? { codexHome: config.target.codexHome } : {}),
        model: config.target.model,
        oss: config.target.oss,
        profile: config.target.profile,
        reasoningEffort: normalizeNullableEnumValue(
          config.policy.reasoningEffort,
          assistantReasoningEffortValues,
        ),
        sandbox: config.policy.sandbox,
      }
  }
}

function coerceAssistantModelTargetToProviderConfigInput(
  target: unknown,
): AssistantProviderConfigInput | null {
  const current = assistantModelTargetSchema.safeParse(target)
  return current.success
    ? assistantModelTargetToProviderConfigInput(current.data)
    : null
}

function hasAssistantModelTargetValues(target: AssistantModelTarget): boolean {
  switch (target.adapter) {
    case 'openai-compatible':
      return Boolean(
        target.model ??
          target.endpoint ??
          target.apiKeyEnv ??
          target.presetId ??
          target.providerName ??
          (target.gatewayOnlyProviders && target.gatewayOnlyProviders.length > 0
            ? 'gateway-only-providers'
            : null) ??
          (target.headers && Object.keys(target.headers).length > 0 ? 'headers' : null) ??
          target.reasoningEffort ??
          target.webSearch ??
          (target.zeroDataRetention ? 'zero-data-retention' : null),
      )
    case 'codex-cli':
    default:
      return Boolean(
        target.model ??
          target.reasoningEffort ??
          target.profile ??
          target.codexHome ??
          target.codexCommand ??
          target.sandbox ??
          target.approvalPolicy ??
          (target.oss ? 'oss' : null),
      )
  }
}

function normalizeNullableEnumValue<T extends string>(
  value: string | null | undefined,
  values: readonly T[],
): T | null {
  const normalized = normalizeNullableString(value)
  return normalized && values.includes(normalized as T) ? (normalized as T) : null
}
