import * as z from '@murphai/contracts/zod-runtime'
import {
  createDeviceSyncJsonRequester as createSharedDeviceSyncJsonRequester,
  DEFAULT_DEVICE_SYNC_BASE_URL,
  DEVICE_SYNC_BASE_URL_ENV,
  DEVICE_SYNC_CONTROL_TOKEN_ENV,
  type DeviceSyncJobRecord,
  isDeviceSyncLocalControlPlaneError,
  normalizeDeviceSyncBaseUrl,
  resolveDeviceSyncControlPlane as resolveSharedDeviceSyncControlPlane,
  resolveDeviceSyncControlToken as resolveSharedDeviceSyncControlToken,
  type DeviceSyncAccountRecord,
  type DeviceSyncProviderDescriptor,
} from '@murphai/device-syncd/client'

import { httpUrlSchema } from './command-helpers.js'
import { openExternalUrlInBrowser } from './device-sync-browser-opener.js'
import { isoTimestampSchema } from './vault-cli-contracts.js'
import { VaultCliError } from './vault-cli-errors.js'

const deviceSyncBeginConnectionResponseSchema = z
  .object({
    provider: z.string().min(1),
    state: z.string().min(1),
    expiresAt: isoTimestampSchema,
    authorizationUrl: httpUrlSchema,
  })
  .strict()

const DEFAULT_DEVICE_SYNC_REQUEST_TIMEOUT_MS = 15_000

export interface DeviceSyncClientOptions {
  baseUrl?: string | null
  controlToken?: string | null
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  openBrowser?: (url: string) => Promise<boolean>
  timeoutMs?: number
}

export {
  DEFAULT_DEVICE_SYNC_BASE_URL,
  DEVICE_SYNC_BASE_URL_ENV,
  DEVICE_SYNC_CONTROL_TOKEN_ENV,
  normalizeDeviceSyncBaseUrl,
}

export function resolveDeviceSyncBaseUrl(
  value?: string | null,
  env: NodeJS.ProcessEnv = process.env,
  controlToken?: string | null,
): string {
  return resolveDeviceSyncControlPlane(value, env, controlToken).baseUrl
}

export function resolveDeviceSyncControlToken(
  value?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  return resolveSharedDeviceSyncControlToken({ value, env })
}

export function createDeviceSyncClient(input: DeviceSyncClientOptions = {}) {
  const { baseUrl, controlToken } = resolveDeviceSyncControlPlane(
    input.baseUrl,
    input.env,
    input.controlToken,
  )
  const fetchImpl = input.fetchImpl ?? fetch
  const openBrowser = input.openBrowser ?? openExternalUrlInBrowser

  const requestJson = createSharedDeviceSyncJsonRequester({
    baseUrl,
    fetchImpl,
    controlToken,
    timeoutMs: input.timeoutMs ?? DEFAULT_DEVICE_SYNC_REQUEST_TIMEOUT_MS,
    createUnavailableError: ({ failureStage, method, timedOut }) =>
      new VaultCliError(
        timedOut
          ? 'device_sync_timeout'
          : failureStage === 'response'
            ? 'device_sync_response_unavailable'
            : 'device_sync_unavailable',
        timedOut
          ? 'Device sync service did not respond before the request deadline.'
          : failureStage === 'response'
            ? 'Device sync service response could not be read.'
            : 'Device sync service is unavailable. Start it with `murph device daemon start --vault <path>` or start `murph-device-syncd` manually, then retry.',
        {
          retryable: isSafeDeviceSyncMethod(method),
          stage: failureStage,
        },
      ),
    createHttpError: ({ method, status, errorPayload }) =>
      new VaultCliError(
        errorPayload.code ?? 'device_sync_request_failed',
        status === 401 && !controlToken
          ? 'Device sync control plane requires DEVICE_SYNC_CONTROL_TOKEN when you target an explicit daemon.'
          : errorPayload.message ??
              `Device sync request failed with HTTP ${status}.`,
        {
          status,
          retryable: isSafeDeviceSyncMethod(method)
            && (errorPayload.retryable ?? isRetryableDeviceSyncStatus(status)),
          stage: 'response',
        },
      ),
    createInvalidResponseError: () =>
      new VaultCliError(
        'device_sync_invalid_response',
        'Device sync service returned an invalid JSON payload.',
        {
          retryable: false,
          stage: 'response',
        },
      ),
  })

  return {
    baseUrl,
    async listProviders(): Promise<{ providers: DeviceSyncProviderDescriptor[] }> {
      return await requestJson('/providers')
    },
    async beginConnection(input: {
      provider: string
      returnTo?: string
      open?: boolean
      sourceProviderSlug?: string | null
      ownerId?: string | null
    }): Promise<{
      provider: string
      state: string
      expiresAt: string
      authorizationUrl: string
      openedBrowser: boolean
    }> {
      const path = `/providers/${encodeURIComponent(input.provider)}/connect`
      const responsePayload = await requestJson<unknown>(path, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify({
          ...(input.returnTo ? { returnTo: input.returnTo } : {}),
          ...(input.ownerId ? { ownerId: input.ownerId } : {}),
          ...(input.sourceProviderSlug
            ? { sourceProviderSlug: input.sourceProviderSlug }
            : {}),
        }),
      })
      const parsedPayload =
        deviceSyncBeginConnectionResponseSchema.safeParse(responsePayload)

      if (!parsedPayload.success) {
        throw new VaultCliError(
          'device_sync_invalid_response',
          'Device sync service returned an invalid JSON payload.',
          {
            retryable: false,
            stage: 'response',
          },
        )
      }

      const payload = parsedPayload.data

      return {
        ...payload,
        openedBrowser:
          input.open === true
            ? await openBrowser(payload.authorizationUrl)
            : false,
      }
    },
    async listAccounts(input: {
      provider?: string
      sourceProvider?: string
    } = {}): Promise<{ accounts: DeviceSyncAccountRecord[] }> {
      const search = new URLSearchParams()

      if (input.provider) {
        search.set('provider', input.provider)
      }
      if (input.sourceProvider) {
        search.set('sourceProvider', input.sourceProvider)
      }

      const path =
        search.size > 0 ? `/accounts?${search.toString()}` : '/accounts'
      return await requestJson(path)
    },
    async showAccount(accountId: string): Promise<{ account: DeviceSyncAccountRecord }> {
      return await requestJson(`/accounts/${encodeURIComponent(accountId)}`)
    },
    async reconcileAccount(accountId: string): Promise<{
      account: DeviceSyncAccountRecord
      job: DeviceSyncJobRecord
    }> {
      return await requestJson(
        `/accounts/${encodeURIComponent(accountId)}/reconcile`,
        {
          method: 'POST',
        },
      )
    },
    async disconnectAccount(accountId: string, expectedConnectedAt: string): Promise<{
      account: DeviceSyncAccountRecord
    }> {
      return await requestJson(
        `/accounts/${encodeURIComponent(accountId)}/disconnect-if-connected-at`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
          },
          body: JSON.stringify({ expectedConnectedAt }),
        },
      )
    },
  }
}

function isSafeDeviceSyncMethod(method: string): boolean {
  return method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
}

function isRetryableDeviceSyncStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500
}

function resolveDeviceSyncControlPlane(
  value?: string | null,
  env: NodeJS.ProcessEnv = process.env,
  controlToken?: string | null,
): {
  baseUrl: string
  controlToken: string | null
} {
  try {
    return resolveSharedDeviceSyncControlPlane({
      baseUrl: value,
      env,
      controlToken,
    })
  } catch (error) {
    if (isDeviceSyncLocalControlPlaneError(error)) {
      throw new VaultCliError(
        'DEVICE_SYNC_REMOTE_BASE_URL_UNSUPPORTED',
        'Device sync control-plane bearer tokens may only target loopback base URLs. Set DEVICE_SYNC_BASE_URL to localhost/127.0.0.1/::1 or unset DEVICE_SYNC_CONTROL_TOKEN.',
        {
          baseUrl:
            (typeof value === 'string' && value.trim()) ||
            env[DEVICE_SYNC_BASE_URL_ENV] ||
            DEFAULT_DEVICE_SYNC_BASE_URL,
        },
      )
    }

    throw error
  }
}
