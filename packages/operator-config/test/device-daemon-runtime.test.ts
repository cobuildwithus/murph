import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, test, vi } from 'vitest'

import {
  deviceAccountDisconnectResultSchema,
  deviceAccountListResultSchema,
  deviceAccountReconcileResultSchema,
  deviceAccountShowResultSchema,
  deviceConnectResultSchema,
  deviceDaemonStatusResultSchema,
  deviceProviderListResultSchema,
  deviceSyncConnectTargetSchema,
  deviceSyncAccountStatusSchema,
  deviceSyncProviderKeySchema,
  deviceSyncProviderKeyValues,
  formatDeviceSyncProviderKeyList,
  normalizeDeviceSyncConnectTargetKey,
  normalizeDeviceSyncProviderKey,
} from '../src/device-cli-contracts.ts'
import {
  ensureManagedDeviceSyncControlPlane,
  getManagedDeviceSyncDaemonStatus,
  startManagedDeviceSyncDaemon,
  stopManagedDeviceSyncDaemon,
} from '../src/device-daemon.ts'
import {
  defaultSpawnDeviceDaemonProcess,
  defaultIsProcessAlive,
  isDeviceDaemonHealthy,
  isMissingFileError,
  readRecentDeviceDaemonLog,
  waitForDeviceDaemonExit,
  waitForDeviceDaemonHealth,
} from '../src/device-daemon/process.ts'
import {
  buildManagedDeviceSyncEnvironment,
  resolveDeviceDaemonPaths,
  resolveDeviceSyncDaemonBinPath,
  resolveInstalledDeviceSyncPackageEntry,
} from '../src/device-daemon/paths.ts'
import {
  readDeviceDaemonState,
  removeManagedControlToken,
  resolveManagedControlToken,
  resolveManagedEncryptionSecret,
  writeDeviceDaemonState,
  writeManagedEncryptionSecret,
  writeManagedControlToken,
} from '../src/device-daemon/state.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

const tempDirectories = new Set<string>()
const TEST_WHOOP_PROVIDER_ENV = {
  WHOOP_CLIENT_ID: 'whoop-client',
  WHOOP_CLIENT_SECRET: 'whoop-secret',
} as const

function firstLivePid(livePids: Set<number>): number | null {
  const pids = [...livePids]
  return pids.length === 1 ? pids[0] ?? null : null
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.resetModules()
  vi.doUnmock('node:module')
  vi.doUnmock('node:child_process')
  vi.doUnmock('node:fs')
  vi.doUnmock('node:fs/promises')

  for (const directory of tempDirectories) {
    await rm(directory, { force: true, recursive: true })
  }

  tempDirectories.clear()
})

async function createTempVault(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix))
  tempDirectories.add(directory)
  return directory
}

function createFileDependencies() {
  return {
    chmod: async (filePath: string, mode: number) => await chmod(filePath, mode),
    mkdir: async (directoryPath: string) => {
      await mkdir(directoryPath, { recursive: true })
    },
    readFile: async (filePath: string) => await readFile(filePath, 'utf8'),
    removeFile: async (filePath: string) => await rm(filePath, { force: true }),
    writeFile: async (filePath: string, text: string) =>
      await writeFile(filePath, text, 'utf8'),
  }
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

async function importDeviceDaemonProcessWithMocks(setupMocks: () => void) {
  vi.resetModules()
  setupMocks()
  return await import('../src/device-daemon/process.ts')
}

async function importDeviceDaemonPathsWithMockedRequire(
  setupMock: (
    callCount: number,
    actualModule: typeof import('node:module'),
  ) => NodeJS.Require,
): Promise<typeof import('../src/device-daemon/paths.ts')> {
  vi.resetModules()
  vi.doMock('node:module', async () => {
    const actual = await vi.importActual<typeof import('node:module')>('node:module')
    let callCount = 0

    return {
      ...actual,
      createRequire() {
        callCount += 1
        return setupMock(callCount, actual)
      },
    }
  })

  return await import('../src/device-daemon/paths.ts')
}

function createMockRequire(
  actualModule: typeof import('node:module'),
  resolveImpl: (request: string) => string,
): NodeJS.Require {
  const mockRequire = actualModule.createRequire(import.meta.url)
  mockRequire.resolve = createMockResolve(resolveImpl)
  return mockRequire
}

function createMockResolve(resolveImpl: (request: string) => string): NodeJS.RequireResolve {
  function resolve(request: string): string {
    return resolveImpl(request)
  }

  resolve.paths = (_request: string) => []
  return resolve
}

const deviceDaemonChildFixtureArgs = [
  '-e',
  [
    "console.log(process.env.DEVICE_DAEMON_STDOUT_TEXT ?? 'device-daemon-stdout')",
    "console.error(process.env.DEVICE_DAEMON_STDERR_TEXT ?? 'device-daemon-stderr')",
    "console.log(process.env.NODE_V8_COVERAGE ? 'coverage-present' : 'coverage-missing')",
    'setTimeout(() => {',
    '  process.exit(0)',
    '}, 25)',
  ].join('\n'),
] as const

test('device CLI contracts normalize provider keys and parse result payloads', () => {
  const provider = deviceSyncProviderKeyValues[0]

  assert.equal(typeof provider, 'string')
  assert.equal(normalizeDeviceSyncProviderKey(`  ${provider.toUpperCase()}  `), provider)
  assert.equal(normalizeDeviceSyncProviderKey(' unsupported-provider '), null)
  assert.equal(deviceSyncProviderKeySchema.parse(provider.toUpperCase()), provider.toUpperCase())
  assert.throws(
    () => deviceSyncProviderKeySchema.parse('unsupported-provider'),
    /Unsupported device-sync provider/u,
  )
  assert.equal(normalizeDeviceSyncConnectTargetKey('  Fitbit Alta  '), 'fitbit_alta')
  assert.equal(deviceSyncConnectTargetSchema.parse('Fitbit Alta'), 'Fitbit Alta')
  assert.throws(
    () => deviceSyncConnectTargetSchema.parse('junction'),
    /Expected a device connect target/u,
  )
  assert.ok(formatDeviceSyncProviderKeyList().includes(provider))

  const now = '2026-04-23T00:00:00.000Z'
  const baseUrl = 'http://127.0.0.1:4318'
  const providerRecord = {
    provider,
    callbackPath: '/oauth/callback',
    callbackUrl: `${baseUrl}/oauth/callback`,
    webhookPath: '/webhook',
    webhookUrl: `${baseUrl}/webhook`,
    supportsWebhooks: true,
    defaultScopes: ['profile'],
  }
  const account = {
    id: 'account_123',
    provider,
    externalAccountId: 'external_123',
    displayName: null,
    status: 'active',
    scopes: ['profile'],
    accessTokenExpiresAt: null,
    metadata: { source: 'test' },
    connectedAt: now,
    lastWebhookAt: null,
    lastSyncStartedAt: null,
    lastSyncCompletedAt: null,
    lastSyncErrorAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    nextReconcileAt: null,
    createdAt: now,
    updatedAt: now,
  }
  const job = {
    id: 'job_123',
    provider,
    accountId: account.id,
    kind: 'manual-sync',
    payload: { reason: 'test' },
    priority: 0,
    availableAt: now,
    attempts: 0,
    maxAttempts: 3,
    dedupeKey: null,
    status: 'queued',
    leaseOwner: null,
    leaseExpiresAt: null,
    lastErrorCode: null,
    lastErrorMessage: null,
    createdAt: now,
    updatedAt: now,
    startedAt: null,
    finishedAt: null,
  }

  assert.deepEqual(deviceProviderListResultSchema.parse({
    baseUrl,
    providers: [providerRecord],
  }).providers[0], providerRecord)
  assert.deepEqual(deviceProviderListResultSchema.parse({
    local: {
      baseUrl,
      status: 'not_configured',
      configuredProviders: [],
      message: 'Device sync daemon is not running.',
    },
    providers: [
      {
        ...providerRecord,
        source: 'catalog',
        displayName: 'Test provider',
        callbackUrl: null,
        webhookUrl: null,
        localConfigured: false,
      },
    ],
  }).providers[0]?.callbackUrl, null)
  assert.equal(deviceConnectResultSchema.parse({
    status: 'ok',
    kind: 'device_connect_link',
    backend: 'local-daemon',
    baseUrl,
    provider,
    state: 'state_123',
    expiresAt: now,
    authorizationUrl: `${baseUrl}/authorize`,
    openedBrowser: false,
  }).provider, provider)
  assert.equal(deviceAccountListResultSchema.parse({
    baseUrl,
    provider: null,
    accounts: [account],
  }).accounts[0]?.id, account.id)
  assert.deepEqual(deviceAccountListResultSchema.parse({
    baseUrl,
    local: {
      baseUrl,
      status: 'not_running',
      configuredProviders: [provider],
      message: 'Device sync daemon is not running.',
    },
    provider: null,
    accounts: [],
  }).accounts, [])
  assert.equal(deviceAccountShowResultSchema.parse({ baseUrl, account }).account.id, account.id)
  const parsedReconcile = deviceAccountReconcileResultSchema.parse({ baseUrl, account, job })
  assert.equal('job' in parsedReconcile ? parsedReconcile.job.id : null, job.id)
  const parsedDisconnect = deviceAccountDisconnectResultSchema.parse({ baseUrl, account })
  assert.equal('account' in parsedDisconnect ? parsedDisconnect.account.id : null, account.id)
})

test('device-daemon path, env, process, and state helpers stay deterministic', async () => {
  const vault = await createTempVault('operator-config-device-daemon-')
  const paths = resolveDeviceDaemonPaths(vault)

  assert.equal(paths.absoluteVaultRoot, vault)
  assert.equal(path.basename(paths.launcherStatePath), 'launcher.json')
  assert.equal(path.basename(paths.stdoutLogPath), 'stdout.log')
  assert.equal(path.basename(paths.stderrLogPath), 'stderr.log')
  assert.equal(path.basename(paths.stateDbPath), 'state.sqlite')
  assert.equal(
    resolveDeviceSyncDaemonBinPath({
      resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
    }),
    '/opt/device-syncd/dist/bin.js',
  )

  assert.equal(defaultIsProcessAlive(process.pid), true)
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
    if (signal === 0) {
      throw new Error(`missing pid ${pid}`)
    }

    return true
  }) as typeof process.kill)
  assert.equal(defaultIsProcessAlive(999_999), false)
  vi.restoreAllMocks()

  assert.deepEqual(
    buildManagedDeviceSyncEnvironment({
      vault,
      baseUrl: 'http://127.0.0.1:4318/base',
      controlToken: 'generated-token',
      encryptionSecret: 'operator-secret',
      env: {
        DEVICE_SYNC_CONTROL_TOKEN: ' explicit-token ',
        DEVICE_SYNC_HOST: ' localhost ',
        DEVICE_SYNC_PORT: ' 8080 ',
        DEVICE_SYNC_PUBLIC_BASE_URL: ' https://public.example.test/device ',
        DEVICE_SYNC_SECRET: ' operator-secret ',
        DEVICE_SYNC_STATE_DB_PATH: '/custom/device-sync.sqlite',
      },
      paths,
    }),
    {
      DEVICE_SYNC_CONTROL_TOKEN: 'explicit-token',
      DEVICE_SYNC_HOST: 'localhost',
      DEVICE_SYNC_PORT: '8080',
      DEVICE_SYNC_PUBLIC_BASE_URL: 'https://public.example.test/device',
      DEVICE_SYNC_SECRET: 'operator-secret',
      DEVICE_SYNC_STATE_DB_PATH: '/custom/device-sync.sqlite',
      DEVICE_SYNC_VAULT_ROOT: vault,
    },
  )
  assert.deepEqual(
    buildManagedDeviceSyncEnvironment({
      vault,
      baseUrl: 'https://127.0.0.1/device',
      controlToken: 'generated-token',
      encryptionSecret: 'stable-managed-secret',
      env: {},
      paths,
    }),
    {
      DEVICE_SYNC_CONTROL_TOKEN: 'generated-token',
      DEVICE_SYNC_HOST: '127.0.0.1',
      DEVICE_SYNC_PORT: '443',
      DEVICE_SYNC_PUBLIC_BASE_URL: 'https://127.0.0.1/device',
      DEVICE_SYNC_SECRET: 'stable-managed-secret',
      DEVICE_SYNC_STATE_DB_PATH: paths.stateDbPath,
      DEVICE_SYNC_VAULT_ROOT: vault,
    },
  )

  const logPath = path.join(vault, 'daemon.log')
  await writeFile(
    logPath,
    [
      'Authorization: Bearer secret-token-value',
      'Basic abcdefghijklmno',
      'cookie=session-id-123',
      'api_key=abcdef',
      'plain line',
      '',
    ].join('\n'),
    'utf8',
  )
  assert.equal(
    await readRecentDeviceDaemonLog(logPath, createFileDependencies()),
    'Basic [REDACTED] cookie=[REDACTED] api_key=[REDACTED] plain line',
  )
  assert.equal(
    await readRecentDeviceDaemonLog(
      path.join(vault, 'missing.log'),
      createFileDependencies(),
    ),
    null,
  )
  await writeFile(path.join(vault, 'empty.log'), '\n\n', 'utf8')
  assert.equal(
    await readRecentDeviceDaemonLog(
      path.join(vault, 'empty.log'),
      createFileDependencies(),
    ),
    null,
  )
  await assert.rejects(
    () =>
      readRecentDeviceDaemonLog(path.join(vault, 'boom.log'), {
        readFile: async () => {
          throw new Error('boom')
        },
      }),
    /boom/u,
  )

  const healthChecks: Array<{ auth: string | null; href: string }> = []
  let currentMs = 0
  assert.equal(
    await waitForDeviceDaemonHealth(
      'http://127.0.0.1:4318',
      {
        now: () => new Date(currentMs),
        sleep: async (milliseconds) => {
          currentMs += milliseconds
        },
        fetchImpl: async (url, init) => {
          healthChecks.push({
            auth:
              init && 'headers' in init && init.headers && 'Authorization' in init.headers
                ? String(init.headers.Authorization)
                : null,
            href: url instanceof URL ? url.href : String(url),
          })

          return new Response(null, {
            status: healthChecks.length >= 2 ? 200 : 503,
          })
        },
      },
      500,
      'managed-token',
    ),
    true,
  )
  assert.deepEqual(healthChecks, [
    {
      auth: 'Bearer managed-token',
      href: 'http://127.0.0.1:4318/healthz',
    },
    {
      auth: 'Bearer managed-token',
      href: 'http://127.0.0.1:4318/healthz',
    },
  ])
  assert.equal(
    await isDeviceDaemonHealthy(
      'http://127.0.0.1:4318',
      async () => {
        throw new Error('network down')
      },
    ),
    false,
  )
  let timeoutNowMs = 0
  assert.equal(
    await waitForDeviceDaemonHealth(
      'http://127.0.0.1:4318',
      {
        now: () => new Date(timeoutNowMs),
        sleep: async (milliseconds) => {
          timeoutNowMs += milliseconds
        },
        fetchImpl: async () => new Response(null, { status: 503 }),
      },
      150,
    ),
    false,
  )

  let exitChecks = 0
  assert.equal(
    await waitForDeviceDaemonExit(
      4321,
      {
        now: () => new Date(exitChecks * 100),
        sleep: async () => {
          exitChecks += 1
        },
        isProcessAlive: () => exitChecks < 2,
      },
      500,
    ),
    true,
  )
  let timeoutExitChecks = 0
  assert.equal(
    await waitForDeviceDaemonExit(
      4321,
      {
        now: () => new Date(timeoutExitChecks * 100),
        sleep: async () => {
          timeoutExitChecks += 1
        },
        isProcessAlive: () => true,
      },
      150,
    ),
    false,
  )

  const spawnedPaths = {
    stdoutPath: path.join(vault, 'spawn', 'stdout.log'),
    stderrPath: path.join(vault, 'spawn', 'stderr.log'),
  }
  const spawnedChild = await defaultSpawnDeviceDaemonProcess({
    command: process.execPath,
    args: [...deviceDaemonChildFixtureArgs],
    env: {
      DEVICE_DAEMON_STDOUT_TEXT: 'fixture-stdout',
      DEVICE_DAEMON_STDERR_TEXT: 'fixture-stderr',
      NODE_V8_COVERAGE: path.join(vault, 'coverage-should-be-removed'),
    },
    ...spawnedPaths,
  })
  assert.equal(defaultIsProcessAlive(spawnedChild.pid), true)
  let spawnedExitClockMs = Date.now()
  assert.equal(
    await waitForDeviceDaemonExit(
      spawnedChild.pid,
      {
        now: () => new Date(spawnedExitClockMs),
        sleep: async (milliseconds) => {
          await new Promise((resolve) => setTimeout(resolve, milliseconds))
          spawnedExitClockMs += milliseconds
        },
        isProcessAlive: defaultIsProcessAlive,
      },
      2_000,
    ),
    true,
  )
  const [spawnedStdout, spawnedStderr, stdoutStat, stderrStat, logDirStat] =
    await Promise.all([
      readFile(spawnedPaths.stdoutPath, 'utf8'),
      readFile(spawnedPaths.stderrPath, 'utf8'),
      stat(spawnedPaths.stdoutPath),
      stat(spawnedPaths.stderrPath),
      stat(path.dirname(spawnedPaths.stdoutPath)),
    ])
  assert.match(spawnedStdout, /fixture-stdout/u)
  assert.match(spawnedStdout, /coverage-missing/u)
  assert.match(spawnedStderr, /fixture-stderr/u)
  assert.equal(stdoutStat.mode & 0o777, 0o600)
  assert.equal(stderrStat.mode & 0o777, 0o600)
  assert.equal(logDirStat.mode & 0o777, 0o700)

  await writeDeviceDaemonState(
    paths,
    {
      pid: 4321,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
    createFileDependencies(),
  )
  await writeManagedControlToken(paths, 'managed-token', createFileDependencies())

  assert.deepEqual(
    await readDeviceDaemonState(paths, createFileDependencies()),
    {
      pid: 4321,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
  )
  assert.equal(resolveManagedControlToken(paths), 'managed-token')

  await writeFile(paths.launcherStatePath, '{"schema":"bad","value":{}}', 'utf8')
  await assert.rejects(
    () => readDeviceDaemonState(paths, createFileDependencies()),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_STATE_INVALID',
  )
  await assert.rejects(
    () =>
      writeDeviceDaemonState(
        paths,
        {
          pid: 0,
          baseUrl: 'http://127.0.0.1:4318',
          startedAt: '2026-04-08T00:00:00.000Z',
        },
        createFileDependencies(),
      ),
    /positive integer/u,
  )
  await assert.rejects(
    () =>
      writeDeviceDaemonState(
        paths,
        {
          pid: 1,
          baseUrl: '   ',
          startedAt: '2026-04-08T00:00:00.000Z',
        },
        createFileDependencies(),
      ),
    /baseUrl must be a string/u,
  )
  await assert.rejects(
    () =>
      writeDeviceDaemonState(
        paths,
        {
          pid: 1,
          baseUrl: 'http://127.0.0.1:4318',
          startedAt: '   ',
        },
        createFileDependencies(),
      ),
    /startedAt must be a string/u,
  )

  await removeManagedControlToken(paths, createFileDependencies())
  assert.equal(resolveManagedControlToken(paths), null)
  await assert.doesNotReject(() =>
    removeManagedControlToken(paths, {
      removeFile: async () => {
        throw new Error('ignore removal failure')
      },
    }),
  )
  assert.equal(isMissingFileError({ code: 'ENOENT' }), true)
  assert.equal(isMissingFileError(new Error('boom')), false)

  assert.equal(deviceSyncAccountStatusSchema.parse('active'), 'active')
  assert.equal(
    deviceDaemonStatusResultSchema.parse({
      baseUrl: 'http://127.0.0.1:4318',
      statePath: '.runtime/operations/device-sync/launcher-state.json',
      stdoutLogPath: '.runtime/operations/device-sync/stdout.log',
      stderrLogPath: '.runtime/operations/device-sync/stderr.log',
      managed: true,
      running: true,
      healthy: true,
      pid: 4321,
      startedAt: '2026-04-08T00:00:00.000Z',
      message: 'running',
    }).pid,
    4321,
  )
  assert.throws(() =>
    deviceDaemonStatusResultSchema.parse({
      baseUrl: 'http://127.0.0.1:4318',
      statePath: '.runtime/operations/device-sync/launcher-state.json',
      stdoutLogPath: '.runtime/operations/device-sync/stdout.log',
      stderrLogPath: '.runtime/operations/device-sync/stderr.log',
      managed: true,
      running: true,
      healthy: true,
      pid: 0,
      startedAt: '2026-04-08T00:00:00.000Z',
      message: 'invalid',
    }),
  )
})

test('resolveInstalledDeviceSyncPackageEntry falls back only when the bare package request is missing', async () => {
  const primaryModule = await importDeviceDaemonPathsWithMockedRequire((_callCount, actual) =>
    createMockRequire(actual, (request) => {
      assert.equal(request, '@murphai/device-syncd')
      return '/workspace/node_modules/@murphai/device-syncd/dist/index.js'
    }),
  )

  assert.equal(
    primaryModule.resolveInstalledDeviceSyncPackageEntry(),
    '/workspace/node_modules/@murphai/device-syncd/dist/index.js',
  )

  const fallbackModule = await importDeviceDaemonPathsWithMockedRequire((callCount, actual) => {
    if (callCount === 1) {
      return createMockRequire(actual, () => {
        const error = new Error('missing local package') as NodeJS.ErrnoException
        error.code = 'MODULE_NOT_FOUND'
        error.message = "Cannot find module '@murphai/device-syncd'"
        throw error
      })
    }

    return createMockRequire(actual, () => '/repo-root/node_modules/@murphai/device-syncd/dist/index.js')
  })

  assert.equal(
    fallbackModule.resolveInstalledDeviceSyncPackageEntry(),
    '/repo-root/node_modules/@murphai/device-syncd/dist/index.js',
  )

  const rethrowModule = await importDeviceDaemonPathsWithMockedRequire((callCount, actual) => {
    if (callCount === 1) {
      return createMockRequire(actual, () => {
        const error = new Error('permission denied') as NodeJS.ErrnoException
        error.code = 'EACCES'
        throw error
      })
    }

    return createMockRequire(actual, () => '/repo-root/node_modules/@murphai/device-syncd/dist/index.js')
  })

  assert.throws(
    () => rethrowModule.resolveInstalledDeviceSyncPackageEntry(),
    (error: unknown) => {
      assert.equal(typeof error, 'object')
      assert.notEqual(error, null)
      assert.equal((error as NodeJS.ErrnoException).code, 'EACCES')
      return true
    },
  )

  const brokenEntrypointModule = await importDeviceDaemonPathsWithMockedRequire((callCount, actual) => {
    if (callCount === 1) {
      return createMockRequire(actual, () => {
        const error = new Error(
          "Cannot find module '/tmp/node_modules/@murphai/device-syncd/dist/index.js'. Please verify that the package.json has a valid \"main\" entry",
        ) as NodeJS.ErrnoException
        error.code = 'MODULE_NOT_FOUND'
        throw error
      })
    }

    return createMockRequire(actual, () => '/repo-root/node_modules/@murphai/device-syncd/dist/index.js')
  })

  assert.throws(
    () => brokenEntrypointModule.resolveInstalledDeviceSyncPackageEntry(),
    (error: unknown) => {
      assert.equal(typeof error, 'object')
      assert.notEqual(error, null)
      assert.equal((error as NodeJS.ErrnoException).code, 'MODULE_NOT_FOUND')
      assert.match(String((error as Error).message), /valid "main" entry/u)
      return true
    },
  )
})

test('resolveInstalledDeviceSyncPackageEntry does not require a valid file-url base at module load', async () => {
  const module = await importDeviceDaemonPathsWithMockedRequire((callCount, actual) => {
    if (callCount === 1) {
      throw new TypeError(
        "The argument 'path' The argument must be a file URL object, a file URL string, or an absolute path string.. Received 'undefined'",
      )
    }

    return createMockRequire(
      actual,
      () => '/workspace/node_modules/@murphai/device-syncd/dist/index.js',
    )
  })

  assert.equal(
    module.resolveInstalledDeviceSyncPackageEntry(),
    '/workspace/node_modules/@murphai/device-syncd/dist/index.js',
  )
})

test('managed device-daemon lifecycle helpers cover explicit, status, start, and stop branches', async () => {
  const explicit = await ensureManagedDeviceSyncControlPlane({
    baseUrl: 'http://127.0.0.1:4318',
    env: {
      DEVICE_SYNC_CONTROL_TOKEN: ' explicit-token ',
    },
  })
  assert.deepEqual(explicit, {
    baseUrl: 'http://127.0.0.1:4318',
    controlToken: 'explicit-token',
    managed: false,
    started: false,
  })

  await assert.rejects(
    () => ensureManagedDeviceSyncControlPlane({}),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_VAULT_REQUIRED',
  )

  const staleVault = await createTempVault('operator-config-device-daemon-stale-')
  const stalePaths = resolveDeviceDaemonPaths(staleVault)
  await writeDeviceDaemonState(
    stalePaths,
    {
      pid: 7654,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
    createFileDependencies(),
  )
  await writeManagedControlToken(stalePaths, 'managed-token', createFileDependencies())

  const staleStatus = await getManagedDeviceSyncDaemonStatus({
    vault: staleVault,
    baseUrl: 'http://127.0.0.1:4318',
    dependencies: {
      fetchImpl: async () => new Response(null, { status: 503 }),
      isProcessAlive: () => false,
    },
  })
  assert.equal(staleStatus.managed, true)
  assert.equal(staleStatus.running, false)
  assert.equal(staleStatus.healthy, false)
  assert.equal(
    staleStatus.message,
    'Stale device-sync daemon state found; recorded PID is no longer running.',
  )

  const healthyVault = await createTempVault('operator-config-device-daemon-healthy-')
  const healthyPaths = resolveDeviceDaemonPaths(healthyVault)
  await writeDeviceDaemonState(
    healthyPaths,
    {
      pid: 8123,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
    createFileDependencies(),
  )
  await writeManagedControlToken(healthyPaths, 'managed-token', createFileDependencies())

  const alreadyManaged = await startManagedDeviceSyncDaemon({
    vault: healthyVault,
    baseUrl: 'http://127.0.0.1:4318',
    dependencies: {
      fetchImpl: async (_input, init) =>
        new Response(null, {
          ...deviceSyncAuthResponse(
            new Headers(init?.headers).get('Authorization') === 'Bearer managed-token'
              ? 200
              : 401,
          ),
        }),
      isProcessAlive: () => true,
      now: () => new Date('2026-04-08T00:00:00.000Z'),
    },
  })
  assert.equal(alreadyManaged.started, false)
  assert.equal(alreadyManaged.managed, true)
  assert.equal(
    alreadyManaged.message,
    'Murph is already managing the local device sync daemon.',
  )

  await removeManagedControlToken(healthyPaths, createFileDependencies())
  let missingManagedTokenFetchCalls = 0
  let missingManagedTokenError: Error | null = null
  try {
    await startManagedDeviceSyncDaemon({
      vault: healthyVault,
      baseUrl: 'http://127.0.0.1:4318',
      dependencies: {
        fetchImpl: async () => {
          missingManagedTokenFetchCalls += 1
          throw new Error('fetchImpl should not be called')
        },
        isProcessAlive: () => true,
        now: () => new Date('2026-04-08T00:00:00.000Z'),
        spawnProcess: async () => {
          throw new Error('spawnProcess should not be called')
        },
      },
    })
  } catch (error) {
    missingManagedTokenError = error instanceof Error ? error : new Error(String(error))
  }
  assert.notEqual(missingManagedTokenError, null)
  assert.match(
    missingManagedTokenError?.message ?? '',
    /tracked device sync daemon process is still running/u,
  )
  assert.match(
    missingManagedTokenError?.message ?? '',
    /Stop it with `murph device daemon stop --vault <path>` or retry with `DEVICE_SYNC_PORT=<free-port>`\./u,
  )
  assert.doesNotMatch(missingManagedTokenError?.message ?? '', /DEVICE_SYNC_CONTROL_TOKEN/u)
  assert.equal(missingManagedTokenFetchCalls, 0)
  await writeManagedControlToken(healthyPaths, 'managed-token', createFileDependencies())

  await rm(healthyPaths.launcherStatePath, { force: true })
  const missingLauncherAuthorizations: Array<string | null> = []
  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: healthyVault,
        baseUrl: 'http://127.0.0.1:4318',
        dependencies: {
          fetchImpl: async (_input, init) => {
            missingLauncherAuthorizations.push(
              new Headers(init?.headers).get('Authorization'),
            )
            return new Response(null, deviceSyncAuthResponse(401))
          },
          isProcessAlive: () => false,
          now: () => new Date('2026-04-08T00:00:00.000Z'),
          spawnProcess: async () => {
            throw new Error('spawnProcess should not be called')
          },
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_DAEMON_CONFLICT' &&
      /this vault is not managing it/u.test(error.message) &&
      /lsof -nP -iTCP:4318 -sTCP:LISTEN/u.test(error.message),
  )
  assert.deepEqual(missingLauncherAuthorizations, [null])
  await writeDeviceDaemonState(
    healthyPaths,
    {
      pid: 8123,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
    createFileDependencies(),
  )

  const orphanVault = await createTempVault('operator-config-device-daemon-orphan-')
  let orphanAlive = true
  let freshDaemonSpawned = false
  let killedOrphanPid: number | null = null
  const recoveryChecks: Array<{
    baseUrl: string
    expectedBinPath: string
    port: string | null
  }> = []
  const recoveryAuthorizations: Array<string | null> = []
  const recovered = await startManagedDeviceSyncDaemon({
    vault: orphanVault,
    env: {
      DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
      ...TEST_WHOOP_PROVIDER_ENV,
    },
    dependencies: {
      fetchImpl: async (_input, init) => {
        const authorization = new Headers(init?.headers).get('Authorization')
        recoveryAuthorizations.push(authorization)
        if (!freshDaemonSpawned) {
          return new Response(null, deviceSyncAuthResponse(401))
        }
        return new Response(
          null,
          deviceSyncAuthResponse(
            authorization === 'Bearer control-token-for-tests' ? 200 : 401,
          ),
        )
      },
      findUnmanagedDeviceSyncDaemonPid: async (input) => {
        recoveryChecks.push(input)
        return 7777
      },
      isProcessAlive: (pid) => (pid === 7777 ? orphanAlive : pid === 8181),
      killProcess: (pid) => {
        killedOrphanPid = pid
        orphanAlive = false
      },
      now: () => new Date('2026-04-08T00:00:00.000Z'),
      resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
      spawnProcess: async () => {
        freshDaemonSpawned = true
        return { pid: 8181 }
      },
    },
  })
  assert.equal(recovered.started, true)
  assert.equal(recovered.pid, 8181)
  assert.equal(
    recovered.message,
    'Murph stopped an orphaned local device sync daemon and started a fresh managed daemon.',
  )
  assert.deepEqual(recoveryChecks, [
    {
      baseUrl: 'http://localhost:8788',
      expectedBinPath: '/opt/device-syncd/dist/bin.js',
      port: '8788',
    },
  ])
  assert.equal(killedOrphanPid, 7777)
  assert.deepEqual(recoveryAuthorizations, [
    null,
    'Bearer control-token-for-tests',
  ])

  const unknownListenerVault = await createTempVault('operator-config-device-daemon-unknown-listener-')
  let unknownListenerKillAttempted = false
  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: unknownListenerVault,
        env: TEST_WHOOP_PROVIDER_ENV,
        dependencies: {
          fetchImpl: async () => new Response(null, deviceSyncAuthResponse(401)),
          findUnmanagedDeviceSyncDaemonPid: async () => null,
          isProcessAlive: () => true,
          killProcess: () => {
            unknownListenerKillAttempted = true
          },
          now: () => new Date('2026-04-08T00:00:00.000Z'),
          spawnProcess: async () => {
            throw new Error('spawnProcess should not be called')
          },
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_DAEMON_CONFLICT' &&
      /this vault is not managing it/u.test(error.message) &&
      /lsof -nP -iTCP:8788 -sTCP:LISTEN/u.test(error.message),
  )
  assert.equal(unknownListenerKillAttempted, false)

  const missingConfigOrphanVault = await createTempVault('operator-config-device-daemon-missing-config-orphan-')
  let missingConfigKillAttempted = false
  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: missingConfigOrphanVault,
        dependencies: {
          fetchImpl: async () => new Response(null, deviceSyncAuthResponse(401)),
          findUnmanagedDeviceSyncDaemonPid: async () => 7777,
          isProcessAlive: () => true,
          killProcess: () => {
            missingConfigKillAttempted = true
          },
          now: () => new Date('2026-04-08T00:00:00.000Z'),
          spawnProcess: async () => {
            throw new Error('spawnProcess should not be called')
          },
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_DAEMON_CONFLICT' &&
      /this vault is not managing it/u.test(error.message),
  )
  assert.equal(missingConfigKillAttempted, false)

  const unresolvedBinVault = await createTempVault('operator-config-device-daemon-unresolved-bin-')
  let unresolvedBinFindAttempted = false
  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: unresolvedBinVault,
        env: TEST_WHOOP_PROVIDER_ENV,
        dependencies: {
          fetchImpl: async () => new Response(null, deviceSyncAuthResponse(401)),
          findUnmanagedDeviceSyncDaemonPid: async () => {
            unresolvedBinFindAttempted = true
            return 7777
          },
          isProcessAlive: () => true,
          now: () => new Date('2026-04-08T00:00:00.000Z'),
          resolveDeviceSyncPackageEntry: () => {
            throw new Error('package missing')
          },
          spawnProcess: async () => {
            throw new Error('spawnProcess should not be called')
          },
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_DAEMON_CONFLICT' &&
      /this vault is not managing it/u.test(error.message),
  )
  assert.equal(unresolvedBinFindAttempted, false)

  const conflictVault = await createTempVault('operator-config-device-daemon-conflict-')
  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: conflictVault,
        dependencies: {
          fetchImpl: async () => new Response(null, { status: 200 }),
          isProcessAlive: () => false,
          now: () => new Date('2026-04-08T00:00:00.000Z'),
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_DAEMON_CONFLICT',
  )

  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: conflictVault,
        dependencies: {
          fetchImpl: async () => new Response(null, deviceSyncAuthResponse(401)),
          isProcessAlive: () => false,
          now: () => new Date('2026-04-08T00:00:00.000Z'),
          spawnProcess: async () => {
            throw new Error('spawnProcess should not be called')
          },
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_DAEMON_CONFLICT' &&
      /this vault is not managing it/u.test(error.message) &&
      /lsof -nP -iTCP:8788 -sTCP:LISTEN/u.test(error.message),
  )

  let missingProviderSpawned = false
  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: conflictVault,
        env: {
          DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
        },
        dependencies: {
          fetchImpl: async () => new Response(null, { status: 503 }),
          isProcessAlive: () => false,
          now: () => new Date('2026-04-08T00:00:00.000Z'),
          spawnProcess: async () => {
            missingProviderSpawned = true
            throw new Error('spawnProcess should not be called')
          },
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_PROVIDER_CONFIG_REQUIRED' &&
      /No local device sync provider credentials are configured/u.test(error.message) &&
      /WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET/u.test(error.message),
  )
  assert.equal(missingProviderSpawned, false)

  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: conflictVault,
        baseUrl: 'https://remote.example.test',
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_REMOTE_BASE_URL_UNSUPPORTED',
  )

  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: healthyVault,
        baseUrl: 'http://127.0.0.1:4318',
        dependencies: {
          fetchImpl: async () => new Response(null, { status: 503 }),
          isProcessAlive: () => true,
          now: () => new Date('2026-04-08T00:00:00.000Z'),
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_DAEMON_UNHEALTHY',
  )

  const managedVault = await createTempVault('operator-config-device-daemon-managed-')
  const managedPid = 9001
  const livePids = new Set<number>()
  let healthAttempt = 0
  let spawnedVaultRoot: string | undefined

  const started = await startManagedDeviceSyncDaemon({
    vault: managedVault,
    env: TEST_WHOOP_PROVIDER_ENV,
    dependencies: {
      now: () => new Date('2026-04-08T00:00:00.000Z'),
      sleep: async () => undefined,
      fetchImpl: async () => {
        healthAttempt += 1
        return new Response(null, {
          status: healthAttempt >= 3 ? 200 : 503,
        })
      },
      isProcessAlive: (pid) => livePids.has(pid),
      killProcess: (pid) => {
        livePids.delete(pid)
      },
      spawnProcess: async (input) => {
        spawnedVaultRoot = input.env.DEVICE_SYNC_VAULT_ROOT
        livePids.add(managedPid)
        return { pid: managedPid }
      },
      resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
    },
  })

  assert.equal(started.started, true)
  assert.equal(started.managed, true)
  assert.equal(started.pid, managedPid)
  assert.match(resolveManagedControlToken(resolveDeviceDaemonPaths(managedVault)) ?? '', /^[a-f0-9]{48}$/u)
  assert.equal(spawnedVaultRoot, managedVault)

  const ensuredManaged = await ensureManagedDeviceSyncControlPlane({
    vault: managedVault,
    dependencies: {
      now: () => new Date('2026-04-08T00:00:00.000Z'),
      sleep: async () => undefined,
      fetchImpl: async (_input, init) =>
        new Response(null, {
          ...deviceSyncAuthResponse(
            new Headers(init?.headers).get('Authorization') ===
              `Bearer ${resolveManagedControlToken(resolveDeviceDaemonPaths(managedVault))}`
              ? 200
              : 401,
          ),
        }),
      isProcessAlive: (pid) => livePids.has(pid),
    },
  })
  assert.equal(ensuredManaged.managed, true)
  assert.equal(ensuredManaged.started, false)
  assert.equal(ensuredManaged.controlToken !== null, true)

  const stopped = await stopManagedDeviceSyncDaemon({
    vault: managedVault,
    dependencies: {
      now: () => new Date('2026-04-08T00:00:00.000Z'),
      sleep: async () => undefined,
      isProcessAlive: (pid) => livePids.has(pid),
      killProcess: (pid) => {
        livePids.delete(pid)
      },
      findUnmanagedDeviceSyncDaemonPid: async () => managedPid,
      resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
    },
  })
  assert.equal(stopped.stopped, true)
  assert.equal(stopped.running, false)
  assert.equal(resolveManagedControlToken(resolveDeviceDaemonPaths(managedVault)), null)
  assert.equal(await readDeviceDaemonState(resolveDeviceDaemonPaths(managedVault), createFileDependencies()), null)

  const unmanagedStatusAuthorizations: Array<string | null> = []
  const unmanagedStatus = await getManagedDeviceSyncDaemonStatus({
    vault: staleVault,
    baseUrl: 'http://127.0.0.1:4318',
    dependencies: {
      fetchImpl: async (_input, init) => {
        const authorization = new Headers(init?.headers).get('Authorization')
        unmanagedStatusAuthorizations.push(authorization)
        return new Response(null, {
          ...deviceSyncAuthResponse(authorization === 'Bearer managed-token' ? 200 : 401),
        })
      },
      isProcessAlive: () => false,
    },
  })
  assert.equal(unmanagedStatus.managed, true)
  assert.equal(unmanagedStatus.healthy, false)
  assert.deepEqual(unmanagedStatusAuthorizations, [null])

  const nonDeviceSyncStatusAuthorizations: Array<string | null> = []
  const reachableButUnmanaged = await getManagedDeviceSyncDaemonStatus({
    vault: staleVault,
    baseUrl: 'http://127.0.0.1:9999',
    dependencies: {
      fetchImpl: async (_input, init) => {
        nonDeviceSyncStatusAuthorizations.push(
          new Headers(init?.headers).get('Authorization'),
        )
        return new Response(null, { status: 401 })
      },
      isProcessAlive: () => false,
    },
  })
  assert.equal(reachableButUnmanaged.managed, false)
  assert.equal(
    reachableButUnmanaged.message,
    'Device sync control plane is reachable at the target base URL, but it is not managed by this Murph vault.',
  )
  assert.deepEqual(nonDeviceSyncStatusAuthorizations, [null])

  const explicitManagedReuse = await ensureManagedDeviceSyncControlPlane({
    vault: managedVault,
    env: {
      DEVICE_SYNC_CONTROL_TOKEN: 'explicit-token',
      DEVICE_SYNC_BASE_URL: 'http://127.0.0.1:8788',
    },
  })
  assert.deepEqual(explicitManagedReuse, {
    baseUrl: 'http://127.0.0.1:8788',
    controlToken: 'explicit-token',
    managed: false,
    started: false,
  })
})

test('managed device-sync daemon keeps encryption secret stable across stop and restart', async () => {
  const vault = await createTempVault('operator-config-device-daemon-secret-')
  const paths = resolveDeviceDaemonPaths(vault)
  const livePids = new Set<number>()
  const spawnedEnvironments: NodeJS.ProcessEnv[] = []
  let nextPid = 9500

  const dependencies = {
    now: () => new Date('2026-04-08T00:00:00.000Z'),
    sleep: async () => undefined,
    fetchImpl: async () =>
      new Response(null, {
        status: livePids.size > 0 ? 200 : 503,
      }),
    isProcessAlive: (pid: number) => livePids.has(pid),
    killProcess: (pid: number) => {
      livePids.delete(pid)
    },
    findUnmanagedDeviceSyncDaemonPid: async () => {
      return firstLivePid(livePids)
    },
    resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
    spawnProcess: async (input: { env: NodeJS.ProcessEnv }) => {
      spawnedEnvironments.push(input.env)
      const pid = nextPid
      nextPid += 1
      livePids.add(pid)
      return { pid }
    },
  }

  await startManagedDeviceSyncDaemon({
    vault,
    env: TEST_WHOOP_PROVIDER_ENV,
    dependencies,
  })
  const firstControlToken = resolveManagedControlToken(paths)
  const firstEncryptionSecret = resolveManagedEncryptionSecret(paths)
  assert.match(firstControlToken ?? '', /^[a-f0-9]{48}$/u)
  assert.match(firstEncryptionSecret ?? '', /^[a-f0-9]{64}$/u)
  assert.equal(spawnedEnvironments[0]?.DEVICE_SYNC_CONTROL_TOKEN, firstControlToken)
  assert.equal(spawnedEnvironments[0]?.DEVICE_SYNC_SECRET, firstEncryptionSecret)

  await stopManagedDeviceSyncDaemon({
    vault,
    dependencies,
  })
  assert.equal(resolveManagedControlToken(paths), null)
  assert.equal(resolveManagedEncryptionSecret(paths), firstEncryptionSecret)

  await startManagedDeviceSyncDaemon({
    vault,
    env: TEST_WHOOP_PROVIDER_ENV,
    dependencies,
  })
  const secondControlToken = resolveManagedControlToken(paths)
  assert.match(secondControlToken ?? '', /^[a-f0-9]{48}$/u)
  assert.notEqual(secondControlToken, firstControlToken)
  assert.equal(resolveManagedEncryptionSecret(paths), firstEncryptionSecret)
  assert.equal(spawnedEnvironments[1]?.DEVICE_SYNC_CONTROL_TOKEN, secondControlToken)
  assert.equal(spawnedEnvironments[1]?.DEVICE_SYNC_SECRET, firstEncryptionSecret)

  livePids.clear()
  await startManagedDeviceSyncDaemon({
    vault,
    env: TEST_WHOOP_PROVIDER_ENV,
    dependencies,
  })
  const crashRestartControlToken = resolveManagedControlToken(paths)
  assert.match(crashRestartControlToken ?? '', /^[a-f0-9]{48}$/u)
  assert.notEqual(crashRestartControlToken, secondControlToken)
  assert.equal(resolveManagedEncryptionSecret(paths), firstEncryptionSecret)
  assert.equal(spawnedEnvironments[2]?.DEVICE_SYNC_CONTROL_TOKEN, crashRestartControlToken)
  assert.equal(spawnedEnvironments[2]?.DEVICE_SYNC_SECRET, firstEncryptionSecret)
})

test('managed device-sync encryption secret fails closed on invalid existing state', async () => {
  const permissionVault = await createTempVault('operator-config-device-daemon-secret-perms-')
  const permissionPaths = resolveDeviceDaemonPaths(permissionVault)
  await writeManagedEncryptionSecret(
    permissionPaths,
    'stable-secret-for-tests',
    createFileDependencies(),
  )
  await chmod(path.dirname(permissionPaths.launcherStatePath), 0o777)
  await chmod(
    path.join(path.dirname(permissionPaths.launcherStatePath), 'encryption-secret'),
    0o644,
  )

  assert.equal(resolveManagedEncryptionSecret(permissionPaths), 'stable-secret-for-tests')
  assert.equal(
    (await stat(path.dirname(permissionPaths.launcherStatePath))).mode & 0o777,
    0o700,
  )
  assert.equal(
    (await stat(path.join(path.dirname(permissionPaths.launcherStatePath), 'encryption-secret'))).mode & 0o777,
    0o600,
  )

  const symlinkVault = await createTempVault('operator-config-device-daemon-secret-symlink-')
  const symlinkPaths = resolveDeviceDaemonPaths(symlinkVault)
  const symlinkDirectory = path.dirname(symlinkPaths.launcherStatePath)
  await mkdir(symlinkDirectory, { recursive: true })
  await writeFile(path.join(symlinkDirectory, 'target-secret'), 'stable-secret-for-tests\n', 'utf8')
  await symlink(
    path.join(symlinkDirectory, 'target-secret'),
    path.join(symlinkDirectory, 'encryption-secret'),
  )

  assert.throws(
    () => resolveManagedEncryptionSecret(symlinkPaths),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_SECRET_INVALID' &&
      /encryption secret file is invalid/u.test(error.message),
  )

  const emptyVault = await createTempVault('operator-config-device-daemon-secret-empty-')
  const emptyPaths = resolveDeviceDaemonPaths(emptyVault)
  await writeManagedEncryptionSecret(emptyPaths, '', createFileDependencies())

  assert.throws(
    () => resolveManagedEncryptionSecret(emptyPaths),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_SECRET_INVALID' &&
      /encryption secret is empty/u.test(error.message),
  )
})

test('device-daemon lifecycle handles startup cleanup and stop edge cases deterministically', async () => {
  const startFailureVault = await createTempVault('operator-config-device-daemon-start-failure-')
  const startFailurePaths = resolveDeviceDaemonPaths(startFailureVault)
  let startFailureNowMs = 0
  await mkdir(path.dirname(startFailurePaths.stderrLogPath), { recursive: true })
  await writeFile(
    startFailurePaths.stderrLogPath,
    'Authorization: Bearer start-token\nagent token=plain-secret\n',
    'utf8',
  )
  const killedPids: string[] = []
  const removedFiles: string[] = []

  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: startFailureVault,
        baseUrl: 'http://127.0.0.1:4318',
        env: TEST_WHOOP_PROVIDER_ENV,
        dependencies: {
          now: () => new Date(startFailureNowMs),
          sleep: async () => {
            startFailureNowMs += 100
          },
          fetchImpl: async () => new Response(null, { status: 503 }),
          isProcessAlive: () => true,
          killProcess: (pid, signal) => {
            killedPids.push(`${pid}:${String(signal)}`)
          },
          removeFile: async (filePath) => {
            removedFiles.push(filePath)
            await rm(filePath, { force: true })
          },
          resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
          spawnProcess: async () => ({ pid: 9100 }),
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_DAEMON_START_FAILED' &&
      error.message.includes('[REDACTED]') &&
      error.context?.pid === 9100,
  )
  assert.deepEqual(killedPids, ['9100:SIGTERM', '9100:SIGKILL'])
  assert.equal(removedFiles.includes(startFailurePaths.launcherStatePath), true)
  assert.equal(resolveManagedControlToken(startFailurePaths), null)

  const missingProviderLogVault = await createTempVault('operator-config-device-daemon-provider-log-')
  const missingProviderLogPaths = resolveDeviceDaemonPaths(missingProviderLogVault)
  let missingProviderLogNowMs = 0
  await mkdir(path.dirname(missingProviderLogPaths.stderrLogPath), { recursive: true })
  await writeFile(
    missingProviderLogPaths.stderrLogPath,
    'TypeError: No device sync providers are configured. Set at least one supported device provider client credential pair before starting device-syncd.\n',
    'utf8',
  )

  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: missingProviderLogVault,
        baseUrl: 'http://127.0.0.1:4318',
        env: {
          DEVICE_SYNC_CONTROL_TOKEN: 'control-token-for-tests',
          WHOOP_CLIENT_ID: 'whoop-client',
          WHOOP_CLIENT_SECRET: 'whoop-secret',
        },
        dependencies: {
          now: () => new Date(missingProviderLogNowMs),
          sleep: async () => {
            missingProviderLogNowMs += 100
          },
          fetchImpl: async () => new Response(null, { status: 503 }),
          isProcessAlive: () => true,
          killProcess: () => undefined,
          resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
          spawnProcess: async () => ({ pid: 9102 }),
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_PROVIDER_CONFIG_REQUIRED' &&
      !/Murph could not start/u.test(error.message) &&
      error.context?.pid === 9102,
  )

  const addressConflictVault = await createTempVault('operator-config-device-daemon-address-conflict-')
  const addressConflictPaths = resolveDeviceDaemonPaths(addressConflictVault)
  let addressConflictNowMs = 0
  await mkdir(path.dirname(addressConflictPaths.stderrLogPath), { recursive: true })
  await writeFile(
    addressConflictPaths.stderrLogPath,
    'Error: listen EADDRINUSE: address already in use 127.0.0.1:8788\n',
    'utf8',
  )

  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: addressConflictVault,
        baseUrl: 'http://127.0.0.1:4318',
        env: TEST_WHOOP_PROVIDER_ENV,
        dependencies: {
          now: () => new Date(addressConflictNowMs),
          sleep: async () => {
            addressConflictNowMs += 100
          },
          fetchImpl: async () => new Response(null, { status: 503 }),
          isProcessAlive: () => true,
          killProcess: () => undefined,
          resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
          spawnProcess: async () => ({ pid: 9200 }),
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_DAEMON_CONFLICT' &&
      /already listening at http:\/\/127.0.0.1:4318/u.test(error.message) &&
      /lsof -nP -iTCP:4318 -sTCP:LISTEN/u.test(error.message),
  )

  const writeFailureVault = await createTempVault('operator-config-device-daemon-write-failure-')
  const writeFailurePaths = resolveDeviceDaemonPaths(writeFailureVault)
  const writeFailureKills: string[] = []
  const writeFailureRemovals: string[] = []
  let writeFailureNowMs = 0

  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: writeFailureVault,
        baseUrl: 'http://127.0.0.1:4318',
        env: TEST_WHOOP_PROVIDER_ENV,
        dependencies: {
          chmod: async () => undefined,
          mkdir: async () => undefined,
          now: () => new Date(writeFailureNowMs),
          sleep: async () => {
            writeFailureNowMs += 100
          },
          fetchImpl: async () => new Response(null, { status: 503 }),
          isProcessAlive: () => true,
          killProcess: (pid, signal) => {
            writeFailureKills.push(`${pid}:${String(signal)}`)
          },
          removeFile: async (filePath) => {
            writeFailureRemovals.push(filePath)
          },
          resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
          spawnProcess: async () => ({ pid: 9101 }),
          writeFile: async (_filePath, text) => {
            if (text.includes('"schema"')) {
              throw new Error('cannot persist state')
            }
          },
        },
      }),
    /cannot persist state/u,
  )
  assert.deepEqual(writeFailureKills, ['9101:SIGTERM', '9101:SIGKILL'])
  assert.deepEqual(writeFailureRemovals, [
    writeFailurePaths.launcherStatePath,
    path.join(path.dirname(writeFailurePaths.launcherStatePath), 'control-token'),
  ])

  const exitRaceVault = await createTempVault('operator-config-device-daemon-exit-race-')
  const exitRacePaths = resolveDeviceDaemonPaths(exitRaceVault)
  const exitRaceRemovals: string[] = []

  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: exitRaceVault,
        baseUrl: 'http://127.0.0.1:4318',
        env: TEST_WHOOP_PROVIDER_ENV,
        dependencies: {
          chmod: async () => undefined,
          mkdir: async () => undefined,
          now: () => new Date('2026-04-08T00:00:00.000Z'),
          fetchImpl: async () => new Response(null, { status: 503 }),
          isProcessAlive: () => true,
          killProcess: () => {
            throw Object.assign(new Error('already exited'), { code: 'ESRCH' })
          },
          removeFile: async (filePath) => {
            exitRaceRemovals.push(filePath)
          },
          resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
          spawnProcess: async () => ({ pid: 9103 }),
          writeFile: async (_filePath, text) => {
            if (text.includes('"schema"')) {
              throw new Error('cannot persist state after exit race')
            }
          },
        },
      }),
    /cannot persist state after exit race/u,
  )
  assert.deepEqual(exitRaceRemovals, [
    exitRacePaths.launcherStatePath,
    path.join(path.dirname(exitRacePaths.launcherStatePath), 'control-token'),
  ])

  const staleStopVault = await createTempVault('operator-config-device-daemon-stop-stale-')
  const staleStopPaths = resolveDeviceDaemonPaths(staleStopVault)
  await writeDeviceDaemonState(
    staleStopPaths,
    {
      pid: 9200,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
    createFileDependencies(),
  )
  await writeManagedControlToken(staleStopPaths, 'managed-token', createFileDependencies())

  const staleStopResult = await stopManagedDeviceSyncDaemon({
    vault: staleStopVault,
    baseUrl: 'http://127.0.0.1:4318',
    dependencies: {
      isProcessAlive: () => false,
    },
  })
  assert.equal(staleStopResult.stopped, true)
  assert.equal(staleStopResult.managed, false)
  assert.match(staleStopResult.message ?? '', /Removed stale device sync daemon launcher state/u)

  const mismatchedStopVault = await createTempVault('operator-config-device-daemon-stop-mismatched-')
  const mismatchedStopPaths = resolveDeviceDaemonPaths(mismatchedStopVault)
  await writeDeviceDaemonState(
    mismatchedStopPaths,
    {
      pid: 9401,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
    createFileDependencies(),
  )
  await writeManagedControlToken(mismatchedStopPaths, 'managed-token', createFileDependencies())
  const mismatchedKilledPids: number[] = []

  await assert.rejects(
    () =>
      stopManagedDeviceSyncDaemon({
        vault: mismatchedStopVault,
        baseUrl: 'http://127.0.0.1:4318',
        dependencies: {
          isProcessAlive: () => true,
          killProcess: (pid) => {
            mismatchedKilledPids.push(pid)
          },
          findUnmanagedDeviceSyncDaemonPid: async () => 9402,
          resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_DAEMON_IDENTITY_UNVERIFIED',
  )
  assert.deepEqual(mismatchedKilledPids, [])
  assert.deepEqual(
    await readDeviceDaemonState(mismatchedStopPaths, createFileDependencies()),
    {
      pid: 9401,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
  )

  const stopExitRaceVault = await createTempVault('operator-config-device-daemon-stop-exit-race-')
  const stopExitRacePaths = resolveDeviceDaemonPaths(stopExitRaceVault)
  await writeDeviceDaemonState(
    stopExitRacePaths,
    {
      pid: 9403,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
    createFileDependencies(),
  )
  await writeManagedControlToken(stopExitRacePaths, 'managed-token', createFileDependencies())

  const stopExitRaceResult = await stopManagedDeviceSyncDaemon({
    vault: stopExitRaceVault,
    baseUrl: 'http://127.0.0.1:4318',
    dependencies: {
      isProcessAlive: () => true,
      killProcess: () => {
        throw Object.assign(new Error('already exited'), { code: 'ESRCH' })
      },
      findUnmanagedDeviceSyncDaemonPid: async () => 9403,
      resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
    },
  })
  assert.equal(stopExitRaceResult.stopped, true)
  assert.equal(
    await readDeviceDaemonState(stopExitRacePaths, createFileDependencies()),
    null,
  )
  assert.equal(resolveManagedControlToken(stopExitRacePaths), null)

  await assert.rejects(
    () =>
      stopManagedDeviceSyncDaemon({
        vault: staleStopVault,
        baseUrl: 'http://127.0.0.1:9999',
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_NOT_RUNNING',
  )

  const timeoutVault = await createTempVault('operator-config-device-daemon-stop-timeout-')
  const timeoutPaths = resolveDeviceDaemonPaths(timeoutVault)
  await writeDeviceDaemonState(
    timeoutPaths,
    {
      pid: 9300,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
    createFileDependencies(),
  )
  let timeoutClockMs = 0

  await assert.rejects(
    () =>
      stopManagedDeviceSyncDaemon({
        vault: timeoutVault,
        baseUrl: 'http://127.0.0.1:4318',
        dependencies: {
          now: () => new Date(timeoutClockMs),
          sleep: async () => {
            timeoutClockMs += 100
          },
          isProcessAlive: () => true,
          killProcess: () => undefined,
          findUnmanagedDeviceSyncDaemonPid: async () => 9300,
          resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_STOP_TIMEOUT',
  )
})

test('device-daemon management also covers explicit spawn tokens and default kill/sleep dependencies', async () => {
  const fallbackVault = await createTempVault('operator-config-device-daemon-fallback-')
  let fallbackHealthy = false
  let fallbackSpawnCalls = 0
  const fallbackResult = await ensureManagedDeviceSyncControlPlane({
    vault: fallbackVault,
    env: {
      DEVICE_SYNC_CONTROL_TOKEN: ' explicit-token ',
      ...TEST_WHOOP_PROVIDER_ENV,
    },
    dependencies: {
      fetchImpl: async (_input, init) =>
        new Response(null, {
          status:
            fallbackHealthy &&
            new Headers(init?.headers).get('Authorization') === 'Bearer explicit-token'
              ? 200
              : 503,
        }),
      isProcessAlive: () => false,
      now: () => new Date('2026-04-08T00:00:00.000Z'),
      resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
      spawnProcess: async () => {
        fallbackSpawnCalls += 1
        fallbackHealthy = true
        return { pid: 9500 }
      },
    },
  })
  assert.deepEqual(fallbackResult, {
    baseUrl: 'http://localhost:8788',
    controlToken: 'explicit-token',
    managed: true,
    started: true,
  })

  const fallbackReuse = await ensureManagedDeviceSyncControlPlane({
    vault: fallbackVault,
    env: {
      DEVICE_SYNC_CONTROL_TOKEN: ' explicit-token ',
    },
    dependencies: {
      fetchImpl: async (_input, init) =>
        new Response(null, {
          status:
            fallbackHealthy &&
            new Headers(init?.headers).get('Authorization') === 'Bearer explicit-token'
              ? 200
              : 401,
        }),
      isProcessAlive: (pid) => pid === 9500,
      now: () => new Date('2026-04-08T00:00:00.000Z'),
      spawnProcess: async () => {
        fallbackSpawnCalls += 1
        throw new Error('spawnProcess should not be called')
      },
    },
  })
  assert.deepEqual(fallbackReuse, {
    baseUrl: 'http://localhost:8788',
    controlToken: 'explicit-token',
    managed: true,
    started: false,
  })
  assert.equal(fallbackSpawnCalls, 1)

  const defaultStopVault = await createTempVault('operator-config-device-daemon-default-stop-')
  const defaultStopPaths = resolveDeviceDaemonPaths(defaultStopVault)
  await writeDeviceDaemonState(
    defaultStopPaths,
    {
      pid: 9400,
      baseUrl: 'http://127.0.0.1:4318',
      startedAt: '2026-04-08T00:00:00.000Z',
    },
    createFileDependencies(),
  )
  await writeManagedControlToken(defaultStopPaths, 'managed-token', createFileDependencies())

  let stopped = false
  vi.useFakeTimers()
  vi.spyOn(process, 'kill').mockImplementation(((pid: number, signal?: NodeJS.Signals | number) => {
    if (signal === 0) {
      return true
    }

    assert.equal(pid, 9400)
    stopped = true
    return true
  }) as typeof process.kill)

  const stopPromise = stopManagedDeviceSyncDaemon({
    vault: defaultStopVault,
    baseUrl: 'http://127.0.0.1:4318',
    dependencies: {
      isProcessAlive: () => !stopped,
      findUnmanagedDeviceSyncDaemonPid: async () => 9400,
      resolveDeviceSyncPackageEntry: () => '/opt/device-syncd/dist/index.js',
    },
  })
  await vi.advanceTimersByTimeAsync(100)

  const stoppedResult = await stopPromise
  assert.equal(stoppedResult.stopped, true)
  assert.equal(stoppedResult.message, 'Murph stopped the managed local device sync daemon.')
  assert.equal(await readDeviceDaemonState(defaultStopPaths, createFileDependencies()), null)
  assert.equal(resolveManagedControlToken(defaultStopPaths), null)
})

test('default unmanaged listener finder requires an exact device-syncd bin path', async () => {
  const vault = await createTempVault('operator-config-device-daemon-finder-')
  const expectedBinPath = path.join(vault, 'device syncd', 'dist', 'bin.js')
  let lsofStdout = '1234\n'
  let psStdout = `${process.execPath} "${expectedBinPath}" --managed\n`

  const processModule = await importDeviceDaemonProcessWithMocks(() => {
    const execFileMock = Object.assign(
      vi.fn(),
      {
        [promisify.custom]: async (command: string) => {
          if (command === 'lsof') {
            return { stdout: lsofStdout, stderr: '' }
          }
          if (command === 'ps') {
            return { stdout: psStdout, stderr: '' }
          }
          throw new Error(`Unexpected command ${command}`)
        },
      },
    )

    vi.doMock('node:child_process', () => ({
      execFile: execFileMock,
      spawn() {
        throw new Error('spawn should not be called')
      },
    }))
  })

  assert.equal(
    await processModule.defaultFindUnmanagedDeviceSyncDaemonPid({
      baseUrl: 'http://localhost:8788',
      expectedBinPath,
      port: '8788',
    }),
    1234,
  )

  psStdout = `${process.execPath} /tmp/packages/device-syncd/dist/bin.js --note="${expectedBinPath}.bak"\n`
  assert.equal(
    await processModule.defaultFindUnmanagedDeviceSyncDaemonPid({
      baseUrl: 'http://localhost:8788',
      expectedBinPath,
      port: '8788',
    }),
    null,
  )

  lsofStdout = '1234\n5678\n'
  psStdout = `${process.execPath} "${expectedBinPath}" --managed\n`
  assert.equal(
    await processModule.defaultFindUnmanagedDeviceSyncDaemonPid({
      baseUrl: 'http://localhost:8788',
      expectedBinPath,
      port: '8788',
    }),
    null,
  )
})

test('default spawn helper covers pid-less and synchronous child-process failures', async () => {
  const vault = await createTempVault('operator-config-device-daemon-spawn-errors-')

  class MockChild extends EventEmitter {
    pid?: number

    unref(): void {}
  }

  const pidlessModule = await importDeviceDaemonProcessWithMocks(() => {
    vi.doMock('node:child_process', () => ({
      execFile() {
        throw new Error('execFile should not be called')
      },
      spawn() {
        const child = new MockChild()
        process.nextTick(() => child.emit('spawn'))
        return child
      },
    }))
  })
  await assert.rejects(
    () =>
      pidlessModule.defaultSpawnDeviceDaemonProcess({
        command: process.execPath,
        args: [...deviceDaemonChildFixtureArgs],
        env: {},
        stdoutPath: path.join(vault, 'pidless', 'stdout.log'),
        stderrPath: path.join(vault, 'pidless', 'stderr.log'),
      }),
    (error) =>
      error instanceof Error &&
      error.message === 'Device sync daemon spawn did not yield a PID.',
  )

  const errorModule = await importDeviceDaemonProcessWithMocks(() => {
    vi.doMock('node:child_process', () => ({
      execFile() {
        throw new Error('execFile should not be called')
      },
      spawn() {
        const child = new MockChild()
        child.pid = 9500
        process.nextTick(() => child.emit('error', new Error('spawn child failed')))
        return child
      },
    }))
  })
  await assert.rejects(
    () =>
      errorModule.defaultSpawnDeviceDaemonProcess({
        command: process.execPath,
        args: [...deviceDaemonChildFixtureArgs],
        env: {},
        stdoutPath: path.join(vault, 'error', 'stdout.log'),
        stderrPath: path.join(vault, 'error', 'stderr.log'),
      }),
    (error) =>
      error instanceof Error &&
      error.message === 'spawn child failed',
  )

  const throwingModule = await importDeviceDaemonProcessWithMocks(() => {
    vi.doMock('node:child_process', () => ({
      execFile() {
        throw new Error('execFile should not be called')
      },
      spawn() {
        throw new Error('spawn exploded')
      },
    }))
  })
  await assert.rejects(
    () =>
      throwingModule.defaultSpawnDeviceDaemonProcess({
        command: process.execPath,
        args: [...deviceDaemonChildFixtureArgs],
        env: {},
        stdoutPath: path.join(vault, 'throwing', 'stdout.log'),
        stderrPath: path.join(vault, 'throwing', 'stderr.log'),
      }),
    (error) =>
      error instanceof Error &&
      error.message === 'spawn exploded',
  )
})

test('default spawn helper closes the first log descriptor when opening the second one fails', async () => {
  const vault = await createTempVault('operator-config-daemon-log-open-')
  const closedDescriptors: number[] = []
  let openCalls = 0

  const processModule = await importDeviceDaemonProcessWithMocks(() => {
    vi.doMock('node:fs', async (importOriginal) => {
      const actual = await importOriginal<typeof import('node:fs')>()
      const regularFileStats = actual.statSync(process.execPath)

      return {
        ...actual,
        closeSync: (fd: number) => {
          closedDescriptors.push(fd)
        },
        fchmodSync: () => undefined,
        fstatSync: () => regularFileStats,
        openSync: () => {
          openCalls += 1
          if (openCalls === 1) {
            return 11
          }

          throw new Error('second log open failed')
        },
      }
    })
  })
  await assert.rejects(
    () =>
      processModule.defaultSpawnDeviceDaemonProcess({
        command: process.execPath,
        args: [...deviceDaemonChildFixtureArgs],
        env: {},
        stdoutPath: path.join(vault, 'stdout.log'),
        stderrPath: path.join(vault, 'stderr.log'),
      }),
    (error) =>
      error instanceof Error &&
      error.message === 'second log open failed',
  )
  assert.deepEqual(closedDescriptors, [11])
})
