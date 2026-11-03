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

const DEVICE_CONTROL_PLANE_TEST_TIMEOUT_MS = 120_000

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
      assert.equal(result.envelope.error.code, 'VALIDATION_ERROR')
      assert.equal(result.envelope.error.message, 'The command input is invalid.')
      assert.deepEqual(result.envelope.error.fieldErrors?.[0], {
        code: 'custom',
        missing: false,
        path: 'provider',
        expected: '',
        received: 'invalid',
        message: 'This field is invalid.',
      })
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
      assert.equal(result.envelope.error.code, 'VALIDATION_ERROR')
      assert.equal(result.envelope.error.message, 'The command input is invalid.')
      assert.deepEqual(result.envelope.error.fieldErrors?.[0], {
        code: 'custom',
        missing: false,
        path: 'provider',
        expected: '',
        received: 'invalid',
        message: 'This field is invalid.',
      })
    }
  } finally {
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('hosted device connect fails closed before local daemon access', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-connect-'))

  try {
    vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
    const result = await runInProcessJsonCli(createVaultCli(), [
      'device',
      'connect',
      'whoop',
      '--vault',
      vaultRoot,
    ])

    assert.equal(result.envelope.ok, false)
    if (!result.envelope.ok) {
      assert.equal(result.envelope.error.code, 'invalid_option')
      assert.match(result.envelope.error.message ?? '', /root hosted device tool/u)
    }
  } finally {
    vi.unstubAllEnvs()
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('hosted device connect service requires the root tool', async () => {
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
        assert.equal((error as { code?: string }).code, 'invalid_option')
        assert.match(error instanceof Error ? error.message : '', /root hosted device tool/u)
        return true
      },
    )
  } finally {
    vi.unstubAllEnvs()
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('hosted device connect CLI ignores explicit local daemon targets and fails closed', async () => {
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
      assert.equal(result.envelope.error.code, 'invalid_option')
      assert.match(result.envelope.error.message ?? '', /root hosted device tool/u)
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

test('hosted device services require the root tool before local control-plane access', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-hosted-env-base-url-'))
  const services = createIntegratedDeviceSyncServices()

  try {
    vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
    vi.stubEnv('DEVICE_SYNC_BASE_URL', 'http://127.0.0.1:1')
    vi.stubEnv('DEVICE_SYNC_CONTROL_TOKEN', 'control-token-for-tests')

    const expectRootToolRejection = async (
      run: () => Promise<unknown>,
    ) => {
      await assert.rejects(
        run,
        (error: unknown) => {
          assert.equal((error as { code?: string }).code, 'invalid_option')
          assert.match(error instanceof Error ? error.message : '', /root hosted device tool/u)
          return true
        },
      )
    }

    await expectRootToolRejection(() => services.listProviders({ vault: vaultRoot }))
    await expectRootToolRejection(() => services.connect({
      provider: 'whoop',
      vault: vaultRoot,
    }))
    await expectRootToolRejection(() => services.listAccounts({ vault: vaultRoot }))
    await expectRootToolRejection(() => services.showAccount({
      accountId: 'acct_whoop_01',
      vault: vaultRoot,
    }))
    await expectRootToolRejection(() => services.reconcileAccount({
      accountId: 'acct_whoop_01',
      vault: vaultRoot,
    }))
    await expectRootToolRejection(() => services.disconnectAccount({
      accountId: 'acct_whoop_01',
      vault: vaultRoot,
    }))
  } finally {
    vi.unstubAllEnvs()
    await rm(vaultRoot, { recursive: true, force: true })
  }
})

test('hosted device provider list returns only the static catalog', async () => {
  try {
    vi.stubEnv('MURPH_HOSTED_RUNTIME_PROCESS', '1')
    const result = await createIntegratedDeviceSyncServices().listProviders({})

    assert.equal(result.baseUrl, undefined)
    assert.equal('local' in result, false)
    assert.equal(result.providers.length > 0, true)
    assert.equal(result.providers.every((provider) => provider.source === 'catalog'), true)
    assert.equal(result.providers.every((provider) => provider.localConfigured === false), true)
  } finally {
    vi.unstubAllEnvs()
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
        assert.equal((error as { code?: string }).code, 'invalid_option')
        assert.match(error instanceof Error ? error.message : '', /root hosted device tool/u)
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

test.sequential('hosted device connect retains its generated return target option schema', async () => {
  const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-cli-'))

  try {
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
