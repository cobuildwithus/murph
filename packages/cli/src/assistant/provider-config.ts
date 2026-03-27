import {
  assistantProviderSessionOptionsSchema,
  type AssistantApprovalPolicy,
  type AssistantProviderSessionOptions,
  type AssistantSandbox,
} from '../assistant-cli-contracts.js'
import type { AssistantOperatorDefaults } from '../operator-config.js'
import { normalizeNullableString } from './shared.js'

export interface AssistantProviderConfig {
  approvalPolicy: AssistantApprovalPolicy | null
  apiKeyEnv: string | null
  baseUrl: string | null
  codexCommand: string | null
  model: string | null
  oss: boolean | null
  profile: string | null
  providerName: string | null
  reasoningEffort: string | null
  sandbox: AssistantSandbox | null
}

type AssistantProviderConfigInput = {
  approvalPolicy?: AssistantApprovalPolicy | null
  apiKeyEnv?: string | null
  baseUrl?: string | null
  codexCommand?: string | null
  model?: string | null
  oss?: boolean | null
  profile?: string | null
  providerName?: string | null
  reasoningEffort?: string | null
  sandbox?: AssistantSandbox | null
}

const EMPTY_ASSISTANT_PROVIDER_CONFIG: AssistantProviderConfig = {
  model: null,
  reasoningEffort: null,
  sandbox: null,
  approvalPolicy: null,
  profile: null,
  oss: null,
  baseUrl: null,
  apiKeyEnv: null,
  providerName: null,
  codexCommand: null,
}

export function normalizeAssistantProviderConfig(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderConfig {
  return {
    model: normalizeNullableString(input?.model),
    reasoningEffort: normalizeNullableString(input?.reasoningEffort),
    sandbox: input?.sandbox ?? null,
    approvalPolicy: input?.approvalPolicy ?? null,
    profile: normalizeNullableString(input?.profile),
    oss: typeof input?.oss === 'boolean' ? input.oss : null,
    baseUrl: normalizeNullableString(input?.baseUrl),
    apiKeyEnv: normalizeNullableString(input?.apiKeyEnv),
    providerName: normalizeNullableString(input?.providerName),
    codexCommand: normalizeNullableString(input?.codexCommand),
  }
}

export function mergeAssistantProviderConfigs(
  ...inputs: ReadonlyArray<AssistantProviderConfigInput | null | undefined>
): AssistantProviderConfig {
  const merged = { ...EMPTY_ASSISTANT_PROVIDER_CONFIG }

  for (const input of inputs) {
    const normalized = normalizeAssistantProviderConfig(input)
    merged.model ??= normalized.model
    merged.reasoningEffort ??= normalized.reasoningEffort
    merged.sandbox ??= normalized.sandbox
    merged.approvalPolicy ??= normalized.approvalPolicy
    merged.profile ??= normalized.profile
    merged.oss ??= normalized.oss
    merged.baseUrl ??= normalized.baseUrl
    merged.apiKeyEnv ??= normalized.apiKeyEnv
    merged.providerName ??= normalized.providerName
    merged.codexCommand ??= normalized.codexCommand
  }

  return merged
}

export function serializeAssistantProviderSessionOptions(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantProviderSessionOptions {
  const normalized = normalizeAssistantProviderConfig(input)
  return assistantProviderSessionOptionsSchema.parse({
    model: normalized.model,
    reasoningEffort: normalized.reasoningEffort,
    sandbox: normalized.sandbox,
    approvalPolicy: normalized.approvalPolicy,
    profile: normalized.profile,
    oss: normalized.oss ?? false,
    baseUrl: normalized.baseUrl ?? undefined,
    apiKeyEnv: normalized.apiKeyEnv ?? undefined,
    providerName: normalized.providerName ?? undefined,
  })
}

export function serializeAssistantProviderOperatorDefaults(
  input: AssistantProviderConfigInput | null | undefined,
): Pick<
  AssistantOperatorDefaults,
  | 'approvalPolicy'
  | 'apiKeyEnv'
  | 'baseUrl'
  | 'codexCommand'
  | 'model'
  | 'oss'
  | 'profile'
  | 'providerName'
  | 'reasoningEffort'
  | 'sandbox'
> {
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
  }
}

export function assistantProviderConfigsEqual(
  left: AssistantProviderConfigInput | null | undefined,
  right: AssistantProviderConfigInput | null | undefined,
): boolean {
  const normalizedLeft = normalizeAssistantProviderConfig(left)
  const normalizedRight = normalizeAssistantProviderConfig(right)

  return (
    normalizedLeft.model === normalizedRight.model &&
    normalizedLeft.reasoningEffort === normalizedRight.reasoningEffort &&
    normalizedLeft.sandbox === normalizedRight.sandbox &&
    normalizedLeft.approvalPolicy === normalizedRight.approvalPolicy &&
    normalizedLeft.profile === normalizedRight.profile &&
    normalizedLeft.oss === normalizedRight.oss &&
    normalizedLeft.baseUrl === normalizedRight.baseUrl &&
    normalizedLeft.apiKeyEnv === normalizedRight.apiKeyEnv &&
    normalizedLeft.providerName === normalizedRight.providerName &&
    normalizedLeft.codexCommand === normalizedRight.codexCommand
  )
}
