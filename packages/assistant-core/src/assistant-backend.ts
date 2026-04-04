import {
  assistantApprovalPolicyValues,
  assistantModelTargetSchema,
  assistantReasoningEffortValues,
  assistantSandboxValues,
  type AssistantModelTarget,
} from './assistant-cli-contracts.js'
import {
  normalizeAssistantHeaders,
  normalizeAssistantProviderConfig,
  type AssistantProviderConfig,
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
    model: null,
    oss: false,
    profile: null,
    reasoningEffort: 'medium',
    sandbox: 'danger-full-access',
  })
}

export function createAssistantModelTarget(
  input: AssistantProviderConfigInput | null | undefined,
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
        headers: normalizeAssistantHeaders(target.headers),
        model: normalizeNullableString(target.model),
        providerName: normalizeNullableString(target.providerName),
        reasoningEffort: normalizeNullableString(target.reasoningEffort),
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

function convertAssistantProviderConfigToModelTarget(
  config: AssistantProviderConfig,
): AssistantModelTarget {
  switch (config.provider) {
    case 'openai-compatible':
      return {
        adapter: 'openai-compatible',
        apiKeyEnv: config.apiKeyEnv,
        endpoint: config.baseUrl,
        headers: config.headers,
        model: config.model,
        providerName: config.providerName,
        reasoningEffort: normalizeNullableEnumValue(
          config.reasoningEffort,
          assistantReasoningEffortValues,
        ),
      }
    case 'codex-cli':
    default:
      return {
        adapter: 'codex-cli',
        approvalPolicy: config.approvalPolicy,
        codexCommand: config.codexCommand,
        model: config.model,
        oss: config.oss,
        profile: config.profile,
        reasoningEffort: normalizeNullableEnumValue(
          config.reasoningEffort,
          assistantReasoningEffortValues,
        ),
        sandbox: config.sandbox,
      }
  }
}

function coerceAssistantModelTargetToProviderConfigInput(
  target: unknown,
): AssistantProviderConfigInput | null {
  if (!target || typeof target !== 'object') {
    return null
  }

  const current = assistantModelTargetSchema.safeParse(target)
  if (current.success) {
    return assistantModelTargetToProviderConfigInput(current.data)
  }

  const record = target as Record<string, unknown>
  const adapter = normalizeNullableString(
    typeof record.adapter === 'string' ? record.adapter : null,
  )
  const provider = normalizeNullableString(
    typeof record.provider === 'string' ? record.provider : null,
  )
  const legacyOptions =
    typeof record.options === 'object' && record.options !== null
      ? (record.options as Record<string, unknown>)
      : null

  switch (adapter ?? provider) {
    case 'openai-compatible':
      return {
        provider: 'openai-compatible',
        apiKeyEnv: normalizeLegacyString(readLegacyValue(record, legacyOptions, 'apiKeyEnv')),
        baseUrl: normalizeLegacyString(
          readLegacyValue(record, legacyOptions, 'endpoint', 'baseUrl'),
        ),
        headers: normalizeLegacyHeaders(readLegacyValue(record, legacyOptions, 'headers')),
        model: normalizeLegacyString(readLegacyValue(record, legacyOptions, 'model')),
        providerName: normalizeNullableString(
          normalizeLegacyString(readLegacyValue(record, legacyOptions, 'providerName')),
        ),
        reasoningEffort: normalizeNullableString(
          normalizeLegacyString(
            readLegacyValue(record, legacyOptions, 'reasoningEffort'),
          ),
        ),
      }
    case 'codex-cli':
      return {
        provider: 'codex-cli',
        approvalPolicy:
          normalizeNullableEnumValue(
            normalizeNullableString(
              normalizeLegacyString(
                readLegacyValue(record, legacyOptions, 'approvalPolicy'),
              ),
            ),
            assistantApprovalPolicyValues,
          ) ?? null,
        codexCommand: normalizeNullableString(
          normalizeLegacyString(readLegacyValue(record, legacyOptions, 'codexCommand')),
        ),
        model: normalizeLegacyString(readLegacyValue(record, legacyOptions, 'model')),
        oss: readLegacyValue(record, legacyOptions, 'oss') === true,
        profile: normalizeLegacyString(readLegacyValue(record, legacyOptions, 'profile')),
        reasoningEffort:
          normalizeNullableEnumValue(
            normalizeNullableString(
              normalizeLegacyString(
                readLegacyValue(record, legacyOptions, 'reasoningEffort'),
              ),
            ),
            assistantReasoningEffortValues,
          ) ?? null,
        sandbox:
          normalizeNullableEnumValue(
            normalizeLegacyString(readLegacyValue(record, legacyOptions, 'sandbox')),
            assistantSandboxValues,
          ) ?? null,
      }
    default:
      return null
  }
}

function readLegacyValue(
  topLevel: Record<string, unknown>,
  options: Record<string, unknown> | null,
  ...keys: string[]
): unknown {
  for (const key of keys) {
    if (key in topLevel) {
      return topLevel[key]
    }
  }
  if (!options) {
    return null
  }

  for (const key of keys) {
    if (key in options) {
      return options[key]
    }
  }

  return null
}

function normalizeLegacyHeaders(value: unknown): Record<string, string> | null {
  if (!value || typeof value !== 'object') {
    return null
  }

  return normalizeAssistantHeaders(value as Record<string, string> | null)
}

function normalizeLegacyString(value: unknown): string | null {
  return typeof value === 'string' ? normalizeNullableString(value) : null
}

function hasAssistantModelTargetValues(target: AssistantModelTarget): boolean {
  switch (target.adapter) {
    case 'openai-compatible':
      return Boolean(
        target.model ??
          target.endpoint ??
          target.apiKeyEnv ??
          target.providerName ??
          (target.headers && Object.keys(target.headers).length > 0 ? 'headers' : null) ??
          target.reasoningEffort,
      )
    case 'codex-cli':
    default:
      return Boolean(
        target.model ??
          target.reasoningEffort ??
          target.profile ??
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
