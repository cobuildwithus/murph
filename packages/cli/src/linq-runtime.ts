import type {
  LinqListPhoneNumbersResponse,
  LinqSendMessageResponse,
} from '@healthybob/inboxd'
import { errorMessage, normalizeNullableString } from './text/shared.js'
import { VaultCliError } from './vault-cli-errors.js'

const DEFAULT_LINQ_API_BASE_URL = 'https://api.linqapp.com/api/partner/v3'
const LINQ_HTTP_TIMEOUT_MS = 30_000
const LINQ_HTTP_MAX_ATTEMPTS = 3
const LINQ_HTTP_RETRY_DELAYS_MS = Object.freeze([1_000, 3_000])

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
  let attempt = 1

  while (true) {
    let response: LinqFetchResponse

    try {
      response = await fetchLinqResponse({
        fetchImplementation,
        url: url.toString(),
        method: input.method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(input.body ? { 'content-type': 'application/json' } : {}),
        },
        body: input.body ? JSON.stringify(input.body) : undefined,
        signal: input.signal,
        path: input.path,
      })
    } catch (error) {
      if (isRetryableLinqRequestError(error) && attempt < LINQ_HTTP_MAX_ATTEMPTS) {
        await waitForLinqRetryDelay(attempt, input.signal)
        attempt += 1
        continue
      }

      throw error
    }

    if (!response.ok) {
      const failure = await createLinqHttpError(response, input.method, input.path)
      if (isRetryableLinqRequestError(failure) && attempt < LINQ_HTTP_MAX_ATTEMPTS) {
        await waitForLinqRetryDelay(attempt, input.signal)
        attempt += 1
        continue
      }

      throw failure
    }

    return (await response.json()) as T
  }
}

async function fetchLinqResponse(input: {
  fetchImplementation: LinqFetch
  url: string
  method: 'GET' | 'POST'
  path: string
  headers: Record<string, string>
  body?: string
  signal?: AbortSignal
}): Promise<LinqFetchResponse> {
  const timeout = createTimeoutAbortController(input.signal, LINQ_HTTP_TIMEOUT_MS)

  try {
    return await input.fetchImplementation(input.url, {
      method: input.method,
      headers: input.headers,
      body: input.body,
      signal: timeout.signal,
    })
  } catch (error) {
    if (input.signal?.aborted) {
      throw error
    }

    throw createLinqRequestError({
      method: input.method,
      path: input.path,
      error,
      timedOut: timeout.timedOut(),
      retryable: shouldRetryLinqTransportFailure(input.method),
    })
  } finally {
    timeout.cleanup()
  }
}

async function createLinqHttpError(
  response: LinqFetchResponse,
  method: 'GET' | 'POST',
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
      retryable: shouldRetryLinqHttpStatus(method, response.status),
      status: response.status,
    },
  )
}

function createLinqRequestError(input: {
  method: 'GET' | 'POST'
  path: string
  error: unknown
  timedOut: boolean
  retryable: boolean
}): VaultCliError {
  const baseMessage = input.timedOut
    ? `Linq request ${input.method} ${input.path} timed out after ${LINQ_HTTP_TIMEOUT_MS}ms.`
    : `Linq request ${input.method} ${input.path} failed before a response was returned.`

  return new VaultCliError(
    'LINQ_API_REQUEST_FAILED',
    baseMessage,
    {
      error: errorMessage(input.error),
      method: input.method,
      path: input.path,
      retryable: input.retryable,
      timeoutMs: LINQ_HTTP_TIMEOUT_MS,
      timedOut: input.timedOut,
    },
  )
}

function isRetryableLinqRequestError(error: unknown): error is VaultCliError {
  return (
    error instanceof VaultCliError &&
    error.code === 'LINQ_API_REQUEST_FAILED' &&
    error.context?.retryable === true
  )
}

function shouldRetryLinqHttpStatus(method: 'GET' | 'POST', status: number): boolean {
  if (status === 429) {
    return true
  }

  return method === 'GET' && (status === 408 || status >= 500)
}

function shouldRetryLinqTransportFailure(method: 'GET' | 'POST'): boolean {
  return method === 'GET'
}

async function waitForLinqRetryDelay(
  attempt: number,
  signal?: AbortSignal,
): Promise<void> {
  const delay =
    LINQ_HTTP_RETRY_DELAYS_MS[
      Math.min(Math.max(attempt - 1, 0), LINQ_HTTP_RETRY_DELAYS_MS.length - 1)
    ] ?? 0

  if (delay <= 0) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(createAbortError())
      return
    }

    const timeout = setTimeout(() => {
      cleanup()
      resolve()
    }, delay)

    const onAbort = () => {
      clearTimeout(timeout)
      cleanup()
      reject(createAbortError())
    }

    const cleanup = () => signal?.removeEventListener('abort', onAbort)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function createTimeoutAbortController(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): {
  cleanup(): void
  signal: AbortSignal
  timedOut(): boolean
} {
  const controller = new AbortController()
  let didTimeout = false

  const onAbort = () => controller.abort()
  if (signal?.aborted) {
    controller.abort()
  } else {
    signal?.addEventListener('abort', onAbort, { once: true })
  }

  const timeout = setTimeout(() => {
    didTimeout = signal?.aborted !== true
    controller.abort()
  }, timeoutMs)

  return {
    cleanup() {
      clearTimeout(timeout)
      signal?.removeEventListener('abort', onAbort)
    },
    signal: controller.signal,
    timedOut() {
      return didTimeout
    },
  }
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

function createAbortError(): Error {
  const error = new Error('Operation aborted.')
  error.name = 'AbortError'
  return error
}
