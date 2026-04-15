import { errorMessage, normalizeNullableString } from '@murphai/operator-config/text/shared'
import {
  DEFAULT_MAPBOX_TIMEOUT_MS,
  MAX_MAPBOX_TIMEOUT_MS,
} from './mapbox-route-contracts.js'

export async function fetchMapboxJson<T>(input: {
  allowNotFound: true
  fetchImpl: typeof fetch
  requestLabel: string
  timeoutMs: number
  url: URL
}): Promise<T | null>
export async function fetchMapboxJson<T>(input: {
  allowNotFound?: false | undefined
  fetchImpl: typeof fetch
  requestLabel: string
  timeoutMs: number
  url: URL
}): Promise<T>
export async function fetchMapboxJson<T>(input: {
  allowNotFound?: boolean
  fetchImpl: typeof fetch
  requestLabel: string
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
    throw new Error(
      `Mapbox ${input.requestLabel} request failed: ${errorMessage(error)}.`,
    )
  }

  if (input.allowNotFound && response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(
      `Mapbox ${input.requestLabel} request failed (${await describeFailedMapboxResponse(response)}).`,
    )
  }

  return (await response.json()) as T
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

async function describeFailedMapboxResponse(response: Response): Promise<string> {
  const fallback = `HTTP ${response.status}`

  try {
    const payload = (await response.json()) as {
      message?: unknown
    }
    const message =
      typeof payload.message === 'string'
        ? normalizeNullableString(payload.message)
        : null

    return message ? `${fallback}: ${message}` : fallback
  } catch {
    return fallback
  }
}
