import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { chmod, mkdtemp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, test, vi } from 'vitest'

import {
  deviceDaemonStatusResultSchema,
  deviceSyncAccountStatusSchema,
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
  writeDeviceDaemonState,
  writeManagedControlToken,
} from '../src/device-daemon/state.ts'
import { VaultCliError } from '../src/vault-cli-errors.ts'

const tempDirectories = new Set<string>()

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
  resolveImpl: () => string,
): NodeJS.Require {
  const mockRequire = actualModule.createRequire(import.meta.url)
  mockRequire.resolve = createMockResolve(resolveImpl)
  return mockRequire
}

function createMockResolve(resolveImpl: () => string): NodeJS.RequireResolve {
  function resolve(_request: string): string {
    return resolveImpl()
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
  assert.match(resolveInstalledDeviceSyncPackageEntry(), /device-syncd/u)

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
      env: {},
      paths,
    }),
    {
      DEVICE_SYNC_CONTROL_TOKEN: 'generated-token',
      DEVICE_SYNC_HOST: '127.0.0.1',
      DEVICE_SYNC_PORT: '443',
      DEVICE_SYNC_PUBLIC_BASE_URL: 'https://127.0.0.1/device',
      DEVICE_SYNC_SECRET: 'generated-token',
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
      fetchImpl: async () => new Response(null, { status: 200 }),
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
    dependencies: {
      now: () => new Date('2026-04-08T00:00:00.000Z'),
      sleep: async () => undefined,
      fetchImpl: async () => {
        healthAttempt += 1
        return new Response(null, {
          status: healthAttempt >= 2 ? 200 : 503,
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
      fetchImpl: async () => new Response(null, { status: 200 }),
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
    },
  })
  assert.equal(stopped.stopped, true)
  assert.equal(stopped.running, false)
  assert.equal(resolveManagedControlToken(resolveDeviceDaemonPaths(managedVault)), null)
  assert.equal(await readDeviceDaemonState(resolveDeviceDaemonPaths(managedVault), createFileDependencies()), null)

  const unmanagedStatus = await getManagedDeviceSyncDaemonStatus({
    vault: staleVault,
    baseUrl: 'http://127.0.0.1:4318',
    dependencies: {
      fetchImpl: async () => new Response(null, { status: 200 }),
      isProcessAlive: () => false,
    },
  })
  assert.equal(unmanagedStatus.managed, true)
  assert.equal(unmanagedStatus.healthy, true)

  const reachableButUnmanaged = await getManagedDeviceSyncDaemonStatus({
    vault: staleVault,
    baseUrl: 'http://127.0.0.1:9999',
    dependencies: {
      fetchImpl: async () => new Response(null, { status: 200 }),
      isProcessAlive: () => false,
    },
  })
  assert.equal(reachableButUnmanaged.managed, false)
  assert.equal(
    reachableButUnmanaged.message,
    'Device sync control plane is reachable at the target base URL, but it is not managed by this Murph vault.',
  )

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
  const killedPids: number[] = []
  const removedFiles: string[] = []

  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: startFailureVault,
        baseUrl: 'http://127.0.0.1:4318',
        dependencies: {
          now: () => new Date(startFailureNowMs),
          sleep: async () => {
            startFailureNowMs += 100
          },
          fetchImpl: async () => new Response(null, { status: 503 }),
          isProcessAlive: () => true,
          killProcess: (pid) => {
            killedPids.push(pid)
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
  assert.deepEqual(killedPids, [9100])
  assert.equal(removedFiles.includes(startFailurePaths.launcherStatePath), true)
  assert.equal(resolveManagedControlToken(startFailurePaths), null)

  const writeFailureVault = await createTempVault('operator-config-device-daemon-write-failure-')
  const writeFailurePaths = resolveDeviceDaemonPaths(writeFailureVault)
  const writeFailureRemovals: string[] = []

  await assert.rejects(
    () =>
      startManagedDeviceSyncDaemon({
        vault: writeFailureVault,
        baseUrl: 'http://127.0.0.1:4318',
        dependencies: {
          chmod: async () => undefined,
          mkdir: async () => undefined,
          now: () => new Date('2026-04-08T00:00:00.000Z'),
          fetchImpl: async () => new Response(null, { status: 503 }),
          isProcessAlive: () => false,
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
  assert.deepEqual(writeFailureRemovals, [
    writeFailurePaths.launcherStatePath,
    path.join(path.dirname(writeFailurePaths.launcherStatePath), 'control-token'),
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
        },
      }),
    (error) =>
      error instanceof VaultCliError &&
      error.code === 'DEVICE_SYNC_STOP_TIMEOUT',
  )
})

test('device-daemon management also covers explicit-token fallback ownership and default kill/sleep dependencies', async () => {
  const fallbackVault = await createTempVault('operator-config-device-daemon-fallback-')
  const fallbackResult = await ensureManagedDeviceSyncControlPlane({
    vault: fallbackVault,
    env: {
      DEVICE_SYNC_CONTROL_TOKEN: ' explicit-token ',
    },
    dependencies: {
      fetchImpl: async () => new Response(null, { status: 200 }),
      isProcessAlive: () => false,
      now: () => new Date('2026-04-08T00:00:00.000Z'),
    },
  })
  assert.deepEqual(fallbackResult, {
    baseUrl: 'http://localhost:8788',
    controlToken: 'explicit-token',
    managed: false,
    started: false,
  })

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
    },
  })
  await vi.advanceTimersByTimeAsync(100)

  const stoppedResult = await stopPromise
  assert.equal(stoppedResult.stopped, true)
  assert.equal(stoppedResult.message, 'Murph stopped the managed local device sync daemon.')
  assert.equal(await readDeviceDaemonState(defaultStopPaths, createFileDependencies()), null)
  assert.equal(resolveManagedControlToken(defaultStopPaths), null)
})

test('default spawn helper covers pid-less and synchronous child-process failures', async () => {
  const vault = await createTempVault('operator-config-device-daemon-spawn-errors-')

  class MockChild extends EventEmitter {
    pid?: number

    unref(): void {}
  }

  const pidlessModule = await importDeviceDaemonProcessWithMocks(() => {
    vi.doMock('node:child_process', () => ({
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
  const closedDescriptors: number[] = []
  let openCalls = 0

  const processModule = await importDeviceDaemonProcessWithMocks(() => {
    vi.doMock('node:fs/promises', () => ({
      mkdir: async () => undefined,
    }))
    vi.doMock('node:fs', () => ({
      chmodSync: () => undefined,
      closeSync: (fd: number) => {
        closedDescriptors.push(fd)
      },
      openSync: () => {
        openCalls += 1
        if (openCalls === 1) {
          return 11
        }

        throw new Error('second log open failed')
      },
    }))
  })
  await assert.rejects(
    () =>
      processModule.defaultSpawnDeviceDaemonProcess({
        command: process.execPath,
        args: [...deviceDaemonChildFixtureArgs],
        env: {},
        stdoutPath: '/tmp/operator-config-daemon/stdout.log',
        stderrPath: '/tmp/operator-config-daemon/stderr.log',
      }),
    (error) =>
      error instanceof Error &&
      error.message === 'second log open failed',
  )
  assert.deepEqual(closedDescriptors, [11])
})
