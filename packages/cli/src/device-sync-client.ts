import { spawn } from 'node:child_process'
import {
  createDeviceSyncJsonRequester as createSharedDeviceSyncJsonRequester,
  DEFAULT_DEVICE_SYNC_BASE_URL,
  DEVICE_SYNC_BASE_URL_ENV,
  DEVICE_SYNC_CONTROL_TOKEN_ENV,
  isDeviceSyncLocalControlPlaneError,
  normalizeDeviceSyncBaseUrl,
  resolveDeviceSyncControlPlane as resolveSharedDeviceSyncControlPlane,
  resolveDeviceSyncControlToken as resolveSharedDeviceSyncControlToken,
  type DeviceSyncAccountRecord,
  type DeviceSyncProviderDescriptor,
} from '@murph/runtime-state'

import { VaultCliError } from './vault-cli-errors.js'

interface DeviceSyncJobRecord {
  id: string
  provider: string
  accountId: string
  kind: string
  payload: Record<string, unknown>
  priority: number
  availableAt: string
  attempts: number
  maxAttempts: number
  dedupeKey: string | null
  status: 'queued' | 'running' | 'succeeded' | 'dead'
  leaseOwner: string | null
  leaseExpiresAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  finishedAt: string | null
}

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
    }): Promise<{
      provider: string
      state: string
      expiresAt: string
      authorizationUrl: string
      openedBrowser: boolean
    }> {
      const payload = await requestJson<{
        provider: string
        state: string
        expiresAt: string
        authorizationUrl: string
      }>(`/providers/${encodeURIComponent(input.provider)}/connect`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
        },
        body: JSON.stringify(
          input.returnTo ? { returnTo: input.returnTo } : {},
        ),
      })

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
    } = {}): Promise<{ accounts: DeviceSyncAccountRecord[] }> {
      const search = new URLSearchParams()

      if (input.provider) {
        search.set('provider', input.provider)
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
    async disconnectAccount(accountId: string): Promise<{
      account: DeviceSyncAccountRecord
    }> {
      return await requestJson(
        `/accounts/${encodeURIComponent(accountId)}/disconnect`,
        {
          method: 'POST',
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

async function openExternalUrlInBrowser(url: string): Promise<boolean> {
  const commands: Array<[string, string[]]> =
    process.platform === 'darwin'
      ? [['open', [url]]]
      : process.platform === 'win32'
        ? [['cmd', ['/c', 'start', '', url]]]
        : [['xdg-open', [url]]]

  for (const [command, args] of commands) {
    if (await trySpawn(command, args)) {
      return true
    }
  }

  return false
}

function trySpawn(command: string, args: string[]): Promise<boolean> {
  return new Promise((resolve) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        env: sanitizeChildProcessEnv(),
        stdio: 'ignore',
      })

      child.once('error', () => resolve(false))
      child.once('spawn', () => {
        child.unref()
        resolve(true)
      })
    } catch {
      resolve(false)
    }
  })
}

function sanitizeChildProcessEnv(): NodeJS.ProcessEnv {
  const nextEnv = { ...process.env }
  delete nextEnv.NODE_V8_COVERAGE
  return nextEnv
}
