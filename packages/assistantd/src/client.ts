import { isLoopbackHttpBaseUrl } from '@murphai/runtime-state'

const ASSISTANTD_BASE_URL_ENV_KEYS = ['MURPH_ASSISTANTD_BASE_URL'] as const
const ASSISTANTD_CONTROL_TOKEN_ENV_KEYS = ['MURPH_ASSISTANTD_CONTROL_TOKEN'] as const
const ASSISTANTD_DISABLE_CLIENT_ENV = 'MURPH_ASSISTANTD_DISABLE_CLIENT'

export const assistantDaemonSessionResolutionWireFields = [
  'alias',
  'approvalPolicy',
  'channel',
  'codexHome',
  'conversation',
  'identityId',
  'maxSessionAgeMs',
  'model',
  'modelProvider',
  'participantId',
  'profile',
  'reasoningEffort',
  'sandbox',
  'sessionId',
  'threadId',
  'threadIsDirect',
  'vault',
] as const

export const assistantDaemonMessageWireFields = [
  ...assistantDaemonSessionResolutionWireFields,
  'codexCommand',
  'deliverResponse',
  'deliveryReplyToMessageId',
  'deliverySubject',
  'deliveryTarget',
  'includeEarlySessionOnboarding',
  'operatorAuthority',
  'persistUserPromptOnFailure',
  'prompt',
  'turnTrigger',
  'workingDirectory',
] as const

export interface AssistantDaemonClientConfig {
  baseUrl: string
  token: string
}

export function resolveAssistantDaemonClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): AssistantDaemonClientConfig | null {
  if (env[ASSISTANTD_DISABLE_CLIENT_ENV] === '1') {
    return null
  }

  const baseUrl = firstAssistantDaemonEnvValue(env, ASSISTANTD_BASE_URL_ENV_KEYS)
  const token = firstAssistantDaemonEnvValue(env, ASSISTANTD_CONTROL_TOKEN_ENV_KEYS)
  if (!baseUrl || !token) {
    return null
  }

  return {
    baseUrl: normalizeAssistantDaemonBaseUrl(baseUrl),
    token,
  }
}

function firstAssistantDaemonEnvValue(
  env: NodeJS.ProcessEnv,
  keys: readonly string[],
): string | null {
  for (const key of keys) {
    const value = normalizeNullableString(env[key])
    if (value) {
      return value
    }
  }
  return null
}

function normalizeAssistantDaemonBaseUrl(baseUrl: string): string {
  const trimmed = baseUrl.trim()
  try {
    const url = new URL(trimmed)
    if (
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      (url.pathname !== '' && url.pathname !== '/')
    ) {
      throw new Error('Assistant daemon base URL must be an origin-only URL.')
    }
    if (!isLoopbackHttpBaseUrl(url.origin)) {
      throw new Error('Assistant daemon base URL must use loopback-only http:// addressing.')
    }
    return url.origin
  } catch (error) {
    throw new Error(
      'Assistant daemon base URL must be a valid loopback-only http:// origin URL.',
      { cause: error },
    )
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
