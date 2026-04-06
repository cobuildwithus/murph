import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import { test } from 'vitest'

import {
  ensureManagedDeviceSyncControlPlane,
  getManagedDeviceSyncDaemonStatus,
  startManagedDeviceSyncDaemon,
  stopManagedDeviceSyncDaemon,
} from '@murphai/assistant-core/device-daemon'

interface SpawnProcessInput {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  stdoutPath: string
  stderrPath: string
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
      if (spawned === null) {
        throw new Error('expected spawnProcess to be called')
      }
      const spawnedProcess = spawned as unknown as SpawnProcessInput
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
        spawnedProcess.env.DEVICE_SYNC_SECRET,
        'control-token-for-tests',
      )

      const launcherState = JSON.parse(
        await readFile(
          path.join(vaultRoot, '.runtime/operations/device-sync/launcher.json'),
          'utf8',
        ),
      ) as {
        pid: number
        baseUrl: string
        controlToken?: string
      }
      const persistedControlToken = await readFile(
        path.join(vaultRoot, '.runtime/operations/device-sync/control-token'),
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

      assert.equal(launcherState.pid, 4242)
      assert.equal(launcherState.baseUrl, 'http://localhost:8788')
      assert.equal('controlToken' in launcherState, false)
      assert.equal(persistedControlToken.trim(), 'control-token-for-tests')
      assert.equal(launcherDirectoryStats.mode & 0o777, 0o700)
      assert.equal(launcherStateStats.mode & 0o777, 0o600)
      assert.equal(controlTokenStats.mode & 0o777, 0o600)
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

      if (spawned === null) {
        throw new Error('expected spawnProcess to be called')
      }
      const spawnedProcess = spawned as unknown as SpawnProcessInput
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
      assert.deepEqual(healthCheckAuthorizations, ['Bearer control-token-for-tests'])
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
          killProcess(pid) {
            signaledPid = pid
            livePids.delete(pid)
            healthy = false
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
