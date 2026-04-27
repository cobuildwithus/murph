import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  buildVaultSyncImportPack,
} from '@murphai/core'
import {
  encodeHostedBundleBase64,
} from '@murphai/runtime-state/node'

const DEFAULT_HOSTED_APP_URL = 'https://app.murph.ai'

export const syncPushResultSchema = z.object({
  dryRun: z.boolean(),
  host: z.string().min(1).nullable(),
  sessionId: z.string().min(1).nullable(),
  status: z.string().min(1),
  localManifestHash: z.string().min(1),
  sourceVaultId: z.string().min(1).nullable(),
  sourceSchemaVersion: z.string().min(1).nullable(),
  includedFiles: z.number().int().nonnegative(),
  excludedFiles: z.number().int().nonnegative(),
  bundleBytes: z.number().int().nonnegative(),
})

export function registerSyncCommands(cli: Cli.Cli) {
  const syncCli = Cli.create('sync', {
    description: 'Sync local vault data with hosted Murph.',
  })

  syncCli.command('push', {
    description:
      'Upload a canonical-only local vault import pack to a hosted vault sync session.',
    hint:
      'Start a sync from hosted Settings, then run the shown murph sync push --session command locally.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      session: z
        .string()
        .min(1)
        .describe('One-time pairing code from hosted Settings.'),
      host: z
        .string()
        .min(1)
        .default(DEFAULT_HOSTED_APP_URL)
        .describe('Hosted Murph app base URL.'),
      dryRun: z
        .boolean()
        .default(false)
        .describe('Build and summarize the import pack without uploading it.'),
    }),
    output: syncPushResultSchema,
    async run({ options }) {
      const pack = await buildVaultSyncImportPack({
        vaultRoot: options.vault,
      })
      const bundleBase64 = encodeHostedBundleBase64(pack.bundle)

      if (options.dryRun) {
        return {
          dryRun: true,
          host: normalizeHostedAppUrl(options.host),
          sessionId: null,
          status: 'dry_run',
          localManifestHash: pack.manifestHash,
          sourceVaultId: pack.sourceVaultId,
          sourceSchemaVersion: pack.sourceSchemaVersion,
          includedFiles: pack.manifest.files.length,
          excludedFiles: countManifestExcludedFiles(pack.manifest.excluded),
          bundleBytes: pack.bundle.byteLength,
        }
      }

      const host = normalizeHostedAppUrl(options.host)
      const exchange = await postHostedJson<HostedVaultSyncExchangeResponse>({
        body: { pairingCode: options.session },
        host,
        path: '/api/vault-sync/agent/session/exchange',
      })
      const complete = await postHostedJson<HostedVaultSyncCompleteResponse>({
        bearerToken: exchange.agentToken,
        body: {
          bundleBase64,
          localManifestHash: pack.manifestHash,
          sourceSchemaVersion: pack.sourceSchemaVersion,
          sourceVaultId: pack.sourceVaultId,
          sourceVaultTitle: pack.sourceVaultTitle,
        },
        host,
        path: `/api/vault-sync/agent/sessions/${encodeURIComponent(exchange.session.id)}/complete`,
      })

      return {
        dryRun: false,
        host,
        sessionId: complete.session.id,
        status: complete.session.status,
        localManifestHash: pack.manifestHash,
        sourceVaultId: pack.sourceVaultId,
        sourceSchemaVersion: pack.sourceSchemaVersion,
        includedFiles: pack.manifest.files.length,
        excludedFiles: countManifestExcludedFiles(pack.manifest.excluded),
        bundleBytes: pack.bundle.byteLength,
      }
    },
  })

  cli.command(syncCli)
}

interface HostedVaultSyncSessionView {
  id: string
  status: string
}

interface HostedVaultSyncExchangeResponse {
  agentToken: string
  ok: boolean
  session: HostedVaultSyncSessionView
}

interface HostedVaultSyncCompleteResponse {
  ok: boolean
  session: HostedVaultSyncSessionView
}

function countManifestExcludedFiles(excluded: readonly { count: number }[]): number {
  return excluded.reduce((total, entry) => total + entry.count, 0)
}

function normalizeHostedAppUrl(value: string): string {
  const url = new URL(value)
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new Error('Hosted Murph app URL must use http or https.')
  }
  if (url.username || url.password) {
    throw new Error('Hosted Murph app URL must not contain credentials.')
  }
  url.pathname = url.pathname.replace(/\/+$/u, '')
  url.search = ''
  url.hash = ''
  return url.toString().replace(/\/$/u, '')
}

async function postHostedJson<TResponse>(input: {
  bearerToken?: string
  body: Record<string, unknown>
  host: string
  path: string
}): Promise<TResponse> {
  const response = await fetch(new URL(input.path, input.host), {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(input.bearerToken ? { authorization: `Bearer ${input.bearerToken}` } : {}),
    },
    body: JSON.stringify(input.body),
  })

  let payload: unknown = null
  const text = await response.text()
  if (text.length > 0) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }

  if (!response.ok) {
    const message = extractHostedErrorMessage(payload) ?? `Hosted sync request failed with HTTP ${response.status}.`
    throw new Error(message)
  }

  return payload as TResponse
}

function extractHostedErrorMessage(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return typeof payload === 'string' && payload.length > 0 ? payload : null
  }
  const record = payload as Record<string, unknown>
  if (typeof record.message === 'string' && record.message.length > 0) {
    return record.message
  }
  if (record.error && typeof record.error === 'object' && !Array.isArray(record.error)) {
    const error = record.error as Record<string, unknown>
    if (typeof error.message === 'string' && error.message.length > 0) {
      return error.message
    }
  }
  return null
}
