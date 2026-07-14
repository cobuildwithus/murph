import {
  fetchJsonResponse,
  readJsonErrorResponse,
} from './http-json-retry.js'
import { normalizeNullableString } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const DEFAULT_WHATSAPP_API_BASE_URL = 'https://graph.facebook.com'
const DEFAULT_WHATSAPP_GRAPH_VERSION = 'v25.0'
const WHATSAPP_SEND_TIMEOUT_MS = 30_000
const WHATSAPP_MAX_TEXT_LENGTH = 4096

export interface WhatsAppFetchResponse {
  headers?: {
    get(name: string): string | null
  } | null
  json(): Promise<unknown>
  ok: boolean
  status: number
  text(): Promise<string>
}

export type WhatsAppFetch = (
  input: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  },
) => Promise<WhatsAppFetchResponse>

export interface WhatsAppTextMessageDelivery {
  providerMessageId: string | null
  providerThreadId: string | null
  target: string
}

export function resolveWhatsAppAccessToken(
  env: NodeJS.ProcessEnv,
): string | null {
  return normalizeNullableString(env.WHATSAPP_ACCESS_TOKEN)
}

export function resolveWhatsAppPhoneNumberId(
  env: NodeJS.ProcessEnv,
): string | null {
  return normalizeNullableString(env.WHATSAPP_PHONE_NUMBER_ID)
}

export function resolveWhatsAppGraphVersion(
  env: NodeJS.ProcessEnv,
): string {
  return normalizeNullableString(env.WHATSAPP_GRAPH_VERSION)
    ?? DEFAULT_WHATSAPP_GRAPH_VERSION
}

export function resolveWhatsAppApiBaseUrl(
  env: NodeJS.ProcessEnv,
): string {
  return (
    normalizeNullableString(env.WHATSAPP_API_BASE_URL)
    ?? DEFAULT_WHATSAPP_API_BASE_URL
  ).replace(/\/+$/u, '')
}

export async function sendWhatsAppTextMessage(
  input: {
    message: string
    replyToMessageId?: string | null
    target: string
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: WhatsAppFetch
    signal?: AbortSignal
  } = {},
): Promise<WhatsAppTextMessageDelivery> {
  const env = dependencies.env ?? process.env
  const accessToken = resolveWhatsAppAccessToken(env)
  if (!accessToken) {
    throw new VaultCliError(
      'ASSISTANT_WHATSAPP_ACCESS_TOKEN_REQUIRED',
      'Outbound WhatsApp delivery requires WHATSAPP_ACCESS_TOKEN.',
    )
  }

  const phoneNumberId = resolveWhatsAppPhoneNumberId(env)
  if (!phoneNumberId) {
    throw new VaultCliError(
      'ASSISTANT_WHATSAPP_PHONE_NUMBER_ID_REQUIRED',
      'Outbound WhatsApp delivery requires WHATSAPP_PHONE_NUMBER_ID.',
    )
  }

  const fetchImplementation =
    dependencies.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw new VaultCliError(
      'ASSISTANT_WHATSAPP_UNAVAILABLE',
      'Outbound WhatsApp delivery requires fetch support in the current runtime.',
    )
  }

  const graphVersion = normalizeWhatsAppGraphVersion(
    resolveWhatsAppGraphVersion(env),
  )
  const target = normalizeWhatsAppRecipient(input.target)
  const message = normalizeWhatsAppMessage(input.message)
  const replyToMessageId = normalizeNullableString(input.replyToMessageId)
  const url = `${resolveWhatsAppApiBaseUrl(env)}/${graphVersion}/${encodeURIComponent(phoneNumberId)}/messages`

  const response = await fetchJsonResponse({
    body: JSON.stringify({
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: target,
      type: 'text',
      ...(replyToMessageId
        ? {
            context: {
              message_id: replyToMessageId,
            },
          }
        : {}),
      text: {
        body: message,
        preview_url: false,
      },
    }),
    createTransportError: ({ error, timedOut }) =>
      Object.assign(
        new VaultCliError(
          'ASSISTANT_WHATSAPP_REQUEST_FAILED',
          'WhatsApp Cloud API send request failed before a response was received.',
          {
            failureStage: 'transport',
            operation: 'send_text',
            provider: 'whatsapp',
            retryable: false,
            timedOut,
            transportError: describeWhatsAppUnknownError(error),
          },
        ),
        {
          deliveryMayHaveSucceeded: true as const,
          retryable: false as const,
        },
      ),
    fetchImplementation,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    method: 'POST',
    signal: dependencies.signal,
    treatCallerAbortAsTransportAmbiguity: true,
    timeoutMs: WHATSAPP_SEND_TIMEOUT_MS,
    url,
  })

  if (!response.ok) {
    throw await createWhatsAppHttpError(response)
  }

  const payload = await readWhatsAppJsonPayload(response)
  const delivered = parseWhatsAppTextMessageDelivery(payload)

  return {
    providerMessageId: delivered.messageId,
    providerThreadId: delivered.waId ?? target,
    target: delivered.waId ?? target,
  }
}

function normalizeWhatsAppGraphVersion(value: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized || !/^v[0-9]+\.[0-9]+$/u.test(normalized)) {
    throw new VaultCliError(
      'ASSISTANT_WHATSAPP_GRAPH_VERSION_INVALID',
      'WHATSAPP_GRAPH_VERSION must look like v25.0.',
    )
  }

  return normalized
}

function normalizeWhatsAppRecipient(value: string): string {
  const normalized = normalizeNullableString(value)
  const digits = normalized?.replace(/[+\s().-]/gu, '') ?? ''
  if (!/^[1-9][0-9]{5,20}$/u.test(digits)) {
    throw new VaultCliError(
      'ASSISTANT_WHATSAPP_TARGET_INVALID',
      'WhatsApp delivery requires a wa_id or E.164 phone number without local formatting.',
      {
        target: '[redacted-whatsapp-target]',
      },
    )
  }

  return digits
}

function normalizeWhatsAppMessage(value: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new VaultCliError(
      'ASSISTANT_WHATSAPP_MESSAGE_REQUIRED',
      'WhatsApp delivery requires a non-empty text message.',
    )
  }

  if (normalized.length > WHATSAPP_MAX_TEXT_LENGTH) {
    throw new VaultCliError(
      'ASSISTANT_WHATSAPP_MESSAGE_TOO_LONG',
      `WhatsApp text messages must be ${WHATSAPP_MAX_TEXT_LENGTH} characters or fewer.`,
      {
        messageLength: normalized.length,
      },
    )
  }

  return normalized
}

async function readWhatsAppJsonPayload(
  response: Pick<WhatsAppFetchResponse, 'json'>,
): Promise<unknown> {
  try {
    return await response.json()
  } catch {
    return null
  }
}

async function createWhatsAppHttpError(
  response: WhatsAppFetchResponse,
): Promise<VaultCliError> {
  const errorPayload = await readJsonErrorResponse(response)
  const context = extractWhatsAppErrorContext(errorPayload.payload)
  return new VaultCliError(
    'ASSISTANT_WHATSAPP_REQUEST_FAILED',
    context.message ??
      `WhatsApp Cloud API send_text failed with HTTP ${response.status}.`,
    {
      errorCode: context.code,
      errorSubcode: context.subcode,
      errorType: context.type,
      failureStage: 'http',
      operation: 'send_text',
      provider: 'whatsapp',
      retryable: response.status === 429 || response.status >= 500,
      status: response.status,
    },
  )
}

function extractWhatsAppErrorContext(value: unknown): {
  code: number | null
  message: string | null
  subcode: number | null
  type: string | null
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      code: null,
      message: null,
      subcode: null,
      type: null,
    }
  }

  const error = 'error' in value ? (value as { error?: unknown }).error : null
  if (!error || typeof error !== 'object' || Array.isArray(error)) {
    return {
      code: null,
      message: null,
      subcode: null,
      type: null,
    }
  }

  const record = error as Record<string, unknown>
  return {
    code: typeof record.code === 'number' ? record.code : null,
    message: typeof record.message === 'string' && record.message.trim()
      ? record.message.trim()
      : null,
    subcode: typeof record.error_subcode === 'number'
      ? record.error_subcode
      : null,
    type: typeof record.type === 'string' && record.type.trim()
      ? record.type.trim()
      : null,
  }
}

function parseWhatsAppTextMessageDelivery(value: unknown): {
  messageId: string | null
  waId: string | null
} {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {
      messageId: null,
      waId: null,
    }
  }

  const record = value as Record<string, unknown>
  const messages = Array.isArray(record.messages) ? record.messages : []
  const contacts = Array.isArray(record.contacts) ? record.contacts : []
  const firstMessage = messages[0]
  const firstContact = contacts[0]

  return {
    messageId: readWhatsAppObjectString(firstMessage, 'id'),
    waId: readWhatsAppObjectString(firstContact, 'wa_id'),
  }
}

function readWhatsAppObjectString(value: unknown, key: string): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null
  }

  const entry = (value as Record<string, unknown>)[key]
  return typeof entry === 'string' && entry.trim() ? entry.trim() : null
}

function describeWhatsAppUnknownError(error: unknown): {
  message: string
  name: string
} {
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
    }
  }

  return {
    message: String(error),
    name: 'Error',
  }
}
