import {
  fetchJsonResponse,
  readJsonErrorResponse,
  requestJsonWithRetry,
  type JsonFetchResponse,
} from '@murphai/operator-config/http-json-retry'
import {
  waitForRetryDelay,
  type ResponseHeadersLike,
} from '@murphai/operator-config/http-retry'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  errorMessage,
  normalizeNullableString,
} from '../shared.js'

import {
  compactAssistantRecord,
  firstAssistantString,
  readAssistantRecord,
} from './shared.js'
import type {
  AssistantConfiguredWebSearchProvider,
  AssistantWebSearchFetch,
} from './types.js'

const ASSISTANT_WEB_SEARCH_HTTP_MAX_ATTEMPTS = 3
const ASSISTANT_WEB_SEARCH_HTTP_RETRY_DELAYS_MS = [250, 1_000, 2_500] as const

export async function requestAssistantWebSearchJson(input: {
  body?: Record<string, unknown>
  fetchImplementation: AssistantWebSearchFetch
  headers: Record<string, string>
  method: 'GET' | 'POST'
  provider: AssistantConfiguredWebSearchProvider
  signal?: AbortSignal
  timeoutMs: number
  url: string
}): Promise<unknown> {
  return await requestJsonWithRetry<unknown, Response>({
    createHttpError: async (response) =>
      await createAssistantWebSearchHttpError({
        provider: input.provider,
        method: input.method,
        response,
        url: input.url,
      }),
    fetchResponse: () =>
      fetchAssistantWebSearchResponse({
        body: input.body,
        fetchImplementation: input.fetchImplementation,
        headers: input.headers,
        method: input.method,
        provider: input.provider,
        signal: input.signal,
        timeoutMs: input.timeoutMs,
        url: input.url,
      }),
    isRetryableError: isRetryableAssistantWebSearchError,
    maxAttempts: ASSISTANT_WEB_SEARCH_HTTP_MAX_ATTEMPTS,
    parseResponse: async (response) => (await response.json()) as unknown,
    signal: input.signal,
    waitForRetryDelay: waitForAssistantWebSearchRetryDelay,
  })
}

async function fetchAssistantWebSearchResponse(input: {
  body?: Record<string, unknown>
  fetchImplementation: AssistantWebSearchFetch
  headers: Record<string, string>
  method: 'GET' | 'POST'
  provider: AssistantConfiguredWebSearchProvider
  signal?: AbortSignal
  timeoutMs: number
  url: string
}): Promise<Response> {
  return await fetchJsonResponse({
    body: input.body ? JSON.stringify(input.body) : undefined,
    createTransportError: ({ error, timedOut }) =>
      new VaultCliError(
        'WEB_SEARCH_REQUEST_FAILED',
        timedOut
          ? `web.search ${input.provider} request timed out after ${input.timeoutMs}ms.`
          : `web.search ${input.provider} request failed before a response was returned.`,
        createAssistantWebSearchErrorContext({
          provider: input.provider,
          method: input.method,
          retryable: true,
          timedOut,
          timeoutMs: input.timeoutMs,
          transportError: errorMessage(error),
          url: input.url,
        }),
      ),
    fetchImplementation: input.fetchImplementation,
    headers: input.headers,
    method: input.method,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    url: input.url,
  })
}

function isRetryableAssistantWebSearchError(
  error: unknown,
): error is VaultCliError {
  return Boolean(
    error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'WEB_SEARCH_REQUEST_FAILED' &&
      'context' in error &&
      (error as { context?: { retryable?: unknown } }).context?.retryable === true,
  )
}

async function waitForAssistantWebSearchRetryDelay(
  attempt: number,
  signal?: AbortSignal,
  headers?: ResponseHeadersLike | null,
): Promise<void> {
  await waitForRetryDelay({
    attempt,
    headers,
    retryDelaysMs: ASSISTANT_WEB_SEARCH_HTTP_RETRY_DELAYS_MS,
    signal,
  })
}

async function createAssistantWebSearchHttpError(input: {
  method: 'GET' | 'POST'
  provider: AssistantConfiguredWebSearchProvider
  response: JsonFetchResponse
  url: string
}): Promise<VaultCliError> {
  const { payload, rawText } = await readJsonErrorResponse(input.response)
  const retryable = shouldRetryAssistantWebSearchStatus(input.response.status)

  return new VaultCliError(
    'WEB_SEARCH_REQUEST_FAILED',
    extractAssistantWebSearchErrorMessage(payload, rawText) ??
      `web.search ${input.provider} request failed with HTTP ${input.response.status}.`,
    createAssistantWebSearchErrorContext({
      provider: input.provider,
      method: input.method,
      retryable,
      status: input.response.status,
      url: input.url,
    }),
  )
}

function shouldRetryAssistantWebSearchStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function createAssistantWebSearchErrorContext(input: {
  method: 'GET' | 'POST'
  provider: AssistantConfiguredWebSearchProvider
  retryable: boolean
  status?: number
  timedOut?: boolean
  timeoutMs?: number
  transportError?: string
  url: string
}): Record<string, unknown> {
  return compactAssistantRecord({
    provider: input.provider,
    method: input.method,
    retryable: input.retryable,
    status: input.status,
    timedOut: input.timedOut,
    timeoutMs: input.timeoutMs,
    transportError: input.transportError,
    url: input.url,
  })
}

function extractAssistantWebSearchErrorMessage(
  payload: unknown,
  rawText: string | null,
): string | null {
  const record = readAssistantRecord(payload)
  if (record) {
    return (
      firstAssistantString(
        record.message,
        record.error,
        record.detail,
      ) ?? normalizeNullableString(rawText)
    )
  }

  return normalizeNullableString(rawText)
}
