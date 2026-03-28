import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import { requireData, runCli, runRawCli } from './cli-test-helpers.js'

interface DeviceTestState {
  lastConnectBody: Record<string, unknown> | null
  lastAccountQuery: string | null
  authorizationHeaders: string[]
}

const connectedAccount = {
  id: 'acct_whoop_01',
  provider: 'whoop',
  externalAccountId: 'whoop-user-1',
  displayName: 'WHOOP Tester',
  status: 'active',
  scopes: ['offline', 'read:profile', 'read:sleep'],
  accessTokenExpiresAt: '2026-03-18T12:00:00.000Z',
  metadata: {
    profile: {
      user_id: 'whoop-user-1',
    },
  },
  connectedAt: '2026-03-17T12:00:00.000Z',
  lastWebhookAt: null,
  lastSyncStartedAt: null,
  lastSyncCompletedAt: null,
  lastSyncErrorAt: null,
  lastErrorCode: null,
  lastErrorMessage: null,
  nextReconcileAt: '2026-03-18T00:00:00.000Z',
  createdAt: '2026-03-17T12:00:00.000Z',
  updatedAt: '2026-03-17T12:00:00.000Z',
} as const

test.sequential('device daemon commands stay in the generated CLI schema', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-cli-'))

  try {
    const schema = JSON.parse(
      await runRawCli([
        'device',
        'daemon',
        'start',
        '--vault',
        vaultRoot,
        '--schema',
        '--format',
        'json',
      ]),
    ) as {
      options: {
        properties: Record<string, unknown>
        required?: string[]
      }
    }

    assert.equal('vault' in schema.options.properties, true)
    assert.equal('baseUrl' in schema.options.properties, true)
    assert.deepEqual(schema.options.required, ['vault'])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test.sequential(
  'device CLI commands route through the local device sync control plane',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-cli-'))
    const state: DeviceTestState = {
      lastConnectBody: null,
      lastAccountQuery: null,
      authorizationHeaders: [],
    }
    const server = createServer(async (request, response) => {
      state.authorizationHeaders.push(request.headers.authorization ?? '')
      const requestUrl = new URL(
        request.url ?? '/',
        'http://127.0.0.1:8788',
      )

      if (request.method === 'GET' && requestUrl.pathname === '/providers') {
        respondJson(response, 200, {
          providers: [
            {
              provider: 'whoop',
              callbackPath: '/oauth/whoop/callback',
              callbackUrl: 'http://127.0.0.1:8788/oauth/whoop/callback',
              webhookPath: '/webhooks/whoop',
              webhookUrl: 'http://127.0.0.1:8788/webhooks/whoop',
              supportsWebhooks: true,
              defaultScopes: ['offline', 'read:profile', 'read:sleep'],
            },
          ],
        })
        return
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/providers/whoop/connect'
      ) {
        state.lastConnectBody = await readJsonBody(request)
        respondJson(response, 200, {
          provider: 'whoop',
          state: 'state_01',
          expiresAt: '2026-03-17T13:00:00.000Z',
          authorizationUrl: 'https://whoop.test/oauth?state=state_01',
        })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/accounts') {
        state.lastAccountQuery = requestUrl.search
        respondJson(response, 200, {
          accounts: [connectedAccount],
        })
        return
      }

      if (request.method === 'GET' && requestUrl.pathname === '/accounts/acct_whoop_01') {
        respondJson(response, 200, {
          account: connectedAccount,
        })
        return
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/accounts/acct_whoop_01/reconcile'
      ) {
        respondJson(response, 200, {
          account: connectedAccount,
          job: {
            id: 'job_01',
            provider: 'whoop',
            accountId: 'acct_whoop_01',
            kind: 'reconcile',
            payload: {
              mode: 'manual',
            },
            priority: 100,
            availableAt: '2026-03-17T12:01:00.000Z',
            attempts: 0,
            maxAttempts: 5,
            dedupeKey: 'reconcile:acct_whoop_01',
            status: 'queued',
            leaseOwner: null,
            leaseExpiresAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
            createdAt: '2026-03-17T12:01:00.000Z',
            updatedAt: '2026-03-17T12:01:00.000Z',
            startedAt: null,
            finishedAt: null,
          },
        })
        return
      }

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/accounts/acct_whoop_01/disconnect'
      ) {
        respondJson(response, 200, {
          account: {
            ...connectedAccount,
            status: 'disconnected',
            updatedAt: '2026-03-17T12:02:00.000Z',
          },
        })
        return
      }

      respondJson(response, 404, {
        error: {
          code: 'NOT_FOUND',
          message: `Unexpected route ${request.method ?? 'GET'} ${requestUrl.pathname}`,
        },
      })
    })

    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()

    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP listening address for device CLI test.')
    }

    const baseUrl = `http://127.0.0.1:${address.port}`
    const env = {
      DEVICE_SYNC_BASE_URL: baseUrl,
      DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
    }

    try {
      const providers = requireData(
        await runCli<{
          baseUrl: string
          providers: Array<{ provider: string }>
        }>(['device', 'provider', 'list', '--vault', vaultRoot], { env }),
      )
      assert.equal(providers.baseUrl, baseUrl)
      assert.deepEqual(
        providers.providers.map((provider) => provider.provider),
        ['whoop'],
      )

      const connect = requireData(
        await runCli<{
          baseUrl: string
          provider: string
          authorizationUrl: string
          openedBrowser: boolean
        }>(
          [
            'device',
            'connect',
            'whoop',
            '--vault',
            vaultRoot,
            '--return-to',
            'http://127.0.0.1:3000/devices',
          ],
          { env },
        ),
      )
      assert.equal(connect.baseUrl, baseUrl)
      assert.equal(connect.provider, 'whoop')
      assert.equal(connect.authorizationUrl.includes('state_01'), true)
      assert.equal(connect.openedBrowser, false)
      assert.deepEqual(state.lastConnectBody, {
        returnTo: 'http://127.0.0.1:3000/devices',
      })

      const accounts = requireData(
        await runCli<{
          provider: string | null
          accounts: Array<{ id: string }>
        }>(['device', 'account', 'list', '--vault', vaultRoot, '--provider', 'whoop'], { env }),
      )
      assert.equal(accounts.provider, 'whoop')
      assert.deepEqual(accounts.accounts.map((account) => account.id), [
        'acct_whoop_01',
      ])
      assert.equal(state.lastAccountQuery, '?provider=whoop')

      const show = requireData(
        await runCli<{
          account: { id: string; provider: string }
        }>(['device', 'account', 'show', 'acct_whoop_01', '--vault', vaultRoot], { env }),
      )
      assert.equal(show.account.id, 'acct_whoop_01')
      assert.equal(show.account.provider, 'whoop')

      const reconcile = requireData(
        await runCli<{
          account: { id: string }
          job: { kind: string; status: string }
        }>(['device', 'account', 'reconcile', 'acct_whoop_01', '--vault', vaultRoot], { env }),
      )
      assert.equal(reconcile.account.id, 'acct_whoop_01')
      assert.equal(reconcile.job.kind, 'reconcile')
      assert.equal(reconcile.job.status, 'queued')

      const disconnect = requireData(
        await runCli<{
          account: { id: string; status: string }
        }>(['device', 'account', 'disconnect', 'acct_whoop_01', '--vault', vaultRoot], { env }),
      )
      assert.equal(disconnect.account.id, 'acct_whoop_01')
      assert.equal(disconnect.account.status, 'disconnected')
      assert.equal(state.authorizationHeaders.length > 0, true)
      assert.equal(
        state.authorizationHeaders.every(
          (value) => value === 'Bearer control-token-for-tests',
        ),
        true,
      )
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error)
            return
          }

          resolve()
        })
      })
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

async function readJsonBody(
  request: import('node:http').IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }

  if (chunks.length === 0) {
    return {}
  }

  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
    string,
    unknown
  >
}

function respondJson(
  response: import('node:http').ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  const body = JSON.stringify(payload)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}
