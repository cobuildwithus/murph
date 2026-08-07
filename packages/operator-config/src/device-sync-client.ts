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

export interface DeviceSyncClientOptions {
  baseUrl?: string | null
  controlToken?: string | null
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  openBrowser?: (url: string) => Promise<boolean>
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
    createUnavailableError: ({ cause }) =>
      new VaultCliError(
        'device_sync_unavailable',
        `Device sync service is unavailable at ${baseUrl}. Run \`murph device daemon start --vault <path>\` or start \`murph-device-syncd\` manually and retry.`,
        {
          baseUrl,
          cause: cause instanceof Error ? cause.message : String(cause),
        },
      ),
    createHttpError: ({ status, errorPayload }) =>
      new VaultCliError(
        errorPayload.code ?? 'device_sync_request_failed',
        status === 401 && !controlToken
          ? 'Device sync control plane requires DEVICE_SYNC_CONTROL_TOKEN when you target an explicit daemon.'
          : errorPayload.message ??
              `Device sync request failed with HTTP ${status}.`,
        {
          baseUrl,
          status,
          details: errorPayload.details,
          retryable: errorPayload.retryable,
        },
      ),
    createInvalidResponseError: ({ path }) =>
      new VaultCliError(
        'device_sync_invalid_response',
        'Device sync service returned an invalid JSON payload.',
        {
          baseUrl,
          path,
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
            baseUrl,
            path,
            issues: parsedPayload.error.issues.map((issue) => ({
              code: issue.code,
              message: issue.message,
              path: issue.path,
            })),
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
