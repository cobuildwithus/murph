import { createHash } from 'node:crypto'

import { normalizeNullableString } from './shared.js'
import { VaultCliError } from '../vault-cli-errors.js'

export const assistantExecutionDriverValues = [
  'codex-app-server',
] as const

export const assistantResumeKindValues = [
  'codex-thread',
] as const

export type AssistantExecutionDriver =
  (typeof assistantExecutionDriverValues)[number]
export type AssistantResumeKind = (typeof assistantResumeKindValues)[number]

export const assistantCodexModelProviderWireApiValues = ['responses'] as const

export type AssistantCodexModelProviderWireApi =
  (typeof assistantCodexModelProviderWireApiValues)[number]

export interface AssistantCodexModelProviderConfig {
  id: string
  name: string
  baseUrl: string
  envKey: string
  failureHint?: string
  supportsWebSockets?: boolean
  wireApi: AssistantCodexModelProviderWireApi
}

export const OPENAI_CODEX_MODEL_PROVIDER_ID = 'openai'
export const HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID = 'hosted-openai'
// The hosted runtime writes this internal provider into its generated Codex
// config when local development uses ChatGPT subscription auth.
export const HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID =
  'hosted-chatgpt-openai'
// Hosted-local routes OpenAI through its recorder origin.
export const HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID = 'openai-local-test'

export function resolveAssistantCodexUsageProviderName(
  modelProviderId: string | null,
): string | null {
  return modelProviderId === HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID
    ? HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID
    : modelProviderId
}

export const CODEX_RESERVED_MODEL_PROVIDER_IDS = [
  OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_CHATGPT_OPENAI_CODEX_MODEL_PROVIDER_ID,
  HOSTED_LOCAL_TEST_CODEX_MODEL_PROVIDER_ID,
] as const
const CODEX_RESERVED_MODEL_PROVIDER_ID_SET = new Set<string>(
  CODEX_RESERVED_MODEL_PROVIDER_IDS,
)

export const OPENAI_CODEX_MODEL_PROVIDER_CONFIG = {
  id: OPENAI_CODEX_MODEL_PROVIDER_ID,
  name: 'OpenAI',
  baseUrl: 'https://api.openai.com/v1',
  envKey: 'OPENAI_API_KEY',
  supportsWebSockets: true,
  wireApi: 'responses',
} as const satisfies AssistantCodexModelProviderConfig

export const ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS = [
  OPENAI_CODEX_MODEL_PROVIDER_CONFIG,
] as const satisfies readonly AssistantCodexModelProviderConfig[]

export const ASSISTANT_CODEX_MODEL_PROVIDER_IDS =
  ASSISTANT_CODEX_MODEL_PROVIDER_CONFIGS.map((config) => config.id)

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
  return normalized === OPENAI_CODEX_MODEL_PROVIDER_ID
    ? OPENAI_CODEX_MODEL_PROVIDER_CONFIG
    : null
}

export function resolveStrictAssistantCodexModelProvider(
  value: string | null | undefined,
): {
  config: AssistantCodexModelProviderConfig | null
  id: string | null
} {
  const raw = normalizeNullableString(value)
  if (!raw) {
    return {
      config: null,
      id: null,
    }
  }

  const id = normalizeAssistantCodexModelProvider(raw)
  if (!id) {
    throw new VaultCliError(
      'invalid_option',
      `Unknown Codex model provider: ${raw}.`,
    )
  }

  const config = resolveAssistantCodexModelProviderConfig(id)
  if (!config && !isCodexReservedModelProviderId(id)) {
    throw new VaultCliError(
      'invalid_option',
      `Unknown Codex model provider: ${raw}.`,
    )
  }

  return {
    config,
    id,
  }
}

export function isCodexReservedModelProviderId(
  value: string | null | undefined,
): boolean {
  const normalized = normalizeAssistantCodexModelProvider(value)
  return normalized !== null && CODEX_RESERVED_MODEL_PROVIDER_ID_SET.has(normalized)
}

export function buildCodexAssistantContinuityFingerprint(
  input: {
    approvalPolicy?: string | null
    codexHome?: string | null
    model?: string | null
    modelProvider?: string | null
    oss?: boolean | null
    profile?: string | null
    sandbox?: string | null
  },
): string {
  const identity = JSON.stringify({
    provider: 'codex-cli',
    executionDriver: 'codex-app-server',
    modelProvider: normalizeAssistantCodexModelProvider(input.modelProvider),
    model: null,
    sandbox: normalizeNullableString(input.sandbox),
    approvalPolicy: normalizeNullableString(input.approvalPolicy),
    profile: normalizeNullableString(input.profile),
    oss: input.oss === true,
    codexHome: normalizeNullableString(input.codexHome),
  })
  return `sha256:${createHash('sha256').update(identity).digest('hex')}`
}

function unsupportedAssistantRuntimeTargetMessage(): string {
  return 'Assistant runtime targets must use Codex App Server. Reconfigure the assistant for Codex App Server.'
}
