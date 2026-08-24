import { normalizeNullableString } from '@murphai/operator-config/text/shared'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  DEFAULT_MAPBOX_TIMEOUT_MS,
  MAX_MAPBOX_TIMEOUT_MS,
} from './mapbox-route-contracts.js'

export type MapboxRequestStage =
  | 'address-resolution'
  | 'destination-geocoding'
  | 'destination-search'
  | 'directions'
  | 'origin-geocoding'
  | 'origin-search'
  | 'terrain-elevation'
  | 'waypoint-geocoding'
  | 'waypoint-search'

export async function fetchMapboxJson<T>(input: {
  allowNotFound: true
  fetchImpl: typeof fetch
  stage: MapboxRequestStage
  timeoutMs: number
  url: URL
}): Promise<T | null>
export async function fetchMapboxJson<T>(input: {
  allowNotFound?: false | undefined
  fetchImpl: typeof fetch
  stage: MapboxRequestStage
  timeoutMs: number
  url: URL
}): Promise<T>
export async function fetchMapboxJson<T>(input: {
  allowNotFound?: boolean
  fetchImpl: typeof fetch
  stage: MapboxRequestStage
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
    throw createMapboxTransportError(error, input.stage)
  }

  if (input.allowNotFound && response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw createMapboxHttpError(response.status, input.stage)
  }

  try {
    return (await response.json()) as T
  } catch {
    throw createMapboxResponseInvalidError(input.stage, response.status)
  }
}

export function createMapboxResponseInvalidError(
  stage: MapboxRequestStage,
  status?: number,
): VaultCliError {
  return new VaultCliError(
    'route_mapbox_response_invalid',
    'Mapbox returned an invalid response.',
    {
      retryable: true,
      ...(status === undefined ? {} : { status }),
    },
    {
      stage,
      hint: 'Retry the command. If the response remains invalid, treat Mapbox as temporarily unavailable.',
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

function createMapboxTransportError(
  error: unknown,
  stage: MapboxRequestStage,
): VaultCliError {
  const timedOut =
    error instanceof Error &&
    (error.name === 'AbortError' || error.name === 'TimeoutError')

  return new VaultCliError(
    timedOut ? 'route_mapbox_timeout' : 'route_mapbox_unavailable',
    timedOut
      ? 'The Mapbox request timed out.'
      : 'Mapbox is temporarily unavailable.',
    {
      retryable: true,
      ...(timedOut ? { timedOut: true } : {}),
    },
    {
      stage,
      hint: timedOut
        ? 'Retry the command after a short delay.'
        : 'Check network availability, then retry the command.',
    },
  )
}

function createMapboxHttpError(
  status: number,
  stage: MapboxRequestStage,
): VaultCliError {
  if (status === 401 || status === 403) {
    return new VaultCliError(
      'route_mapbox_auth_invalid',
      'Mapbox rejected the runtime credential.',
      { retryable: false, status },
      {
        stage,
        hint: 'Check the Mapbox runtime credential before retrying.',
      },
    )
  }

  if (status === 408) {
    return new VaultCliError(
      'route_mapbox_timeout',
      'The Mapbox request timed out.',
      { retryable: true, status, timedOut: true },
      {
        stage,
        hint: 'Retry the command after a short delay.',
      },
    )
  }

  if (status === 429) {
    return new VaultCliError(
      'route_mapbox_rate_limited',
      'Mapbox rate-limited the request.',
      { retryable: true, status },
      {
        stage,
        hint: 'Retry the command after a delay.',
      },
    )
  }

  if (status >= 500 || status < 400) {
    return new VaultCliError(
      'route_mapbox_unavailable',
      'Mapbox is temporarily unavailable.',
      { retryable: true, status },
      {
        stage,
        hint: 'Retry the command after a short delay.',
      },
    )
  }

  return new VaultCliError(
    'route_mapbox_request_rejected',
    'Mapbox rejected the request.',
    { retryable: false, status },
    {
      stage,
      hint: 'Check the route inputs before retrying.',
    },
  )
}
