import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  DEFAULT_MAPBOX_TIMEOUT_MS,
  MAX_MAPBOX_TIMEOUT_MS,
} from './mapbox-route-contracts.js'

export async function fetchMapboxJson<T>(input: {
  allowNotFound: true
  fetchImpl: typeof fetch
  timeoutMs: number
  url: URL
}): Promise<T | null>
export async function fetchMapboxJson<T>(input: {
  allowNotFound?: false | undefined
  fetchImpl: typeof fetch
  timeoutMs: number
  url: URL
}): Promise<T>
export async function fetchMapboxJson<T>(input: {
  allowNotFound?: boolean
  fetchImpl: typeof fetch
  timeoutMs: number
  url: URL
}): Promise<T | null> {
  let response: Response

  try {
    response = await input.fetchImpl(input.url, {
      headers: {
        accept: 'application/json',
      },
      signal: AbortSignal.timeout(input.timeoutMs),
    })
  } catch (error) {
    throw createMapboxTransportError(error)
  }

  if (input.allowNotFound && response.status === 404) {
    return null
  }

  if (!response.ok) {
    await discardMapboxResponseBody(response)
    throw createMapboxHttpError(response.status)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw createMapboxResponseInvalidError(response.status)
  }
}

export function createMapboxResponseInvalidError(
  status?: number,
): VaultCliError {
  return new VaultCliError(
    'route_mapbox_response_invalid',
    'Mapbox returned an invalid response.',
    {
      retryable: true,
      stage: 'response',
      ...(status === undefined ? {} : { status }),
    },
  )
}

export function readMapboxAccessToken(
  env: NodeJS.ProcessEnv,
): string | null {
  return normalizeNullableString(env.MAPBOX_ACCESS_TOKEN)
}

export function resolveMapboxTimeoutMs(env: NodeJS.ProcessEnv): number {
  const configured = normalizeNullableString(env.MURPH_MAPBOX_TIMEOUT_MS)
  if (!configured) {
    return DEFAULT_MAPBOX_TIMEOUT_MS
  }

  const parsed = Number.parseInt(configured, 10)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return DEFAULT_MAPBOX_TIMEOUT_MS
  }

  return Math.min(parsed, MAX_MAPBOX_TIMEOUT_MS)
}

async function discardMapboxResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // The status is sufficient to classify the failure; disposal is best effort.
  }
}

function createMapboxTransportError(error: unknown): VaultCliError {
  const errorName = readErrorName(error)

  if (errorName === 'TimeoutError') {
    return new VaultCliError(
      'route_mapbox_timeout',
      'The Mapbox request timed out.',
      { retryable: true, stage: 'transport', timedOut: true },
    )
  }

  if (errorName === 'AbortError') {
    return new VaultCliError(
      'route_mapbox_cancelled',
      'The Mapbox request was cancelled.',
      { retryable: false, stage: 'transport' },
    )
  }

  return new VaultCliError(
    'route_mapbox_unavailable',
    'Mapbox is temporarily unavailable.',
    { retryable: true, stage: 'transport' },
  )
}

function createMapboxHttpError(status: number): VaultCliError {
  if (status === 401 || status === 403) {
    return new VaultCliError(
      'route_mapbox_auth_invalid',
      'Mapbox rejected the runtime credential.',
      { retryable: false, stage: 'response', status },
    )
  }

  if (status === 408) {
    return new VaultCliError(
      'route_mapbox_timeout',
      'The Mapbox request timed out.',
      { retryable: true, stage: 'response', status, timedOut: true },
    )
  }

  if (status === 429) {
    return new VaultCliError(
      'route_mapbox_rate_limited',
      'Mapbox rate-limited the request.',
      { retryable: true, stage: 'response', status },
    )
  }

  if (status >= 500 && status <= 599) {
    return new VaultCliError(
      'route_mapbox_unavailable',
      'Mapbox is temporarily unavailable.',
      { retryable: true, stage: 'response', status },
    )
  }

  return new VaultCliError(
    'route_mapbox_request_rejected',
    'Mapbox rejected the request.',
    { retryable: false, stage: 'response', status },
  )
}

function readErrorName(error: unknown): string | undefined {
  return error instanceof Error ? error.name : undefined
}
