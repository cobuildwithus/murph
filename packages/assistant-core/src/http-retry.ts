interface ResponseHeadersWithGetter {
  get?(name: string): string | null
}

export type ResponseHeadersLike =
  | ResponseHeadersWithGetter
  | Record<string, unknown>

export function parseRetryAfterHeaderMs(input: {
  headers?: ResponseHeadersLike | null
  maxDelayMs?: number
  nowMs?: number
}): number | null {
  const raw = resolveHeaderValue(input.headers, 'retry-after')
  if (!raw) {
    return null
  }

  const normalized = raw.trim()
  if (normalized.length === 0) {
    return null
  }

  const maxDelayMs = Math.max(Math.trunc(input.maxDelayMs ?? 30_000), 0)
  const seconds = Number(normalized)
  if (Number.isFinite(seconds) && seconds >= 0) {
    return clampRetryDelay(Math.round(seconds * 1_000), maxDelayMs)
  }

  const retryAt = Date.parse(normalized)
  if (!Number.isFinite(retryAt)) {
    return null
  }

  return clampRetryDelay(retryAt - (input.nowMs ?? Date.now()), maxDelayMs)
}

export async function waitForRetryDelay(input: {
  attempt: number
  headers?: ResponseHeadersLike | null
  retryDelaysMs: readonly number[]
  signal?: AbortSignal
}): Promise<void> {
  const delay =
    parseRetryAfterHeaderMs({
      headers: input.headers,
    }) ??
    (input.retryDelaysMs[
      Math.min(Math.max(input.attempt - 1, 0), input.retryDelaysMs.length - 1)
    ] ?? 0)

  if (delay <= 0) {
    return
  }

  await new Promise<void>((resolve, reject) => {
    if (input.signal?.aborted) {
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

    const cleanup = () => input.signal?.removeEventListener('abort', onAbort)
    input.signal?.addEventListener('abort', onAbort, { once: true })
  })
}

export function createTimeoutAbortController(
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

export function createAbortError(): Error {
  const error = new Error('Operation aborted.')
  error.name = 'AbortError'
  return error
}

function resolveHeaderValue(
  headers: ResponseHeadersLike | null | undefined,
  name: string,
): string | null {
  if (!headers) {
    return null
  }

  if (typeof headers.get === 'function') {
    const value = headers.get(name)
    return typeof value === 'string' ? value : null
  }

  const target = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== target || typeof value !== 'string') {
      continue
    }

    return value
  }

  return null
}

function clampRetryDelay(delayMs: number, maxDelayMs: number): number {
  if (!Number.isFinite(delayMs)) {
    return 0
  }

  return Math.min(Math.max(Math.trunc(delayMs), 0), maxDelayMs)
}
