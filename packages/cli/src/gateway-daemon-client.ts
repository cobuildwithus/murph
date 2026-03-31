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

import { resolveAssistantDaemonClientConfig } from './assistant-daemon-client.js'

export async function maybeListGatewayConversationsViaDaemon(
  input: GatewayListConversationsInput & { vault: string },
  env: NodeJS.ProcessEnv = process.env,
): Promise<GatewayListConversationsResult | null> {
  if (!resolveAssistantDaemonClientConfig(env)) {
    return null
  }

  const { vault, ...gatewayInput } = input
  const payload = await gatewayDaemonFetchJson('/gateway/conversations/list', {
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
  const payload = await gatewayDaemonFetchJson('/gateway/conversations/get', {
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
  const payload = await gatewayDaemonFetchJson('/gateway/messages/read', {
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
  const payload = await gatewayDaemonFetchJson('/gateway/attachments/fetch', {
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
  const payload = await gatewayDaemonFetchJson('/gateway/messages/send', {
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
  const payload = await gatewayDaemonFetchJson('/gateway/events/poll', {
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
  const payload = await gatewayDaemonFetchJson('/gateway/events/wait', {
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
  const payload = await gatewayDaemonFetchJson('/gateway/permissions/list-open', {
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
  const payload = await gatewayDaemonFetchJson('/gateway/permissions/respond', {
    body: {
      ...gatewayRespondToPermissionInputSchema.parse(gatewayInput),
      vault,
    },
    env,
    method: 'POST',
  })
  return payload === null ? null : gatewayPermissionRequestSchema.parse(payload)
}

async function gatewayDaemonFetchJson(
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
  const parsedPayload = parseGatewayDaemonJsonPayload(text)
  if (!response.ok) {
    throw buildGatewayDaemonHttpError(
      parsedPayload.ok ? parsedPayload.value : parseGatewayDaemonTextPayload(text),
      response.status,
    )
  }

  if (!parsedPayload.ok) {
    throw new Error(
      `Assistant daemon returned an invalid gateway JSON response for ${routePath}.`,
      { cause: parsedPayload.error },
    )
  }

  return parsedPayload.value
}

function parseGatewayDaemonJsonPayload(text: string):
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

function parseGatewayDaemonTextPayload(text: string): string | null {
  const trimmed = text.trim()
  return trimmed.length > 0 ? trimmed : null
}

function buildGatewayDaemonHttpError(payload: unknown, status: number): Error {
  const message =
    readGatewayDaemonPayloadStringField(payload, 'error') ??
    (typeof payload === 'string' && payload.length > 0 ? payload : null) ??
    `Assistant daemon gateway request failed with HTTP ${status}.`
  const error = new Error(message) as Error & { code?: string; status?: number }
  const code = readGatewayDaemonPayloadStringField(payload, 'code')
  if (code) {
    error.code = code
  }
  error.status = status
  return error
}

function readGatewayDaemonPayloadStringField(payload: unknown, key: string): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null
  }
  const value = (payload as Record<string, unknown>)[key]
  return typeof value === 'string' && value.length > 0 ? value : null
}
