import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test, vi } from 'vitest'

import {
  createIntegratedDeviceSyncServices,
} from '../src/device-services.js'
import { createVaultCli } from '../src/vault-cli.js'
import {
  requireData,
  runCli,
  runInProcessJsonCli,
  runRawCli,
} from './cli-test-helpers.js'

const DEVICE_HOSTED_BRIDGE_SMOKE_TIMEOUT_MS = 120_000

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

const supportsLoopbackListen = (() => {
  const probe = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
        import { createServer } from 'node:http'

        const server = createServer()
        server.once('error', () => process.exit(1))
        server.listen(0, '127.0.0.1', () => {
          server.close(() => process.exit(0))
        })
      `,
    ],
    {
      encoding: 'utf8',
    },
  )

  return probe.status === 0
})()

const deviceControlPlaneTest = supportsLoopbackListen ? test.sequential : test.skip

async function runSourceDeviceCliRaw(args: string[]): Promise<string> {
  const cli = createVaultCli()
  const output: string[] = []

  await cli.serve(args, {
    env: process.env,
    exit: () => {},
    stdout(chunk) {
      output.push(chunk)
    },
  })

  return output.join('').trim()
}

test.sequential('device daemon commands stay in the generated CLI schema', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-cli-'))

  try {
    const schema = JSON.parse(
      await runSourceDeviceCliRaw([
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

    assert.equal('vault' in schema.options.properties, false)
    assert.equal('baseUrl' in schema.options.properties, true)
    assert.deepEqual(schema.options.required ?? [], [])

    const connectSchema = JSON.parse(
      await runSourceDeviceCliRaw([
        'device',
        'connect',
        'whoop',
        '--vault',
        vaultRoot,
        '--schema',
        '--format',
        'json',
      ]),
    ) as {
      options: {
        properties: Record<string, {
          description?: string
        }>
      }
    }

    assert.match(
      String(connectSchema.options.properties.returnTo?.description ?? ''),
      /root-relative path/u,
    )
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('device account provider inputs reject public connect targets before daemon routing', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-provider-guard-'))

  try {
    const result = await runInProcessJsonCli(createVaultCli(), [
      'device',
      'account',
      'list',
      '--provider',
      'fitbit',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.envelope.ok, false)
    if (!result.envelope.ok) {
      assert.match(result.envelope.error.message ?? '', /Unsupported device-sync provider/u)
      assert.match(result.envelope.error.message ?? '', /junction, oura, whoop, strava/u)
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('device connect rejects Junction as a public connect target', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-target-guard-'))

  try {
    const result = await runInProcessJsonCli(createVaultCli(), [
      'device',
      'connect',
      'junction',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.envelope.ok, false)
    if (!result.envelope.ok) {
      assert.match(result.envelope.error.message ?? '', /Expected a device connect target/u)
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('device connect uses hosted CLI bridge in hosted runtime without local daemon credentials', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-connect-'))
  const bridgeToken = 'bridge-token'
  let requestBody: unknown = null
  let authorization: string | undefined

  const server = createServer((request, response) => {
    authorization = request.headers.authorization
    const chunks: Buffer[] = []
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on('end', () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        authorizationUrl: 'https://withmurph.ai/device/connect/dc_opaque',
        connectUrl: 'https://withmurph.ai/device/connect/dc_opaque',
        expiresAt: '2026-05-03T20:15:00.000Z',
        provider: 'whoop',
        providerLabel: 'WHOOP',
      }))
    })
  })

  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP listening address for hosted bridge test.')
    }

    const result = requireData(
      await runCli<{
        status: 'ok'
        kind: 'device_connect_link'
        backend: 'hosted'
        provider: string
        providerLabel: string
        authorizationUrl: string
        connectUrl: string
        expiresAt: string
        baseUrl?: string
        state?: string
        openedBrowser?: boolean
      }>(['device', 'connect', 'whoop', '--vault', vaultRoot], {
        env: {
          MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
          MURPH_HOSTED_RUNTIME_PROCESS: '1',
          MURPH_HOSTED_CLI_BRIDGE_TOKEN: bridgeToken,
          MURPH_HOSTED_CLI_BRIDGE_URL: `http://127.0.0.1:${address.port}/`,
          OURA_CLIENT_ID: '',
          OURA_CLIENT_SECRET: '',
          STRAVA_CLIENT_ID: '',
          STRAVA_CLIENT_SECRET: '',
          WHOOP_CLIENT_ID: '',
          WHOOP_CLIENT_SECRET: '',
        },
      }),
    )

    assert.equal(authorization, `Bearer ${bridgeToken}`)
    assert.deepEqual(requestBody, { connectTarget: 'whoop' })
    assert.equal(result.status, 'ok')
    assert.equal(result.kind, 'device_connect_link')
    assert.equal(result.backend, 'hosted')
    assert.equal(result.provider, 'whoop')
    assert.equal(result.providerLabel, 'WHOOP')
    assert.equal(result.authorizationUrl, 'https://withmurph.ai/device/connect/dc_opaque')
    assert.equal(result.connectUrl, 'https://withmurph.ai/device/connect/dc_opaque')
    assert.equal(result.baseUrl, undefined)
    assert.equal(result.state, undefined)
    assert.equal(result.openedBrowser, undefined)
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
})

test('device connect rejects explicit base URLs in hosted runtime', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-connect-base-url-'))

  try {
    vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
    await assert.rejects(
      () => createIntegratedDeviceSyncServices().connect({
        baseUrl: 'http://127.0.0.1:1',
        provider: 'whoop',
        vault: vaultRoot,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'HOSTED_DEVICE_BASE_URL_UNSUPPORTED')
        assert.match(error instanceof Error ? error.message : '', /hosted bridge/u)
        return true
      },
    )
  } finally {
    vi.unstubAllEnvs()
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('device connect CLI rejects explicit base URLs in hosted runtime before local daemon access', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-connect-cli-base-url-'))
  let requestPath: string | null = null

  const server = createServer((request, response) => {
    requestPath = request.url ?? null
    respondJson(response, 500, {
      error: {
        code: 'LOCAL_DAEMON_SHOULD_NOT_BE_USED',
        message: 'local daemon should not be used',
      },
    })
  })

  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP listening address for hosted CLI base URL test.')
    }

    vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
    const result = await runInProcessJsonCli(createVaultCli(), [
      'device',
      'connect',
      'whoop',
      '--base-url',
      `http://127.0.0.1:${address.port}`,
      '--vault',
      vaultRoot,
    ], {
      env: {
        MURPH_HOSTED_RUNTIME_PROCESS: '1',
        OURA_CLIENT_ID: '',
        OURA_CLIENT_SECRET: '',
        STRAVA_CLIENT_ID: '',
        STRAVA_CLIENT_SECRET: '',
        WHOOP_CLIENT_ID: '',
        WHOOP_CLIENT_SECRET: '',
      },
    })

    assert.equal(result.envelope.ok, false)
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, 'HOSTED_DEVICE_BASE_URL_UNSUPPORTED')
      assert.match(result.envelope.error.message ?? '', /hosted bridge/u)
    }
    assert.equal(requestPath, null)
  } finally {
    vi.unstubAllEnvs()
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
})

test('hosted device services reject env-selected control-plane targets', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-env-base-url-'))
  const services = createIntegratedDeviceSyncServices()

  try {
    vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
    vi.stubEnv('DEVICE_SYNC_BASE_URL', 'http://127.0.0.1:1')
    vi.stubEnv('DEVICE_SYNC_CONTROL_TOKEN', 'control-token-for-tests')

    const expectHostedBaseUrlRejection = async (
      run: () => Promise<unknown>,
    ) => {
      await assert.rejects(
        run,
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, 'HOSTED_DEVICE_BASE_URL_UNSUPPORTED')
          assert.match(error instanceof Error ? error.message : '', /DEVICE_SYNC_BASE_URL/u)
          return true
        },
      )
    }

    await expectHostedBaseUrlRejection(() => services.listProviders({ vault: vaultRoot }))
    await expectHostedBaseUrlRejection(() => services.connect({
      provider: 'whoop',
      vault: vaultRoot,
    }))
    await expectHostedBaseUrlRejection(() => services.listAccounts({ vault: vaultRoot }))
    await expectHostedBaseUrlRejection(() => services.showAccount({
      accountId: 'acct_whoop_01',
      vault: vaultRoot,
    }))
    await expectHostedBaseUrlRejection(() => services.reconcileAccount({
      accountId: 'acct_whoop_01',
      vault: vaultRoot,
    }))
    await expectHostedBaseUrlRejection(() => services.disconnectAccount({
      accountId: 'acct_whoop_01',
      vault: vaultRoot,
    }))
    await expectHostedBaseUrlRejection(() => services.daemonStatus({ vault: vaultRoot }))
    await expectHostedBaseUrlRejection(() => services.daemonStart({ vault: vaultRoot }))
    await expectHostedBaseUrlRejection(() => services.daemonStop({ vault: vaultRoot }))
  } finally {
    vi.unstubAllEnvs()
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('device account list service uses hosted CLI bridge in hosted runtime without local daemon credentials', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-account-list-'))
  const bridgeToken = 'bridge-token'
  let requestPath: string | null = null
  let requestBody: unknown = null
  let authorization: string | undefined

  const server = createServer((request, response) => {
    authorization = request.headers.authorization
    requestPath = request.url ?? null
    const chunks: Buffer[] = []
    request.on('data', (chunk) => {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
    })
    request.on('end', () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        accounts: [
          {
            accessTokenExpiresAt: '2026-05-04T00:00:00.000Z',
            connectedAt: '2026-05-03T20:00:00.000Z',
            createdAt: '2026-05-03T20:00:00.000Z',
            displayName: 'WHOOP',
            externalAccountId: 'external_whoop',
            id: 'dsc_whoop',
            lastErrorCode: null,
            lastErrorMessage: null,
            lastSyncCompletedAt: '2026-05-03T21:00:00.000Z',
            lastSyncErrorAt: null,
            lastSyncStartedAt: '2026-05-03T21:00:00.000Z',
            lastWebhookAt: null,
            metadata: {},
            nextReconcileAt: '2026-05-04T03:00:00.000Z',
            provider: 'whoop',
            scopes: ['read:recovery'],
            sources: [
              {
                displayName: 'Garmin',
                firstSeenAt: '2026-05-03T20:00:00.000Z',
                lastErrorCode: null,
                lastErrorMessage: null,
                lastSeenAt: '2026-05-03T21:00:00.000Z',
                resourceCount: 2,
                sourceProviderSlug: 'garmin',
                status: 'connected',
              },
            ],
            setupExpiresAt: null,
            setupPhase: null,
            status: 'active',
            updatedAt: '2026-05-03T21:00:00.000Z',
          },
        ],
        provider: 'whoop',
        sourceProvider: 'garmin',
      }))
    })
  })

  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP listening address for hosted account list test.')
    }

    vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
    vi.stubEnv('MURPH_HOSTED_CLI_BRIDGE_TOKEN', bridgeToken)
    vi.stubEnv('MURPH_HOSTED_CLI_BRIDGE_URL', `http://127.0.0.1:${address.port}/`)

    const result = await createIntegratedDeviceSyncServices().listAccounts({
      provider: 'whoop',
      sourceProvider: 'garmin',
      vault: vaultRoot,
    })

    assert.equal(authorization, `Bearer ${bridgeToken}`)
    assert.equal(requestPath, '/device/accounts/list')
    assert.deepEqual(requestBody, { provider: 'whoop', sourceProvider: 'garmin' })
    assert.equal(result.baseUrl, undefined)
    assert.equal(result.local, undefined)
    assert.equal(result.provider, 'whoop')
    assert.equal(result.sourceProvider, 'garmin')
    assert.equal(result.accounts.length, 1)
    assert.equal(result.accounts[0]?.provider, 'whoop')
    assert.equal(result.accounts[0]?.status, 'active')
    assert.equal(result.accounts[0]?.sources?.[0]?.sourceProviderSlug, 'garmin')
  } finally {
    vi.unstubAllEnvs()
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
})

test('device account list rejects an explicit base URL in hosted runtime', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-account-list-base-url-'))
  let requestPath: string | null = null
  let requestQuery: string | null = null
  let authorization: string | undefined

  const server = createServer((request, response) => {
    authorization = request.headers.authorization
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1:8788')
    requestPath = requestUrl.pathname
    requestQuery = requestUrl.search
    respondJson(response, 200, {
      accounts: [connectedAccount],
    })
  })

  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP listening address for hosted account list base URL test.')
    }

    vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
    await assert.rejects(
      () => createIntegratedDeviceSyncServices().listAccounts({
        baseUrl: `http://127.0.0.1:${address.port}`,
        provider: 'whoop',
        sourceProvider: 'garmin',
        vault: vaultRoot,
      }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, 'HOSTED_DEVICE_BASE_URL_UNSUPPORTED')
        assert.match(error instanceof Error ? error.message : '', /hosted bridge/u)
        return true
      },
    )
    assert.equal(authorization, undefined)
    assert.equal(requestPath, null)
    assert.equal(requestQuery, null)
  } finally {
    vi.unstubAllEnvs()
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
})

deviceControlPlaneTest(
  'local daemon connect reports the requested mapped connect target',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-cli-mapped-connect-'))
    let connectBody: Record<string, unknown> | null = null
    const server = createServer(async (request, response) => {
      const requestUrl = new URL(
        request.url ?? '/',
        'http://127.0.0.1:8788',
      )

      if (
        request.method === 'POST' &&
        requestUrl.pathname === '/providers/junction/connect'
      ) {
        connectBody = await readJsonBody(request)
        respondJson(response, 200, {
          provider: 'junction',
          state: 'state_garmin_01',
          expiresAt: '2026-03-17T13:00:00.000Z',
          authorizationUrl: 'https://junction.test/connect/garmin?state=state_garmin_01',
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
      throw new Error('Expected a TCP listening address for mapped connect test.')
    }

    try {
      const connect = requireData(
        await runCli<{
          backend: 'local-daemon'
          baseUrl: string
          provider: string
          authorizationUrl: string
        }>([
          'device',
          'connect',
          'garmin',
          '--vault',
          vaultRoot,
          '--base-url',
          `http://127.0.0.1:${address.port}`,
        ], {
          env: {
            JUNCTION_API_KEY: 'sk_us_junction-test',
            JUNCTION_CLIENT_USER_ID_SECRET: 'junction-client-user-id-secret',
            JUNCTION_ENV: 'sandbox',
            JUNCTION_PROVIDER_FILTER: 'garmin',
            JUNCTION_REGION: 'us',
            MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
          },
        }),
      )

      assert.equal(connect.backend, 'local-daemon')
      assert.equal(connect.provider, 'garmin')
      assert.equal(connect.authorizationUrl.includes('state_garmin_01'), true)
      assert.deepEqual(connectBody, {
        sourceProviderSlug: 'garmin',
      })
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

test('device connect in hosted runtime fails bounded when bridge is unavailable', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-missing-bridge-'))

  try {
    const result = await runCli([
      'device',
      'connect',
      'whoop',
      '--vault',
      vaultRoot,
    ], {
      env: {
        MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
        MURPH_HOSTED_RUNTIME_PROCESS: '1',
        OURA_CLIENT_ID: '',
        OURA_CLIENT_SECRET: '',
        STRAVA_CLIENT_ID: '',
        STRAVA_CLIENT_SECRET: '',
        WHOOP_CLIENT_ID: '',
        WHOOP_CLIENT_SECRET: '',
      },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'HOSTED_DEVICE_CONNECT_BRIDGE_UNAVAILABLE')
      assert.doesNotMatch(result.error.message ?? '', /DEVICE_SYNC_PROVIDER_CONFIG_REQUIRED/u)
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
}, DEVICE_HOSTED_BRIDGE_SMOKE_TIMEOUT_MS)

test('device connect in hosted runtime reports bridge request timeouts distinctly', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-timeout-'))
  const bridgeToken = 'bridge-token'

  const server = createServer((_request, response) => {
    response.writeHead(408, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      error: {
        code: 'HOSTED_CLI_BRIDGE_REQUEST_TIMEOUT',
        message: 'Hosted CLI bridge request timed out.',
      },
    }))
  })

  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP listening address for hosted bridge timeout test.')
    }

    const result = await runCli([
      'device',
      'connect',
      'whoop',
      '--vault',
      vaultRoot,
    ], {
      env: {
        MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
        MURPH_HOSTED_RUNTIME_PROCESS: '1',
        MURPH_HOSTED_CLI_BRIDGE_TOKEN: bridgeToken,
        MURPH_HOSTED_CLI_BRIDGE_URL: `http://127.0.0.1:${address.port}/`,
        OURA_CLIENT_ID: '',
        OURA_CLIENT_SECRET: '',
        STRAVA_CLIENT_ID: '',
        STRAVA_CLIENT_SECRET: '',
        WHOOP_CLIENT_ID: '',
        WHOOP_CLIENT_SECRET: '',
      },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'HOSTED_DEVICE_CONNECT_BRIDGE_REQUEST_TIMEOUT')
      assert.equal(result.error.message, 'Hosted CLI bridge request timed out.')
    }
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
}, DEVICE_HOSTED_BRIDGE_SMOKE_TIMEOUT_MS)

test('device connect in hosted runtime preserves generic bridge failures as bounded errors', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-failed-'))
  const bridgeToken = 'bridge-token'

  const server = createServer((_request, response) => {
    response.writeHead(502, { 'content-type': 'application/json' })
    response.end(JSON.stringify({
      error: {
        code: 'HOSTED_CLI_BRIDGE_REQUEST_FAILED',
        message: 'Hosted CLI bridge request failed.',
      },
    }))
  })

  try {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    const address = server.address()
    if (!address || typeof address === 'string') {
      throw new Error('Expected a TCP listening address for hosted bridge failure test.')
    }

    const result = await runCli([
      'device',
      'connect',
      'whoop',
      '--vault',
      vaultRoot,
    ], {
      env: {
        MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
        MURPH_HOSTED_RUNTIME_PROCESS: '1',
        MURPH_HOSTED_CLI_BRIDGE_TOKEN: bridgeToken,
        MURPH_HOSTED_CLI_BRIDGE_URL: `http://127.0.0.1:${address.port}/`,
        OURA_CLIENT_ID: '',
        OURA_CLIENT_SECRET: '',
        STRAVA_CLIENT_ID: '',
        STRAVA_CLIENT_SECRET: '',
        WHOOP_CLIENT_ID: '',
        WHOOP_CLIENT_SECRET: '',
      },
    })

    assert.equal(result.ok, false)
    if (!result.ok) {
      assert.equal(result.error.code, 'HOSTED_DEVICE_CONNECT_BRIDGE_REQUEST_FAILED')
      assert.equal(result.error.message, 'Hosted CLI bridge request failed.')
    }
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
}, DEVICE_HOSTED_BRIDGE_SMOKE_TIMEOUT_MS)

test('device provider and account list do not start the managed daemon when local credentials are absent', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-cli-catalog-'))

  try {
    const env = {
      DEVICE_SYNC_BASE_URL: '',
      MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
      OURA_CLIENT_ID: '',
      OURA_CLIENT_SECRET: '',
      STRAVA_CLIENT_ID: '',
      STRAVA_CLIENT_SECRET: '',
      WHOOP_CLIENT_ID: '',
      WHOOP_CLIENT_SECRET: '',
    }
    const providers = requireData(
      await runCli<{
        local?: {
          baseUrl: string
          status: string
          configuredProviders: string[]
        }
        baseUrl?: string
        providers: Array<{
          provider: string
          source?: string
          callbackUrl: string | null
          localConfigured?: boolean
        }>
      }>(['device', 'provider', 'list', '--vault', vaultRoot], { env }),
    )

    assert.match(providers.local?.status ?? '', /^(not_configured|conflict)$/u)
    assert.equal(providers.baseUrl, undefined)
    assert.equal(providers.local?.baseUrl, 'http://localhost:8788')
    assert.deepEqual(providers.local?.configuredProviders, [])
    assert.equal(providers.providers.some((provider) => provider.provider === 'whoop'), true)
    assert.equal(
      providers.providers.every((provider) => provider.callbackUrl === null),
      true,
    )
    assert.equal(
      providers.providers.every((provider) => provider.source === 'catalog'),
      true,
    )
    assert.equal(
      providers.providers.every((provider) => provider.localConfigured === false),
      true,
    )

    const accounts = requireData(
      await runCli<{
        baseUrl?: string
        local?: {
          status: string
          configuredProviders: string[]
        }
        provider: string | null
        accounts: Array<{ id: string }>
      }>(['device', 'account', 'list', '--vault', vaultRoot], { env }),
    )

    assert.match(accounts.local?.status ?? '', /^(not_configured|conflict)$/u)
    assert.deepEqual(accounts.local?.configuredProviders, [])
    assert.equal(accounts.provider, null)
    assert.deepEqual(accounts.accounts, [])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('device provider and account list tolerate partial local provider credentials', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-cli-partial-config-'))

  try {
    const env = {
      DEVICE_SYNC_BASE_URL: '',
      MURPH_CLI_TEST_PERSISTENT_HARNESS: '0',
      OURA_CLIENT_ID: '',
      OURA_CLIENT_SECRET: '',
      STRAVA_CLIENT_ID: '',
      STRAVA_CLIENT_SECRET: '',
      WHOOP_CLIENT_ID: 'whoop-client-id-only',
      WHOOP_CLIENT_SECRET: '',
    }
    const providers = requireData(
      await runCli<{
        local?: {
          status: string
          configuredProviders: string[]
          message: string | null
        }
        providers: Array<{ provider: string }>
      }>(['device', 'provider', 'list', '--vault', vaultRoot], { env }),
    )

    assert.match(providers.local?.status ?? '', /^(not_configured|conflict)$/u)
    assert.deepEqual(providers.local?.configuredProviders, [])
    if (providers.local?.status === 'not_configured') {
      assert.match(providers.local?.message ?? '', /WHOOP configuration is incomplete/u)
    }
    assert.equal(providers.providers.some((provider) => provider.provider === 'whoop'), true)

    const accounts = requireData(
      await runCli<{
        local?: {
          status: string
          message: string | null
        }
        accounts: Array<{ id: string }>
      }>(['device', 'account', 'list', '--vault', vaultRoot], { env }),
    )

    assert.match(accounts.local?.status ?? '', /^(not_configured|conflict)$/u)
    if (accounts.local?.status === 'not_configured') {
      assert.match(accounts.local?.message ?? '', /WHOOP configuration is incomplete/u)
    }
    assert.deepEqual(accounts.accounts, [])
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('device provider and account list reuse a healthy managed daemon without an explicit base URL', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-cli-managed-local-'))
  const baseUrl = 'http://localhost:8788'
  const provider = 'whoop'

  const managedDaemonStatus = {
    baseUrl,
    statePath: '.runtime/operations/device-sync/launcher.json',
    stdoutLogPath: '.runtime/operations/device-sync/stdout.log',
    stderrLogPath: '.runtime/operations/device-sync/stderr.log',
    managed: true,
    running: true,
    healthy: true,
    pid: 12_345,
    startedAt: '2026-04-30T00:00:00.000Z',
    message: 'Murph is already managing the local device sync daemon.',
  } as const
  const managedControlPlane = {
    baseUrl,
    controlToken: 'managed-token',
    managed: true as const,
  }
  const liveProviderList = [
    {
      provider,
      callbackPath: '/oauth/whoop/callback',
      callbackUrl: `${baseUrl}/oauth/whoop/callback`,
      webhookPath: '/webhooks/whoop',
      webhookUrl: `${baseUrl}/webhooks/whoop`,
      supportsWebhooks: true,
      defaultScopes: ['offline', 'read:profile'],
    },
  ]
  const liveAccountList = [
    {
      id: 'acct_whoop_01',
      provider,
      externalAccountId: 'whoop-user-1',
      displayName: 'WHOOP Tester',
      status: 'active',
      scopes: ['offline', 'read:profile'],
      accessTokenExpiresAt: null,
      metadata: {
        source: 'managed-daemon',
      },
      connectedAt: '2026-04-30T00:00:00.000Z',
      lastWebhookAt: null,
      lastSyncStartedAt: null,
      lastSyncCompletedAt: null,
      lastSyncErrorAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      nextReconcileAt: null,
      createdAt: '2026-04-30T00:00:00.000Z',
      updatedAt: '2026-04-30T00:00:00.000Z',
    },
  ]

  const getManagedDeviceSyncDaemonStatusMock = vi.fn(
    async (_input: { vault: string; baseUrl?: string }) => managedDaemonStatus,
  )
  const resolveExistingManagedDeviceSyncControlPlaneMock = vi.fn(
    async (_input: { vault: string; baseUrl?: string }) => managedControlPlane,
  )
  const startManagedDeviceSyncDaemonMock = vi.fn(async () => {
    throw new Error('startManagedDeviceSyncDaemon should not be called for list commands.')
  })
  const listProvidersMock = vi.fn(async () => ({ providers: liveProviderList }))
  const listAccountsMock = vi.fn(async () => ({ accounts: liveAccountList }))
  const createDeviceSyncClientMock = vi.fn(() => ({
    baseUrl,
    beginConnection: vi.fn(),
    disconnectAccount: vi.fn(),
    listAccounts: listAccountsMock,
    listProviders: listProvidersMock,
    reconcileAccount: vi.fn(),
    showAccount: vi.fn(),
  }))
  const readConfiguredDeviceSyncProviderConfigsMock = vi.fn(() => ({}))
  const listConfiguredDeviceSyncProviderNamesMock = vi.fn(() => [])

  try {
    vi.resetModules()
    vi.doMock('@murphai/operator-config/device-daemon', async () => {
      const actual = await vi.importActual<typeof import('@murphai/operator-config/device-daemon')>(
        '@murphai/operator-config/device-daemon',
      )

      return {
        ...actual,
        getManagedDeviceSyncDaemonStatus: getManagedDeviceSyncDaemonStatusMock,
        resolveExistingManagedDeviceSyncControlPlane:
          resolveExistingManagedDeviceSyncControlPlaneMock,
        startManagedDeviceSyncDaemon: startManagedDeviceSyncDaemonMock,
      }
    })
    vi.doMock('@murphai/operator-config/device-sync-client', async () => {
      const actual = await vi.importActual<
        typeof import('@murphai/operator-config/device-sync-client')
      >('@murphai/operator-config/device-sync-client')

      return {
        ...actual,
        createDeviceSyncClient: createDeviceSyncClientMock,
      }
    })
    vi.doMock('@murphai/device-syncd/config', async () => {
      const actual = await vi.importActual<typeof import('@murphai/device-syncd/config')>(
        '@murphai/device-syncd/config',
      )

      return {
        ...actual,
        listConfiguredDeviceSyncProviderNames:
          listConfiguredDeviceSyncProviderNamesMock,
        readConfiguredDeviceSyncProviderConfigs:
          readConfiguredDeviceSyncProviderConfigsMock,
      }
    })

    const { createIntegratedDeviceSyncServices } = await import('../src/device-services.ts')
    const services = createIntegratedDeviceSyncServices()

    const providers = await services.listProviders({ vault: vaultRoot })
    assert.equal(providers.baseUrl, baseUrl)
    assert.equal(providers.local?.status, 'healthy')
    assert.equal(providers.local?.message, managedDaemonStatus.message)
    assert.deepEqual(providers.local?.configuredProviders, [])
    assert.equal(providers.providers[0]?.provider, provider)
    assert.equal(providers.providers[0]?.source, 'local_control_plane')
    assert.equal(providers.providers[0]?.callbackUrl, `${baseUrl}/oauth/whoop/callback`)

    const accounts = await services.listAccounts({ vault: vaultRoot })
    assert.equal(accounts.baseUrl, baseUrl)
    assert.equal(accounts.local?.status, 'healthy')
    assert.equal(accounts.local?.message, managedDaemonStatus.message)
    assert.deepEqual(accounts.local?.configuredProviders, [])
    assert.equal(accounts.provider, null)
    assert.equal(accounts.accounts[0]?.id, 'acct_whoop_01')
    assert.equal(accounts.accounts[0]?.provider, provider)

    assert.equal(getManagedDeviceSyncDaemonStatusMock.mock.calls.length >= 2, true)
    assert.deepEqual(getManagedDeviceSyncDaemonStatusMock.mock.calls[0]?.[0], {
      vault: vaultRoot,
      baseUrl: undefined,
    })
    assert.deepEqual(getManagedDeviceSyncDaemonStatusMock.mock.calls[1]?.[0], {
      vault: vaultRoot,
      baseUrl: undefined,
    })
    assert.equal(
      resolveExistingManagedDeviceSyncControlPlaneMock.mock.calls.length >= 2,
      true,
    )
    assert.deepEqual(resolveExistingManagedDeviceSyncControlPlaneMock.mock.calls[0]?.[0], {
      vault: vaultRoot,
      baseUrl: undefined,
    })
    assert.deepEqual(
      resolveExistingManagedDeviceSyncControlPlaneMock.mock.calls[1]?.[0],
      {
        vault: vaultRoot,
        baseUrl: undefined,
      },
    )
    assert.equal(startManagedDeviceSyncDaemonMock.mock.calls.length, 0)
    assert.equal(listProvidersMock.mock.calls.length, 1)
    assert.equal(listAccountsMock.mock.calls.length, 1)
  } finally {
    vi.doUnmock('@murphai/operator-config/device-daemon')
    vi.doUnmock('@murphai/operator-config/device-sync-client')
    vi.doUnmock('@murphai/device-syncd/config')
    vi.resetModules()
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

deviceControlPlaneTest(
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
          providers: Array<{ provider: string; source?: string }>
        }>(['device', 'provider', 'list', '--vault', vaultRoot], { env }),
      )
      assert.equal(providers.baseUrl, baseUrl)
      assert.deepEqual(
        providers.providers.map((provider) => provider.provider),
        ['whoop'],
      )
      assert.equal(providers.providers[0]?.source, undefined)

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
            '/devices',
          ],
          { env },
        ),
      )
      assert.equal(connect.baseUrl, baseUrl)
      assert.equal(connect.provider, 'whoop')
      assert.equal(connect.authorizationUrl.includes('state_01'), true)
      assert.equal(connect.openedBrowser, false)
      assert.deepEqual(state.lastConnectBody, {
        returnTo: '/devices',
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
  DEVICE_HOSTED_BRIDGE_SMOKE_TIMEOUT_MS,
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
