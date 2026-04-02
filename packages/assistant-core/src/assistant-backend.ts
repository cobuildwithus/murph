import { z } from 'zod'
import {
  assistantApprovalPolicyValues,
  assistantChatProviderValues,
  assistantHeadersSchema,
  assistantReasoningEffortValues,
  assistantSandboxValues,
  type AssistantApprovalPolicy,
  type AssistantChatProvider,
  type AssistantReasoningEffort,
  type AssistantSandbox,
} from './assistant-cli-contracts.js'
import {
  normalizeAssistantProviderConfig,
  type AssistantProviderConfig,
  type AssistantProviderConfigInput,
} from './assistant/provider-config.js'

export const assistantBackendOptionsSchema = z
  .record(z.string().min(1), z.unknown())
  .nullable()
  .default(null)

export const assistantBackendTargetSchema = z
  .object({
    adapter: z.enum(assistantChatProviderValues),
    model: z.string().min(1).nullable().default(null),
    endpoint: z.string().min(1).nullable().default(null),
    apiKeyEnv: z.string().min(1).nullable().default(null),
    providerName: z.string().min(1).nullable().default(null),
    headers: assistantHeadersSchema.nullable().default(null),
    options: assistantBackendOptionsSchema,
  })
  .strict()

export type AssistantBackendTarget = z.infer<typeof assistantBackendTargetSchema>

export function createAssistantBackendTarget(
  input: AssistantProviderConfigInput | null | undefined,
): AssistantBackendTarget | null {
  const normalized = normalizeAssistantProviderConfig(input)
  const target = assistantBackendTargetSchema.parse({
    adapter: normalized.provider,
    model: normalized.model,
    endpoint: normalized.baseUrl,
    apiKeyEnv: normalized.apiKeyEnv,
    providerName: normalized.providerName,
    headers: normalized.provider === 'openai-compatible' ? normalized.headers : null,
    options: buildAssistantBackendOptions(normalized),
  })

  return hasAssistantBackendTargetValues(target) ? target : null
}

export function normalizeAssistantBackendTarget(
  target: AssistantBackendTarget | null | undefined,
): AssistantBackendTarget | null {
  if (!target) {
    return null
  }

  return createAssistantBackendTarget(
    assistantBackendTargetToProviderConfigInput(
      assistantBackendTargetSchema.parse(target),
    ),
  )
}

export function assistantBackendTargetToProviderConfigInput(
  target: AssistantBackendTarget,
): AssistantProviderConfigInput {
  return {
    provider: target.adapter,
    model: normalizeStringOption(target.model),
    baseUrl: normalizeStringOption(target.endpoint),
    apiKeyEnv: normalizeStringOption(target.apiKeyEnv),
    providerName: normalizeStringOption(target.providerName),
    headers: target.adapter === 'openai-compatible' ? target.headers ?? null : null,
    approvalPolicy: readAssistantApprovalPolicyOption(target.options, 'approvalPolicy'),
    codexCommand: readStringOption(target.options, 'codexCommand'),
    oss: readBooleanOption(target.options, 'oss'),
    profile: readStringOption(target.options, 'profile'),
    reasoningEffort: readAssistantReasoningEffortOption(
      target.options,
      'reasoningEffort',
    ),
    sandbox: readAssistantSandboxOption(target.options, 'sandbox'),
  }
}

export function assistantBackendTargetsEqual(
  left: AssistantBackendTarget | null | undefined,
  right: AssistantBackendTarget | null | undefined,
): boolean {
  return JSON.stringify(normalizeAssistantBackendTarget(left)) === JSON.stringify(
    normalizeAssistantBackendTarget(right),
  )
}

function buildAssistantBackendOptions(
  config: AssistantProviderConfig,
): Record<string, unknown> | null {
  const options: Record<string, unknown> = {}

  if (config.approvalPolicy) {
    options.approvalPolicy = config.approvalPolicy
  }
  if (config.codexCommand) {
    options.codexCommand = config.codexCommand
  }
  if (config.oss) {
    options.oss = true
  }
  if (config.profile) {
    options.profile = config.profile
  }
  if (config.reasoningEffort) {
    options.reasoningEffort = config.reasoningEffort
  }
  if (config.sandbox) {
    options.sandbox = config.sandbox
  }

  return Object.keys(options).length > 0 ? options : null
}

function hasAssistantBackendTargetValues(target: AssistantBackendTarget): boolean {
  return Boolean(
    target.model ??
      target.endpoint ??
      target.apiKeyEnv ??
      target.providerName ??
      (target.headers && Object.keys(target.headers).length > 0 ? 'headers' : null) ??
      (target.options && Object.keys(target.options).length > 0 ? 'options' : null),
  )
}

function normalizeStringOption(value: string | null | undefined): string | null {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function readStringOption(
  options: Record<string, unknown> | null | undefined,
  key: string,
): string | null {
  return typeof options?.[key] === 'string'
    ? normalizeStringOption(options[key] as string)
    : null
}

function readBooleanOption(
  options: Record<string, unknown> | null | undefined,
  key: string,
): boolean | null {
  return typeof options?.[key] === 'boolean' ? options[key] : null
}

function readAssistantSandboxOption(
  options: Record<string, unknown> | null | undefined,
  key: string,
): AssistantSandbox | null {
  const value = readStringOption(options, key)
  return value && assistantSandboxValues.includes(value as AssistantSandbox)
    ? (value as AssistantSandbox)
    : null
}

function readAssistantApprovalPolicyOption(
  options: Record<string, unknown> | null | undefined,
  key: string,
): AssistantApprovalPolicy | null {
  const value = readStringOption(options, key)
  return value && assistantApprovalPolicyValues.includes(value as AssistantApprovalPolicy)
    ? (value as AssistantApprovalPolicy)
    : null
}

function readAssistantReasoningEffortOption(
  options: Record<string, unknown> | null | undefined,
  key: string,
): AssistantReasoningEffort | null {
  const value = readStringOption(options, key)
  return value && assistantReasoningEffortValues.includes(value as AssistantReasoningEffort)
    ? (value as AssistantReasoningEffort)
    : null
}
