import {
  createTimeoutAbortController,
  type ResponseHeadersLike,
} from './http-retry.js'

export interface JsonFetchResponse {
  headers?: ResponseHeadersLike | null
  json(): Promise<unknown>
  ok: boolean
  status: number
  text(): Promise<string>
}

export type JsonFetch<TResponse extends JsonFetchResponse> = (
  input: string,
  init: {
    body?: string
    headers?: Record<string, string>
    method: string
    signal?: AbortSignal
  },
) => Promise<TResponse>

export async function fetchJsonResponse<TResponse extends JsonFetchResponse>(input: {
  body?: string
  createTransportError: (input: {
    error: unknown
    timedOut: boolean
  }) => Error
  fetchImplementation: JsonFetch<TResponse>
  headers: Record<string, string>
  method: string
  signal?: AbortSignal
  timeoutMs: number
  url: string
}): Promise<TResponse> {
  const timeout = createTimeoutAbortController(input.signal, input.timeoutMs)

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

    throw input.createTransportError({
      error,
      timedOut: timeout.timedOut(),
    })
  } finally {
    timeout.cleanup()
  }
}

export async function readJsonErrorResponse(
  response: Pick<JsonFetchResponse, 'json' | 'text'>,
): Promise<{
  payload: unknown
  rawText: string | null
}> {
  let payload: unknown = null
  let rawText: string | null = null

  try {
    payload = await response.json()
  } catch {
    try {
      rawText = await response.text()
    } catch {}
  }

  return {
    payload,
    rawText,
  }
}

export async function requestJsonWithRetry<
  TResult,
  TResponse extends JsonFetchResponse,
>(input: {
  createHttpError: (response: TResponse) => Promise<Error> | Error
  fetchResponse: () => Promise<TResponse>
  isRetryableError: (error: unknown) => boolean
  maxAttempts: number
  parseResponse: (response: TResponse) => Promise<TResult> | TResult
  signal?: AbortSignal
  waitForRetryDelay: (
    attempt: number,
    signal?: AbortSignal,
    headers?: ResponseHeadersLike | null,
  ) => Promise<void>
}): Promise<TResult> {
  let attempt = 1

  while (true) {
    let response: TResponse

    try {
      response = await input.fetchResponse()
    } catch (error) {
      if (input.isRetryableError(error) && attempt < input.maxAttempts) {
        await input.waitForRetryDelay(attempt, input.signal)
        attempt += 1
        continue
      }

      throw error
    }

    if (!response.ok) {
      const failure = await input.createHttpError(response)
      if (input.isRetryableError(failure) && attempt < input.maxAttempts) {
        await input.waitForRetryDelay(attempt, input.signal, response.headers)
        attempt += 1
        continue
      }

      throw failure
    }

    return await input.parseResponse(response)
  }
}
