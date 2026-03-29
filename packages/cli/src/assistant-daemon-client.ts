import {
  assistantAskResultSchema,
  assistantSessionCompatSchema,
  type AssistantAskResult,
  type AssistantSession,
} from './assistant-cli-contracts.js'
import type {
  AssistantMessageInput,
  AssistantSessionResolutionFields,
} from './assistant/service-contracts.js'
import type { ResolvedAssistantSession } from './assistant/store.js'
import { normalizeNullableString } from './assistant/shared.js'

const ASSISTANTD_BASE_URL_ENV_KEYS = [
  'MURPH_ASSISTANTD_BASE_URL',
  'ASSISTANTD_BASE_URL',
] as const
const ASSISTANTD_CONTROL_TOKEN_ENV_KEYS = [
  'MURPH_ASSISTANTD_CONTROL_TOKEN',
  'ASSISTANTD_CONTROL_TOKEN',
] as const
const ASSISTANTD_DISABLE_CLIENT_ENV = 'MURPH_ASSISTANTD_DISABLE_CLIENT'

export function resolveAssistantDaemonClientConfig(
  env: NodeJS.ProcessEnv = process.env,
): {
  baseUrl: string
  token: string
} | null {
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

export function canUseAssistantDaemonForMessage(
  input: AssistantMessageInput,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return false
  }

  return (
    input.abortSignal === undefined &&
    input.onProviderEvent === undefined &&
    input.onTraceEvent === undefined &&
    input.sessionSnapshot === undefined &&
    input.transcriptSnapshot === undefined
  )
}

export async function maybeSendAssistantMessageViaDaemon(
  input: AssistantMessageInput,
  env: NodeJS.ProcessEnv = process.env,
): Promise<AssistantAskResult | null> {
  if (!canUseAssistantDaemonForMessage(input, env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/message', {
    env,
    method: 'POST',
    body: serializeAssistantMessageInput(input),
  })
  return assistantAskResultSchema.parse(payload)
}

export async function maybeOpenAssistantConversationViaDaemon(
  input: AssistantSessionResolutionFields,
  env: NodeJS.ProcessEnv = process.env,
): Promise<ResolvedAssistantSession | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/open-conversation', {
    env,
    method: 'POST',
    body: input,
  })
  return parseResolvedAssistantSessionPayload(payload)
}

export async function maybeUpdateAssistantSessionOptionsViaDaemon(input: {
  providerOptions: Partial<AssistantSession['providerOptions']>
  sessionId: string
  vault: string
}, env: NodeJS.ProcessEnv = process.env): Promise<AssistantSession | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const payload = await assistantDaemonFetchJson('/session-options', {
    env,
    method: 'POST',
    body: input,
  })
  return assistantSessionCompatSchema.parse(payload)
}

async function assistantDaemonFetchJson(
  routePath: string,
  input: {
    body?: unknown
    env?: NodeJS.ProcessEnv
    method: 'GET' | 'POST'
  },
): Promise<unknown> {
  const config = resolveAssistantDaemonClientConfig(input.env ?? process.env)
  if (!config) {
    throw new Error('Assistant daemon client is not configured.')
  }

  const response = await fetch(`${config.baseUrl}${routePath}`, {
    method: input.method,
    headers: {
      Authorization: `Bearer ${config.token}`,
      'Content-Type': 'application/json',
    },
    body: input.body === undefined ? undefined : JSON.stringify(input.body),
  })

  const text = await response.text()
  const payload = text.trim().length > 0 ? JSON.parse(text) : null
  if (!response.ok) {
    const message =
      payload &&
      typeof payload === 'object' &&
      'error' in payload &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Assistant daemon request failed with HTTP ${response.status}.`
    throw new Error(message)
  }

  return payload
}

function serializeAssistantMessageInput(
  input: AssistantMessageInput,
): Omit<
  AssistantMessageInput,
  'abortSignal' | 'onProviderEvent' | 'onTraceEvent' | 'sessionSnapshot' | 'transcriptSnapshot'
> {
  const {
    abortSignal: _abortSignal,
    onProviderEvent: _onProviderEvent,
    onTraceEvent: _onTraceEvent,
    sessionSnapshot: _sessionSnapshot,
    transcriptSnapshot: _transcriptSnapshot,
    ...serializableInput
  } = input
  return serializableInput
}

function parseResolvedAssistantSessionPayload(payload: unknown): ResolvedAssistantSession {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid conversation payload.')
  }

  const record = payload as Record<string, unknown>
  if (typeof record.created !== 'boolean') {
    throw new Error('Assistant daemon conversation payload was missing the created flag.')
  }
  if (!record.paths || typeof record.paths !== 'object' || Array.isArray(record.paths)) {
    throw new Error('Assistant daemon conversation payload was missing assistant state paths.')
  }

  return {
    created: record.created,
    paths: record.paths as ResolvedAssistantSession['paths'],
    session: assistantSessionCompatSchema.parse(record.session),
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
  let parsed: URL
  try {
    parsed = new URL(baseUrl)
  } catch (error) {
    throw new Error(
      `Assistant daemon base URL must be a valid absolute URL: ${baseUrl}`,
      { cause: error },
    )
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error(
      'Assistant daemon bearer tokens may only target loopback HTTP(S) base URLs.',
    )
  }

  if (!isLoopbackAssistantDaemonHost(parsed.hostname)) {
    throw new Error(
      'Assistant daemon bearer tokens may only target loopback base URLs.',
    )
  }

  return baseUrl.replace(/\/+$/u, '')
}

function isLoopbackAssistantDaemonHost(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase().replace(/^\[|\]$/gu, '')
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('127.') ||
    normalized.startsWith('::ffff:127.')
  )
}
