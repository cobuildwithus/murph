import type {
  LinqListPhoneNumbersResponse,
  LinqSendMessageResponse,
} from '@healthybob/inboxd'
import { normalizeNullableString } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const DEFAULT_LINQ_API_BASE_URL = 'https://api.linqapp.com/api/partner/v3'

export interface LinqFetchResponse {
  arrayBuffer(): Promise<ArrayBuffer>
  json(): Promise<unknown>
  ok: boolean
  status: number
  text(): Promise<string>
}

export type LinqFetch = (
  input: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  },
) => Promise<LinqFetchResponse>

export interface ProbeLinqApiResult {
  ok: boolean
  phoneNumbers: string[]
}

export function resolveLinqApiToken(env: NodeJS.ProcessEnv): string | null {
  return (
    normalizeNullableString(env.LINQ_API_TOKEN) ??
    normalizeNullableString(env.HEALTHYBOB_LINQ_API_TOKEN)
  )
}

export function resolveLinqApiBaseUrl(env: NodeJS.ProcessEnv): string | null {
  return (
    normalizeNullableString(env.LINQ_API_BASE_URL) ??
    normalizeNullableString(env.HEALTHYBOB_LINQ_API_BASE_URL)
  )
}

export function resolveLinqWebhookSecret(env: NodeJS.ProcessEnv): string | null {
  return (
    normalizeNullableString(env.LINQ_WEBHOOK_SECRET) ??
    normalizeNullableString(env.HEALTHYBOB_LINQ_WEBHOOK_SECRET)
  )
}

export async function probeLinqApi(
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<ProbeLinqApiResult> {
  const env = dependencies.env ?? process.env
  const response = await requestLinqJson<LinqListPhoneNumbersResponse>({
    env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'GET',
    path: '/phonenumbers',
    signal: dependencies.signal,
  })

  return {
    ok: true,
    phoneNumbers: (response.phone_numbers ?? [])
      .map((entry) => normalizeNullableString(entry.phone_number ?? null))
      .filter((value): value is string => value !== null),
  }
}

export async function sendLinqChatMessage(
  input: {
    chatId: string
    message: string
    replyToMessageId?: string | null
  },
  dependencies: {
    env?: NodeJS.ProcessEnv
    fetchImplementation?: LinqFetch
    signal?: AbortSignal
  } = {},
): Promise<LinqSendMessageResponse> {
  const chatId = normalizeRequiredString(input.chatId, 'chat id')
  const message = normalizeRequiredString(input.message, 'message')
  const replyToMessageId = normalizeNullableString(input.replyToMessageId)

  return requestLinqJson<LinqSendMessageResponse>({
    env: dependencies.env ?? process.env,
    fetchImplementation: dependencies.fetchImplementation,
    method: 'POST',
    path: `/chats/${encodeURIComponent(chatId)}/messages`,
    body: {
      message: {
        parts: [
          {
            type: 'text',
            value: message,
          },
        ],
        ...(replyToMessageId
          ? {
              reply_to: {
                message_id: replyToMessageId,
              },
            }
          : {}),
      },
    },
    signal: dependencies.signal,
  })
}

async function requestLinqJson<T>(input: {
  env: NodeJS.ProcessEnv
  fetchImplementation?: LinqFetch
  method: 'GET' | 'POST'
  path: string
  body?: Record<string, unknown>
  signal?: AbortSignal
}): Promise<T> {
  const token = resolveLinqApiToken(input.env)
  if (!token) {
    throw new VaultCliError(
      'LINQ_API_TOKEN_REQUIRED',
      'Linq access requires LINQ_API_TOKEN or HEALTHYBOB_LINQ_API_TOKEN.',
    )
  }

  const fetchImplementation = input.fetchImplementation ?? globalThis.fetch?.bind(globalThis)
  if (typeof fetchImplementation !== 'function') {
    throw new VaultCliError(
      'LINQ_UNAVAILABLE',
      'Linq access requires fetch support in the current Node.js runtime.',
    )
  }

  const baseUrl = normalizeLinqBaseUrl(
    resolveLinqApiBaseUrl(input.env) ?? DEFAULT_LINQ_API_BASE_URL,
  )
  const url = new URL(input.path.replace(/^\//u, ''), `${baseUrl}/`)
  const response = await fetchImplementation(url.toString(), {
    method: input.method,
    headers: {
      authorization: `Bearer ${token}`,
      ...(input.body ? { 'content-type': 'application/json' } : {}),
    },
    body: input.body ? JSON.stringify(input.body) : undefined,
    signal: input.signal,
  })

  if (!response.ok) {
    throw await createLinqHttpError(response, input.method, input.path)
  }

  return (await response.json()) as T
}

async function createLinqHttpError(
  response: LinqFetchResponse,
  method: string,
  path: string,
): Promise<VaultCliError> {
  let payload: unknown = null
  let rawText: string | null = null

  try {
    payload = await response.json()
  } catch {
    try {
      rawText = await response.text()
    } catch {}
  }

  return new VaultCliError(
    'LINQ_API_REQUEST_FAILED',
    extractLinqErrorMessage(payload, rawText) ??
      `Linq request ${method} ${path} failed with HTTP ${response.status}.`,
    {
      method,
      path,
      status: response.status,
    },
  )
}

function extractLinqErrorMessage(payload: unknown, rawText: string | null): string | null {
  if (payload && typeof payload === 'object') {
    const record = payload as Record<string, unknown>
    return (
      normalizeNullableString(typeof record.message === 'string' ? record.message : null) ??
      normalizeNullableString(typeof record.error === 'string' ? record.error : null) ??
      normalizeNullableString(typeof record.detail === 'string' ? record.detail : null)
    )
  }

  return normalizeNullableString(rawText)
}

function normalizeLinqBaseUrl(value: string): string {
  return normalizeRequiredString(value, 'base url').replace(/\/+$/u, '')
}

function normalizeRequiredString(value: string | null | undefined, label: string): string {
  const normalized = normalizeNullableString(value)
  if (!normalized) {
    throw new VaultCliError('LINQ_INVALID_INPUT', `Linq ${label} must be a non-empty string.`)
  }

  return normalized
}
