import { isLoopbackHttpBaseUrl } from '@murph/runtime-state'
import {
  gatewayAttachmentSchema,
  gatewayConversationSchema,
  gatewayFetchAttachmentsInputSchema,
  gatewayGetConversationInputSchema,
  gatewayListConversationsInputSchema,
  gatewayListConversationsResultSchema,
  gatewayListOpenPermissionsInputSchema,
  gatewayPermissionRequestSchema,
  gatewayPollEventsInputSchema,
  gatewayPollEventsResultSchema,
  gatewayReadMessagesInputSchema,
  gatewayReadMessagesResultSchema,
  gatewayRespondToPermissionInputSchema,
  gatewaySendMessageInputSchema,
  gatewaySendMessageResultSchema,
  gatewayWaitForEventsInputSchema,
  type GatewayAttachment,
  type GatewayConversation,
  type GatewayFetchAttachmentsInput,
  type GatewayGetConversationInput,
  type GatewayListConversationsInput,
  type GatewayListConversationsResult,
  type GatewayListOpenPermissionsInput,
  type GatewayPermissionRequest,
  type GatewayPollEventsInput,
  type GatewayPollEventsResult,
  type GatewayReadMessagesInput,
  type GatewayReadMessagesResult,
  type GatewayRespondToPermissionInput,
  type GatewaySendMessageInput,
  type GatewaySendMessageResult,
  type GatewayWaitForEventsInput,
} from '@murph/gateway-core'

const ASSISTANTD_BASE_URL_ENV_KEYS = [
  'MURPH_ASSISTANTD_BASE_URL',
  'ASSISTANTD_BASE_URL',
] as const
const ASSISTANTD_CONTROL_TOKEN_ENV_KEYS = [
  'MURPH_ASSISTANTD_CONTROL_TOKEN',
  'ASSISTANTD_CONTROL_TOKEN',
] as const
const ASSISTANTD_DISABLE_CLIENT_ENV = 'MURPH_ASSISTANTD_DISABLE_CLIENT'

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

export async function maybeListGatewayConversationsViaDaemon(
  input: GatewayListConversationsInput & { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayListConversationsResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const { vault, ...gatewayInput } = input
  const payload = await assistantdClientFetchJson('/gateway/conversations/list', {
    body: {
      ...gatewayListConversationsInputSchema.parse(gatewayInput),
      vault,
    },
    env,
    method: 'POST',
  })
  return gatewayListConversationsResultSchema.parse(payload)
}

export async function maybeGetGatewayConversationViaDaemon(
  input: GatewayGetConversationInput & { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayConversation | null | undefined> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return undefined
  }

  const { vault, ...gatewayInput } = input
  const payload = await assistantdClientFetchJson('/gateway/conversations/get', {
    body: {
      ...gatewayGetConversationInputSchema.parse(gatewayInput),
      vault,
    },
    env,
    method: 'POST',
  })
  return payload === null ? null : gatewayConversationSchema.parse(payload)
}

export async function maybeReadGatewayMessagesViaDaemon(
  input: GatewayReadMessagesInput & { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayReadMessagesResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const { vault, ...gatewayInput } = input
  const payload = await assistantdClientFetchJson('/gateway/messages/read', {
    body: {
      ...gatewayReadMessagesInputSchema.parse(gatewayInput),
      vault,
    },
    env,
    method: 'POST',
  })
  return gatewayReadMessagesResultSchema.parse(payload)
}

export async function maybeFetchGatewayAttachmentsViaDaemon(
  input: GatewayFetchAttachmentsInput & { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayAttachment[] | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const { vault, ...gatewayInput } = input
  const payload = await assistantdClientFetchJson('/gateway/attachments/fetch', {
    body: {
      ...gatewayFetchAttachmentsInputSchema.parse(gatewayInput),
      vault,
    },
    env,
    method: 'POST',
  })
  if (!Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid gateway attachment payload.')
  }
  return payload.map((entry) => gatewayAttachmentSchema.parse(entry))
}

export async function maybeSendGatewayMessageViaDaemon(
  input: GatewaySendMessageInput & { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewaySendMessageResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const { vault, ...gatewayInput } = input
  const payload = await assistantdClientFetchJson('/gateway/messages/send', {
    body: {
      ...gatewaySendMessageInputSchema.parse(gatewayInput),
      vault,
    },
    env,
    method: 'POST',
  })
  return gatewaySendMessageResultSchema.parse(payload)
}

export async function maybePollGatewayEventsViaDaemon(
  input: GatewayPollEventsInput & { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayPollEventsResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const { vault, ...gatewayInput } = input
  const payload = await assistantdClientFetchJson('/gateway/events/poll', {
    body: {
      ...gatewayPollEventsInputSchema.parse(gatewayInput),
      vault,
    },
    env,
    method: 'POST',
  })
  return gatewayPollEventsResultSchema.parse(payload)
}

export async function maybeWaitForGatewayEventsViaDaemon(
  input: GatewayWaitForEventsInput & { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayPollEventsResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const { vault, ...gatewayInput } = input
  const payload = await assistantdClientFetchJson('/gateway/events/wait', {
    body: {
      ...gatewayWaitForEventsInputSchema.parse(gatewayInput),
      vault,
    },
    env,
    method: 'POST',
  })
  return gatewayPollEventsResultSchema.parse(payload)
}

export async function maybeListGatewayOpenPermissionsViaDaemon(
  input: GatewayListOpenPermissionsInput & { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayPermissionRequest[] | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const { vault, ...gatewayInput } = input
  const payload = await assistantdClientFetchJson('/gateway/permissions/list-open', {
    body: {
      ...gatewayListOpenPermissionsInputSchema.parse(gatewayInput),
      vault,
    },
    env,
    method: 'POST',
  })
  if (!Array.isArray(payload)) {
    throw new Error('Assistant daemon returned an invalid gateway permissions payload.')
  }
  return payload.map((entry) => gatewayPermissionRequestSchema.parse(entry))
}

export async function maybeRespondToGatewayPermissionViaDaemon(
  input: GatewayRespondToPermissionInput & { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayPermissionRequest | null | undefined> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return undefined
  }

  const { vault, ...gatewayInput } = input
  const payload = await assistantdClientFetchJson('/gateway/permissions/respond', {
    body: {
      ...gatewayRespondToPermissionInputSchema.parse(gatewayInput),
      vault,
    },
    env,
    method: 'POST',
  })
  return payload === null ? null : gatewayPermissionRequestSchema.parse(payload)
}

async function assistantdClientFetchJson(
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

  const headers = new Headers({
    Authorization: `Bearer ${config.token}`,
  })
  if (input.body !== undefined) {
    headers.set('Content-Type', 'application/json')
  }

  let response: Response
  try {
    response = await fetch(`${config.baseUrl}${routePath}`, {
      method: input.method,
      headers,
      body: input.body === undefined ? undefined : JSON.stringify(input.body),
    })
  } catch (error) {
    throw new Error(
      `Assistant daemon gateway request failed before receiving a response for ${routePath}.`,
      { cause: error },
    )
  }

  const text = await response.text()
  const parsedPayload = parseAssistantdClientJsonPayload(text)
  if (!response.ok) {
    throw buildAssistantdClientHttpError(
      parsedPayload.ok ? parsedPayload.value : parseAssistantdClientTextPayload(text),
      response.status,
    )
  }

  if (!parsedPayload.ok) {
    throw new Error(
      `Assistant daemon returned an invalid JSON response for ${routePath}.`,
      { cause: parsedPayload.error },
    )
  }

  return parsedPayload.value
}

function buildAssistantdClientHttpError(payload: unknown, status: number): Error {
  const message =
    readAssistantdClientPayloadStringField(payload, 'error') ??
    (typeof payload === 'string' && payload.length > 0 ? payload : null) ??
    `Assistant daemon request failed with HTTP ${status}.`
  const error = new Error(message) as Error & { code?: string; status?: number }
  const code = readAssistantdClientPayloadStringField(payload, 'code')
  if (code) {
    error.code = code
  }
  error.status = status
  return error
}

function parseAssistantdClientJsonPayload(text: string):
  | { ok: true; value: unknown }
  | { error: unknown; ok: false } {
  const trimmed = text.trim()
  if (trimmed.length === 0) {
    return {
      ok: true,
      value: null,
    }
  }

  try {
    return {
      ok: true,
      value: JSON.parse(trimmed) as unknown,
    }
  } catch (error) {
    return {
      ok: false,
      error,
    }
  }
}

function parseAssistantdClientTextPayload(text: string): string | null {
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readAssistantdClientPayloadStringField(
  payload: unknown,
  key: string,
): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
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
  const normalized = baseUrl.replace(/\/+$/u, '')
  try {
    if (!isLoopbackHttpBaseUrl(normalized)) {
      throw new Error('Assistant daemon base URL must use loopback-only http:// addressing.')
    }
  } catch (error) {
    throw new Error(
      `Assistant daemon base URL must be a valid loopback-only http:// URL: ${baseUrl}`,
      { cause: error },
    )
  }
  return normalized
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
