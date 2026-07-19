import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test } from 'vitest'
import { parseVersionedJsonStateEnvelope } from '@murphai/runtime-state/node'

import {
  ensureManagedDeviceSyncControlPlane,
  getManagedDeviceSyncDaemonStatus,
  startManagedDeviceSyncDaemon,
  stopManagedDeviceSyncDaemon,
} from '@murphai/operator-config/device-daemon'
import {
  resolveExistingManagedDeviceSyncControlPlane,
} from '@murphai/operator-config/device-daemon-control-plane'

const DEVICE_DAEMON_STATE_SCHEMA = 'murph.device-daemon-launcher-state.v1'
const DEVICE_DAEMON_STATE_SCHEMA_VERSION = 1
const TEST_WHOOP_PROVIDER_ENV = {
  WHOOP_CLIENT_ID: 'whoop-client',
  WHOOP_CLIENT_SECRET: 'whoop-secret',
} as const

interface SpawnProcessInput {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  stdoutPath: string
  stderrPath: string
}

interface PersistedLauncherState {
  pid: number
  baseUrl: string
  controlToken?: string
}

function readAuthorizationHeader(headers?: HeadersInit): string | null {
  return headers ? new Headers(headers).get('Authorization') : null
}

function readRequestUrl(input: RequestInfo | URL): string {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

function parsePersistedLauncherState(
  value: unknown,
): PersistedLauncherState {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Device sync daemon launcher state must be an object.')
  }
  if (!('pid' in value) || !('baseUrl' in value)) {
    throw new TypeError('Device sync daemon launcher state is missing required fields.')
  }
  const pid = value.pid
  const baseUrl = value.baseUrl
  const controlToken = 'controlToken' in value ? value.controlToken : undefined
  if (typeof pid !== 'number' || !Number.isInteger(pid)) {
    throw new TypeError('Device sync daemon launcher state pid must be an integer.')
  }
  if (typeof baseUrl !== 'string') {
    throw new TypeError('Device sync daemon launcher state baseUrl must be a string.')
  }
  if (controlToken !== undefined && typeof controlToken !== 'string') {
    throw new TypeError(
      'Device sync daemon launcher state controlToken must be a string when present.',
    )
  }

  return controlToken === undefined
    ? { pid, baseUrl }
    : { pid, baseUrl, controlToken }
}

function requireSpawnedProcess(
  value: SpawnProcessInput | null,
): SpawnProcessInput {
  if (value === null) {
    throw new Error('expected spawnProcess to be called')
  }

  return value
}

function deviceSyncAuthResponse(status: number): ResponseInit {
  return status === 401 || status === 403
    ? {
        status,
        headers: {
          'WWW-Authenticate': 'Bearer realm="device-syncd-control-plane"',
        },
      }
    : { status }
}

test.sequential(
  'startManagedDeviceSyncDaemon keeps launcher state non-secret and persists the managed bearer separately',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    const livePids = new Set<number>()
    const healthCheckAuthorizations: Array<string | null> = []
    const healthCheckUrls: string[] = []
    let healthy = false
    let spawned: SpawnProcessInput | null = null

    try {
      const result = await startManagedDeviceSyncDaemon({
        vault: vaultRoot,
        env: {
          DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
          VAULT_ROOT: '/legacy-vault-root',
          ...TEST_WHOOP_PROVIDER_ENV,
        },
        dependencies: {
          fetchImpl: async (input, init) => {
            healthCheckUrls.push(readRequestUrl(input))
            healthCheckAuthorizations.push(readAuthorizationHeader(init?.headers))
            return (
              new Response(
                JSON.stringify({
                  ok: healthy,
                }),
                {
                  status: healthy ? 200 : 503,
                },
              )
            )
          },
          isProcessAlive(pid) {
            return livePids.has(pid)
          },
          resolveDeviceSyncPackageEntry() {
            return '/virtual/device-syncd/dist/index.js'
          },
          async spawnProcess(input) {
            spawned = input
            livePids.add(4242)
            healthy = true
            return { pid: 4242 }
          },
        },
      })

      assert.equal(result.started, true)
      assert.equal(result.managed, true)
      assert.equal(result.running, true)
      assert.equal(result.healthy, true)
      assert.equal(result.pid, 4242)
      const spawnedProcess = requireSpawnedProcess(spawned)
      assert.equal(spawnedProcess.command, process.execPath)
      assert.deepEqual(spawnedProcess.args, ['/virtual/device-syncd/dist/bin.js'])
      assert.equal(
        spawnedProcess.env.DEVICE_SYNC_VAULT_ROOT,
        vaultRoot,
      )
      assert.equal(spawnedProcess.env.VAULT_ROOT, '/legacy-vault-root')
      assert.equal(
        spawnedProcess.env.DEVICE_SYNC_PUBLIC_BASE_URL,
        'http://localhost:8788',
      )
      assert.equal(
        spawnedProcess.env.DEVICE_SYNC_CONTROL_TOKEN,
        'control-token-for-tests',
      )
      assert.equal(
        spawnedProcess.env.DEVICE_SYNC_SECRET !== 'control-token-for-tests',
        true,
      )
      assert.match(spawnedProcess.env.DEVICE_SYNC_SECRET ?? '', /^[a-f0-9]{64}$/u)

      const launcherState = JSON.parse(
        await readFile(
          path.join(vaultRoot, '.runtime/operations/device-sync/launcher.json'),
          'utf8',
        ),
      )
      const persistedLauncherState = parseVersionedJsonStateEnvelope(launcherState, {
        label: 'Device sync daemon launcher state',
        parseValue: parsePersistedLauncherState,
        schema: DEVICE_DAEMON_STATE_SCHEMA,
        schemaVersion: DEVICE_DAEMON_STATE_SCHEMA_VERSION,
      })
      const persistedControlToken = await readFile(
        path.join(vaultRoot, '.runtime/operations/device-sync/control-token'),
        'utf8',
      )
      const persistedEncryptionSecret = await readFile(
        path.join(vaultRoot, '.runtime/operations/device-sync/encryption-secret'),
        'utf8',
      )
      const launcherDirectoryStats = await stat(
        path.join(vaultRoot, '.runtime/operations/device-sync'),
      )
      const launcherStateStats = await stat(
        path.join(vaultRoot, '.runtime/operations/device-sync/launcher.json'),
      )
      const controlTokenStats = await stat(
        path.join(vaultRoot, '.runtime/operations/device-sync/control-token'),
      )
      const encryptionSecretStats = await stat(
        path.join(vaultRoot, '.runtime/operations/device-sync/encryption-secret'),
      )

      assert.equal(persistedLauncherState.pid, 4242)
      assert.equal(persistedLauncherState.baseUrl, 'http://localhost:8788')
      assert.equal('controlToken' in persistedLauncherState, false)
      assert.equal(persistedControlToken.trim(), 'control-token-for-tests')
      assert.match(persistedEncryptionSecret.trim(), /^[a-f0-9]{64}$/u)
      assert.equal(persistedEncryptionSecret.trim(), spawnedProcess.env.DEVICE_SYNC_SECRET)
      assert.equal(launcherDirectoryStats.mode & 0o777, 0o700)
      assert.equal(launcherStateStats.mode & 0o777, 0o600)
      assert.equal(controlTokenStats.mode & 0o777, 0o600)
      assert.equal(encryptionSecretStats.mode & 0o777, 0o600)
      assert.deepEqual(healthCheckAuthorizations, [
        null,
        'Bearer control-token-for-tests',
      ])
      assert.deepEqual(healthCheckUrls, [
        'http://localhost:8788/healthz',
        'http://localhost:8788/healthz',
      ])

      const reusedControlPlane = await ensureManagedDeviceSyncControlPlane({
        vault: vaultRoot,
        dependencies: {
          fetchImpl: async (input, init) => {
            const authorization = readAuthorizationHeader(init?.headers)
            healthCheckUrls.push(readRequestUrl(input))
            healthCheckAuthorizations.push(authorization)
            return (
              new Response(
                JSON.stringify({
                  ok: authorization === 'Bearer control-token-for-tests',
                }),
                {
                  ...deviceSyncAuthResponse(
                    authorization === 'Bearer control-token-for-tests' ? 200 : 401,
                  ),
                },
              )
            )
          },
          isProcessAlive(pid) {
            return livePids.has(pid)
          },
        },
      })

      assert.equal(reusedControlPlane.controlToken, 'control-token-for-tests')
      assert.deepEqual(healthCheckAuthorizations, [
        null,
        'Bearer control-token-for-tests',
        'Bearer control-token-for-tests',
      ])
      assert.deepEqual(healthCheckUrls, [
        'http://localhost:8788/healthz',
        'http://localhost:8788/healthz',
        'http://localhost:8788/healthz',
      ])
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'resolveExistingManagedDeviceSyncControlPlane reuses a healthy managed daemon without provider env',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    const livePids = new Set<number>()
    let healthy = false

    try {
      await startManagedDeviceSyncDaemon({
        vault: vaultRoot,
        baseUrl: 'http://localhost:9876',
        env: {
          DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
          ...TEST_WHOOP_PROVIDER_ENV,
        },
        dependencies: {
          fetchImpl: async (_input, init) => {
            const authorization = readAuthorizationHeader(init?.headers)
            if (!authorization) {
              return new Response(JSON.stringify({ ok: false }), { status: 503 })
            }
            return new Response(
              JSON.stringify({
                ok: healthy && authorization === 'Bearer control-token-for-tests',
              }),
              {
                ...deviceSyncAuthResponse(
                  healthy && authorization === 'Bearer control-token-for-tests'
                    ? 200
                    : 401,
                ),
              },
            )
          },
          isProcessAlive(pid) {
            return livePids.has(pid)
          },
          resolveDeviceSyncPackageEntry() {
            return '/virtual/device-syncd/dist/index.js'
          },
          async spawnProcess() {
            livePids.add(4343)
            healthy = true
            return { pid: 4343 }
          },
        },
      })

      const controlPlane = await resolveExistingManagedDeviceSyncControlPlane({
        vault: vaultRoot,
        baseUrl: 'http://localhost:9876',
        env: {
          DEVICE_SYNC_CONTROL_TOKEN: '',
          WHOOP_CLIENT_ID: '',
          WHOOP_CLIENT_SECRET: '',
        },
        dependencies: {
          fetchImpl: async (_input, init) => {
            const authorization = readAuthorizationHeader(init?.headers)
            return new Response(
              JSON.stringify({
                ok: authorization === 'Bearer control-token-for-tests',
              }),
              deviceSyncAuthResponse(
                authorization === 'Bearer control-token-for-tests' ? 200 : 401,
              ),
            )
          },
          isProcessAlive(pid) {
            return livePids.has(pid)
          },
        },
      })

      assert.deepEqual(controlPlane, {
        baseUrl: 'http://localhost:9876',
        controlToken: 'control-token-for-tests',
        managed: true,
      })
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'startManagedDeviceSyncDaemon fails closed when launcher state is missing but a daemon is reachable',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    const healthCheckAuthorizations: Array<string | null> = []
    let healthy = false
    let spawnCalls = 0

    try {
      await startManagedDeviceSyncDaemon({
        vault: vaultRoot,
        env: {
          DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
          ...TEST_WHOOP_PROVIDER_ENV,
        },
        dependencies: {
          fetchImpl: async (input, init) => {
            healthCheckAuthorizations.push(readAuthorizationHeader(init?.headers))
            return new Response(
              JSON.stringify({
                ok: healthy,
              }),
              { status: healthy ? 200 : 503 },
            )
          },
          isProcessAlive(pid) {
            return pid === 8181
          },
          resolveDeviceSyncPackageEntry() {
            return '/virtual/device-syncd/dist/index.js'
          },
          async spawnProcess() {
            spawnCalls += 1
            healthy = true
            return { pid: 8181 }
          },
        },
      })

      await rm(
        path.join(vaultRoot, '.runtime/operations/device-sync/launcher.json'),
        { force: true },
      )

      await assert.rejects(
        () =>
          startManagedDeviceSyncDaemon({
            vault: vaultRoot,
            dependencies: {
              fetchImpl: async (_input, init) => {
                healthCheckAuthorizations.push(readAuthorizationHeader(init?.headers))
                return new Response(
                  JSON.stringify({ ok: false }),
                  deviceSyncAuthResponse(401),
                )
              },
              isProcessAlive() {
                return false
              },
              async spawnProcess() {
                spawnCalls += 1
                throw new Error('spawnProcess should not be called')
              },
            },
          }),
        (error) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'DEVICE_SYNC_DAEMON_CONFLICT' &&
          /this vault is not managing it/u.test(error.message) &&
          /lsof -nP -iTCP:8788 -sTCP:LISTEN/u.test(error.message),
      )

      assert.equal(spawnCalls, 1)
      assert.deepEqual(healthCheckAuthorizations, [
        null,
        'Bearer control-token-for-tests',
        null,
      ])
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'startManagedDeviceSyncDaemon fails closed when a daemon is reachable but the managed token was wiped',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    let spawnCalls = 0

    try {
      await assert.rejects(
        () =>
          startManagedDeviceSyncDaemon({
            vault: vaultRoot,
            dependencies: {
              fetchImpl: async () =>
                new Response(
                  JSON.stringify({
                    error: {
                      code: 'UNAUTHORIZED',
                    },
                  }),
                  { status: 401 },
                ),
              async spawnProcess() {
                spawnCalls += 1
                throw new Error('spawnProcess should not be called')
              },
            },
          }),
        (error) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'DEVICE_SYNC_DAEMON_CONFLICT' &&
          /this vault is not managing it/u.test(error.message) &&
          /lsof -nP -iTCP:8788 -sTCP:LISTEN/u.test(error.message),
      )

      assert.equal(spawnCalls, 0)
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'startManagedDeviceSyncDaemon does not send managed tokens to reachable listeners after launcher state is missing',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    const healthCheckAuthorizations: Array<string | null> = []
    let healthy = false
    let spawnCalls = 0

    try {
      await startManagedDeviceSyncDaemon({
        vault: vaultRoot,
        env: {
          DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
          ...TEST_WHOOP_PROVIDER_ENV,
        },
        dependencies: {
          fetchImpl: async (_input, init) => {
            const authorization = readAuthorizationHeader(init?.headers)
            healthCheckAuthorizations.push(authorization)
            return new Response(
              JSON.stringify({ ok: healthy && authorization === 'Bearer control-token-for-tests' }),
              { status: healthy && authorization === 'Bearer control-token-for-tests' ? 200 : 503 },
            )
          },
          async spawnProcess() {
            spawnCalls += 1
            healthy = true
            return { pid: 8282 }
          },
          resolveDeviceSyncPackageEntry() {
            return '/virtual/device-syncd/dist/index.js'
          },
        },
      })

      await rm(
        path.join(vaultRoot, '.runtime/operations/device-sync/launcher.json'),
        { force: true },
      )
      healthCheckAuthorizations.length = 0

      await assert.rejects(
        () =>
          startManagedDeviceSyncDaemon({
            vault: vaultRoot,
            dependencies: {
              fetchImpl: async (_input, init) => {
                healthCheckAuthorizations.push(readAuthorizationHeader(init?.headers))
                return new Response(JSON.stringify({ ok: false }), deviceSyncAuthResponse(401))
              },
              async spawnProcess() {
                spawnCalls += 1
                throw new Error('spawnProcess should not be called')
              },
            },
          }),
        (error) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'DEVICE_SYNC_DAEMON_CONFLICT',
      )

      assert.equal(spawnCalls, 1)
      assert.deepEqual(healthCheckAuthorizations, [null])
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'startManagedDeviceSyncDaemon maps address-in-use startup logs to a daemon conflict',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    let nowValue = 0
    let signaledPid: number | null = null

    try {
      await assert.rejects(
        () =>
          startManagedDeviceSyncDaemon({
            vault: vaultRoot,
            env: {
              DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
              ...TEST_WHOOP_PROVIDER_ENV,
            },
            dependencies: {
              now() {
                return new Date(nowValue)
              },
              sleep: async (milliseconds) => {
                nowValue += milliseconds
              },
              fetchImpl: async () =>
                new Response(
                  JSON.stringify({
                    ok: false,
                  }),
                  { status: 503 },
                ),
              isProcessAlive(pid) {
                return pid === 9191
              },
              killProcess(pid) {
                signaledPid = pid
              },
              readFile: async (filePath) => {
                if (filePath.endsWith('stderr.log')) {
                  return 'Error: listen EADDRINUSE: address already in use 127.0.0.1:8788'
                }

                return await readFile(filePath, 'utf8')
              },
              resolveDeviceSyncPackageEntry() {
                return '/virtual/device-syncd/dist/index.js'
              },
              async spawnProcess() {
                return { pid: 9191 }
              },
            },
          }),
        (error) => {
          assert.equal(signaledPid, 9191)
          return (
            error instanceof Error &&
            'code' in error &&
            error.code === 'DEVICE_SYNC_DAEMON_CONFLICT' &&
            /already listening at http:\/\/localhost:8788/u.test(error.message) &&
            /lsof -nP -iTCP:8788 -sTCP:LISTEN/u.test(error.message) &&
            !/Murph could not start/u.test(error.message)
          )
        },
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'startManagedDeviceSyncDaemon surfaces missing provider credentials with a dedicated error code',
  async () => {
    const preflightVaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    const startupLogVaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    let spawnedWithoutProviders = false
    let startupLogNowValue = 0
    let signaledPid: number | null = null

    try {
      await assert.rejects(
        () =>
          startManagedDeviceSyncDaemon({
            vault: preflightVaultRoot,
            env: {
              DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
            },
            dependencies: {
              fetchImpl: async () =>
                new Response(JSON.stringify({ ok: false }), { status: 503 }),
              isProcessAlive() {
                return false
              },
              async spawnProcess() {
                spawnedWithoutProviders = true
                throw new Error('spawnProcess should not be called')
              },
            },
          }),
        (error) =>
          error instanceof Error &&
          'code' in error &&
          error.code === 'DEVICE_SYNC_PROVIDER_CONFIG_REQUIRED' &&
          /No local device sync provider credentials are configured/u.test(error.message),
      )
      assert.equal(spawnedWithoutProviders, false)

      await assert.rejects(
        () =>
          startManagedDeviceSyncDaemon({
            vault: startupLogVaultRoot,
            env: {
              DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
              ...TEST_WHOOP_PROVIDER_ENV,
            },
            dependencies: {
              now() {
                return new Date(startupLogNowValue)
              },
              sleep: async (milliseconds) => {
                startupLogNowValue += milliseconds
              },
              fetchImpl: async () =>
                new Response(JSON.stringify({ ok: false }), { status: 503 }),
              isProcessAlive(pid) {
                return pid === 9292
              },
              killProcess(pid) {
                signaledPid = pid
              },
              readFile: async (filePath) => {
                if (filePath.endsWith('stderr.log')) {
                  return 'TypeError: No device sync providers are configured.'
                }

                return await readFile(filePath, 'utf8')
              },
              resolveDeviceSyncPackageEntry() {
                return '/virtual/device-syncd/dist/index.js'
              },
              async spawnProcess() {
                return { pid: 9292 }
              },
            },
          }),
        (error) => {
          assert.equal(signaledPid, 9292)
          return (
            error instanceof Error &&
            'code' in error &&
            error.code === 'DEVICE_SYNC_PROVIDER_CONFIG_REQUIRED' &&
            !/Murph could not start/u.test(error.message)
          )
        },
      )
    } finally {
      await rm(preflightVaultRoot, { recursive: true, force: true })
      await rm(startupLogVaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'startManagedDeviceSyncDaemon redacts secret-bearing startup log snippets on failure',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    let nowValue = 0
    let signaledPid: number | null = null

    try {
      await assert.rejects(
        () =>
          startManagedDeviceSyncDaemon({
            vault: vaultRoot,
            env: {
              DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
              ...TEST_WHOOP_PROVIDER_ENV,
            },
            dependencies: {
              now() {
                return new Date(nowValue)
              },
              sleep: async (milliseconds) => {
                nowValue += milliseconds
              },
              fetchImpl: async () =>
                new Response(
                  JSON.stringify({
                    ok: false,
                  }),
                  { status: 503 },
                ),
              isProcessAlive(pid) {
                return pid === 7171
              },
              killProcess(pid) {
                signaledPid = pid
              },
              readFile: async (filePath) => {
                if (filePath.endsWith('stderr.log')) {
                  return [
                    'fatal startup error',
                    'Authorization: Bearer secret-token-value',
                    'bearer lower-case-token-value',
                    'password=hunter2',
                    'api_key=sk-test-secret',
                  ].join('\n')
                }

                return await readFile(filePath, 'utf8')
              },
              resolveDeviceSyncPackageEntry() {
                return '/virtual/device-syncd/dist/index.js'
              },
              async spawnProcess() {
                return { pid: 7171 }
              },
            },
          }),
        (error) => {
          assert.equal(signaledPid, 7171)
          return (
            error instanceof Error
            && error.message.includes('Authorization: [REDACTED]')
            && error.message.includes('bearer [REDACTED]')
            && error.message.includes('password=[REDACTED]')
            && error.message.includes('api_key=[REDACTED]')
            && !error.message.includes('secret-token-value')
            && !error.message.includes('lower-case-token-value')
            && !error.message.includes('hunter2')
            && !error.message.includes('sk-test-secret')
          )
        },
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'startManagedDeviceSyncDaemon preserves a distinct DEVICE_SYNC_SECRET when DEVICE_SYNC_CONTROL_TOKEN is also configured',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    const livePids = new Set<number>()
    let healthy = false
    let spawned: SpawnProcessInput | null = null

    try {
      await startManagedDeviceSyncDaemon({
        vault: vaultRoot,
        env: {
          DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
          DEVICE_SYNC_SECRET: 'service-secret-for-tests',
          ...TEST_WHOOP_PROVIDER_ENV,
        },
        dependencies: {
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                ok: healthy,
              }),
              {
                status: healthy ? 200 : 503,
              },
            ),
          isProcessAlive(pid) {
            return livePids.has(pid)
          },
          resolveDeviceSyncPackageEntry() {
            return '/virtual/device-syncd/dist/index.js'
          },
          async spawnProcess(input) {
            spawned = input
            livePids.add(4343)
            healthy = true
            return { pid: 4343 }
          },
        },
      })

      const spawnedProcess = requireSpawnedProcess(spawned)
      assert.equal(
        spawnedProcess.env.DEVICE_SYNC_CONTROL_TOKEN,
        'control-token-for-tests',
      )
      assert.equal(
        spawnedProcess.env.DEVICE_SYNC_SECRET,
        'service-secret-for-tests',
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'ensureManagedDeviceSyncControlPlane honors explicit unmanaged targets without a vault',
  async () => {
    const controlPlane = await ensureManagedDeviceSyncControlPlane({
      env: {
        DEVICE_SYNC_BASE_URL: 'http://127.0.0.1:9911',
        DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
      },
    })

    assert.deepEqual(controlPlane, {
      baseUrl: 'http://127.0.0.1:9911',
      controlToken: 'control-token-for-tests',
      managed: false,
      started: false,
    })
  },
)

test.sequential(
  'ensureManagedDeviceSyncControlPlane rejects non-loopback explicit control-plane targets when a bearer token is configured',
  async () => {
    await assert.rejects(
      () =>
        ensureManagedDeviceSyncControlPlane({
          env: {
            DEVICE_SYNC_BASE_URL: 'https://device-sync.example.test',
            DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
          },
        }),
      (error) =>
        error instanceof Error &&
        /loopback base URLs/u.test(error.message),
    )

    await assert.rejects(
      () =>
        ensureManagedDeviceSyncControlPlane({
          env: {
            DEVICE_SYNC_BASE_URL: 'http://127.example.com:9911',
            DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
          },
        }),
      (error) =>
        error instanceof Error &&
        /loopback base URLs/u.test(error.message),
    )
  },
)

test.sequential(
  'getManagedDeviceSyncDaemonStatus reports stale launcher state clearly',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    const healthCheckAuthorizations: Array<string | null> = []
    const healthCheckUrls: string[] = []
    let healthy = false

    try {
      await startManagedDeviceSyncDaemon({
        vault: vaultRoot,
        env: {
          DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
          ...TEST_WHOOP_PROVIDER_ENV,
        },
        dependencies: {
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                ok: healthy,
              }),
              { status: healthy ? 200 : 503 },
            ),
          isProcessAlive() {
            return true
          },
          resolveDeviceSyncPackageEntry() {
            return '/virtual/device-syncd/dist/index.js'
          },
          async spawnProcess() {
            healthy = true
            return { pid: 5151 }
          },
        },
      })

      const status = await getManagedDeviceSyncDaemonStatus({
        vault: vaultRoot,
        dependencies: {
          fetchImpl: async (input, init) => {
            healthCheckUrls.push(readRequestUrl(input))
            healthCheckAuthorizations.push(readAuthorizationHeader(init?.headers))
            return new Response(
              JSON.stringify({
                ok: false,
              }),
              { status: 503 },
            )
          },
          isProcessAlive() {
            return false
          },
        },
      })

      assert.equal(status.managed, true)
      assert.equal(status.running, false)
      assert.equal(status.healthy, false)
      assert.equal(
        status.message,
        'Stale device-sync daemon state found; recorded PID is no longer running.',
      )
      assert.equal(status.statePath, '.runtime/operations/device-sync/launcher.json')
      assert.deepEqual(healthCheckAuthorizations, [null])
      assert.deepEqual(healthCheckUrls, ['http://localhost:8788/healthz'])
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)

test.sequential(
  'stopManagedDeviceSyncDaemon stops the managed process and removes launcher state',
  async () => {
    const vaultRoot = await mkdtemp(path.join(tmpdir(), 'murph-device-daemon-'))
    const livePids = new Set<number>()
    let signaledPid: number | null = null
    let healthy = false

    try {
      await startManagedDeviceSyncDaemon({
        vault: vaultRoot,
        env: {
          DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
          ...TEST_WHOOP_PROVIDER_ENV,
        },
        dependencies: {
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                ok: healthy,
              }),
              { status: healthy ? 200 : 503 },
            ),
          isProcessAlive(pid) {
            return livePids.has(pid)
          },
          resolveDeviceSyncPackageEntry() {
            return '/virtual/device-syncd/dist/index.js'
          },
          async spawnProcess() {
            livePids.add(6161)
            healthy = true
            return { pid: 6161 }
          },
        },
      })

      const result = await stopManagedDeviceSyncDaemon({
        vault: vaultRoot,
        dependencies: {
          fetchImpl: async () =>
            new Response(
              JSON.stringify({
                ok: false,
              }),
              { status: 503 },
            ),
          isProcessAlive(pid) {
            return livePids.has(pid)
          },
          async findUnmanagedDeviceSyncDaemonPid() {
            return 6161
          },
          killProcess(pid) {
            signaledPid = pid
            livePids.delete(pid)
            healthy = false
          },
          resolveDeviceSyncPackageEntry() {
            return '/virtual/device-syncd/dist/index.js'
          },
        },
      })

      assert.equal(signaledPid, 6161)
      assert.equal(result.stopped, true)
      assert.equal(result.running, false)
      await assert.rejects(() =>
        readFile(
          path.join(vaultRoot, '.runtime/operations/device-sync/launcher.json'),
          'utf8',
        ),
      )
      await assert.rejects(() =>
        readFile(
          path.join(vaultRoot, '.runtime/operations/device-sync/control-token'),
          'utf8',
        ),
      )
    } finally {
      await rm(vaultRoot, { recursive: true, force: true })
    }
  },
)
