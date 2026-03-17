import { spawn } from 'node:child_process'

import { VaultCliError } from './vault-cli-errors.js'

interface DeviceSyncApiErrorPayload {
  error?: {
    code?: unknown
    message?: unknown
    retryable?: unknown
    details?: unknown
  }
}

interface DeviceSyncProviderDescriptor {
  provider: string
  callbackPath: string
  callbackUrl: string
  webhookPath: string
  webhookUrl: string
  defaultScopes: string[]
}

interface DeviceSyncAccountRecord {
  id: string
  provider: string
  externalAccountId: string
  displayName: string | null
  status: 'active' | 'reauthorization_required' | 'disconnected'
  scopes: string[]
  accessTokenExpiresAt?: string | null
  metadata: Record<string, unknown>
  connectedAt: string
  lastWebhookAt: string | null
  lastSyncStartedAt: string | null
  lastSyncCompletedAt: string | null
  lastSyncErrorAt: string | null
  lastErrorCode: string | null
  lastErrorMessage: string | null
  nextReconcileAt: string | null
  createdAt: string
  updatedAt: string
}

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
  env?: NodeJS.ProcessEnv
  fetchImpl?: typeof fetch
  openBrowser?: (url: string) => Promise<boolean>
}

export const HEALTHYBOB_DEVICE_SYNC_BASE_URL_ENV =
  'HEALTHYBOB_DEVICE_SYNC_BASE_URL'
export const DEFAULT_DEVICE_SYNC_BASE_URL = 'http://127.0.0.1:8788'

export function normalizeDeviceSyncBaseUrl(value: string): string {
  const url = new URL(value)
  url.pathname = url.pathname.replace(/\/+$/u, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/u, '')
}

export function resolveDeviceSyncBaseUrl(
  value?: string | null,
  env: NodeJS.ProcessEnv = process.env,
): string {
  const configured =
    (typeof value === 'string' && value.trim()) ||
    env[HEALTHYBOB_DEVICE_SYNC_BASE_URL_ENV]?.trim() ||
    DEFAULT_DEVICE_SYNC_BASE_URL

  return normalizeDeviceSyncBaseUrl(configured)
}

export function createDeviceSyncClient(input: DeviceSyncClientOptions = {}) {
  const baseUrl = resolveDeviceSyncBaseUrl(input.baseUrl, input.env)
  const fetchImpl = input.fetchImpl ?? fetch
  const openBrowser = input.openBrowser ?? openExternalUrlInBrowser

  async function requestJson<TResponse>(
    path: string,
    init?: RequestInit,
  ): Promise<TResponse> {
    const url = new URL(path.replace(/^\/+/u, ''), `${baseUrl}/`).toString()
    let response: Response

    try {
      response = await fetchImpl(url, init)
    } catch (error) {
      throw new VaultCliError(
        'device_sync_unavailable',
        `Device sync service is unavailable at ${baseUrl}. Start healthybob-device-syncd and retry.`,
        {
          baseUrl,
          cause: error instanceof Error ? error.message : String(error),
        },
      )
    }

    const text = await response.text()
    const payload = parseJsonPayload(text)

    if (!response.ok) {
      const errorPayload = asErrorPayload(payload)
      throw new VaultCliError(
        errorPayload.code ?? 'device_sync_request_failed',
        errorPayload.message ??
          `Device sync request failed with HTTP ${response.status}.`,
        {
          baseUrl,
          status: response.status,
          details: errorPayload.details,
          retryable: errorPayload.retryable,
        },
      )
    }

    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      throw new VaultCliError(
        'device_sync_invalid_response',
        'Device sync service returned an invalid JSON payload.',
        {
          baseUrl,
          path,
        },
      )
    }

    return payload as TResponse
  }

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

function parseJsonPayload(text: string): unknown {
  if (!text.trim()) {
    return {}
  }

  try {
    return JSON.parse(text) as unknown
  } catch {
    return null
  }
}

function asErrorPayload(payload: unknown): {
  code?: string
  message?: string
  retryable?: boolean
  details?: unknown
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {}
  }

  const envelope = payload as DeviceSyncApiErrorPayload
  const error = envelope.error

  if (!error || typeof error !== 'object') {
    return {}
  }

  return {
    code: typeof error.code === 'string' ? error.code : undefined,
    message: typeof error.message === 'string' ? error.message : undefined,
    retryable:
      typeof error.retryable === 'boolean' ? error.retryable : undefined,
    details: error.details,
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
