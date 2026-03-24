import { randomBytes } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  rm,
} from 'node:fs/promises'
import { writeTextFileAtomic } from '@healthybob/runtime-state'

import {
  DEVICE_SYNC_BASE_URL_ENV,
  resolveDeviceSyncBaseUrl,
  resolveDeviceSyncControlToken,
} from './device-sync-client.js'
import {
  buildManagedDeviceSyncEnvironment,
  resolveDeviceDaemonPaths,
  resolveDeviceSyncDaemonBinPath,
  resolveInstalledDeviceSyncPackageEntry,
} from './device-daemon/paths.js'
import {
  defaultIsProcessAlive,
  defaultSpawnDeviceDaemonProcess,
  isDeviceDaemonHealthy,
  readRecentDeviceDaemonLog,
  waitForDeviceDaemonExit,
  waitForDeviceDaemonHealth,
} from './device-daemon/process.js'
import {
  buildDeviceDaemonStartResult,
  buildDeviceDaemonStatusResult,
  buildDeviceDaemonStopResult,
  readDeviceDaemonState,
  resolveManagedControlToken,
  writeDeviceDaemonState,
} from './device-daemon/state.js'
import type {
  DeviceDaemonDependencies,
  DeviceDaemonDependencyOverrides,
  DeviceDaemonStartResult,
  DeviceDaemonStateRecord,
  DeviceDaemonStatusResult,
  DeviceDaemonStopResult,
} from './device-daemon/types.js'
import {
  DEVICE_DAEMON_START_TIMEOUT_MS,
  DEVICE_DAEMON_STOP_TIMEOUT_MS,
  DEVICE_DAEMON_STATE_VERSION,
} from './device-daemon/types.js'
import { VaultCliError } from './vault-cli-errors.js'
export type {
  DeviceDaemonPaths,
  DeviceDaemonStartResult,
  DeviceDaemonStatusResult,
  DeviceDaemonStopResult,
} from './device-daemon/types.js'

export async function ensureManagedDeviceSyncControlPlane(input: {
  vault?: string | null
  baseUrl?: string | null
  env?: NodeJS.ProcessEnv
  dependencies?: DeviceDaemonDependencyOverrides
}): Promise<{
  baseUrl: string
  controlToken: string | null
  managed: boolean
  started: boolean
}> {
  const env = input.env ?? process.env
  if (hasExplicitControlPlaneTarget(input.baseUrl, env)) {
    return {
      baseUrl: resolveDeviceSyncBaseUrl(input.baseUrl, env),
      controlToken: resolveDeviceSyncControlToken(undefined, env),
      managed: false,
      started: false,
    }
  }

  const startResult = await startManagedDeviceSyncDaemon({
    vault: requireManagedVault(input.vault),
    baseUrl: input.baseUrl,
    env,
    dependencies: input.dependencies,
  })

  if (!startResult.managed) {
    return {
      baseUrl: startResult.baseUrl,
      controlToken: resolveDeviceSyncControlToken(undefined, env),
      managed: false,
      started: false,
    }
  }

  return {
    baseUrl: startResult.baseUrl,
    controlToken: readManagedControlToken(
      requireManagedVault(input.vault),
      input.dependencies,
    ),
    managed: true,
    started: startResult.started,
  }
}

export async function getManagedDeviceSyncDaemonStatus(input: {
  vault: string
  baseUrl?: string | null
  env?: NodeJS.ProcessEnv
  dependencies?: DeviceDaemonDependencyOverrides
}): Promise<DeviceDaemonStatusResult> {
  const dependencies = createDeviceDaemonDependencies(input.dependencies)
  const vault = requireManagedVault(input.vault)
  const paths = resolveDeviceDaemonPaths(vault)
  const baseUrl = resolveDeviceSyncBaseUrl(input.baseUrl, input.env ?? process.env)
  const state = await readDeviceDaemonState(paths, dependencies)
  const healthy = await isDeviceDaemonHealthy(baseUrl, dependencies.fetchImpl)
  const managed = state !== null && state.baseUrl === baseUrl
  const running =
    managed &&
    state !== null &&
    dependencies.isProcessAlive(state.pid) &&
    healthy
  let message: string | null = null

  if (managed && state !== null && !dependencies.isProcessAlive(state.pid)) {
    message =
      'Stale device-sync daemon state found; recorded PID is no longer running.'
  } else if (healthy && !managed) {
    message =
      'Device sync control plane is reachable at the target base URL, but it is not managed by this Healthy Bob vault.'
  } else if (!healthy) {
    message = 'Device sync daemon is not running.'
  }

  return buildDeviceDaemonStatusResult({
    vault,
    paths,
    baseUrl,
    state,
    managed,
    running,
    healthy,
    message,
  })
}

export async function startManagedDeviceSyncDaemon(input: {
  vault: string
  baseUrl?: string | null
  env?: NodeJS.ProcessEnv
  dependencies?: DeviceDaemonDependencyOverrides
}): Promise<DeviceDaemonStartResult> {
  const dependencies = createDeviceDaemonDependencies(input.dependencies)
  const env = input.env ?? process.env
  const vault = requireManagedVault(input.vault)
  const baseUrl = resolveDeviceSyncBaseUrl(input.baseUrl, env)
  assertLoopbackBaseUrl(baseUrl)

  const paths = resolveDeviceDaemonPaths(vault)
  const state = await readDeviceDaemonState(paths, dependencies)
  const existingHealthy = await isDeviceDaemonHealthy(baseUrl, dependencies.fetchImpl)

  if (state !== null && state.baseUrl === baseUrl) {
    if (dependencies.isProcessAlive(state.pid) && existingHealthy) {
      return buildDeviceDaemonStartResult({
        vault,
        paths,
        baseUrl,
        state,
        managed: true,
        running: true,
        healthy: true,
        message: 'Healthy Bob is already managing the local device sync daemon.',
        started: false,
      })
    }

    if (dependencies.isProcessAlive(state.pid) && !existingHealthy) {
      throw new VaultCliError(
        'DEVICE_SYNC_DAEMON_UNHEALTHY',
        'The managed device sync daemon process is running but not healthy. Stop it with `healthybob device daemon stop --vault <path>` and retry.',
        { pid: state.pid, baseUrl },
      )
    }
  }

  if (existingHealthy) {
    const explicitControlToken = resolveDeviceSyncControlToken(undefined, env)
    if (explicitControlToken) {
      return buildDeviceDaemonStartResult({
        vault,
        paths,
        baseUrl,
        state: null,
        managed: false,
        running: true,
        healthy: true,
        message:
          'A device sync control plane is already reachable at this base URL. Healthy Bob is using the explicitly configured token instead of taking ownership of that process.',
        started: false,
      })
    }

    throw new VaultCliError(
      'DEVICE_SYNC_DAEMON_CONFLICT',
      'A device sync control plane is already reachable at this base URL, but Healthy Bob does not own it. Set DEVICE_SYNC_CONTROL_TOKEN to reuse it or stop the conflicting process first.',
      { baseUrl },
    )
  }

  const controlToken =
    resolveDeviceSyncControlToken(undefined, env) ?? generateDeviceSyncControlToken()
  const child = await dependencies.spawnProcess({
    command: process.execPath,
    args: [resolveDeviceSyncDaemonBinPath(dependencies)],
    env: buildManagedDeviceSyncEnvironment({
      baseUrl,
      controlToken,
      env,
      paths,
      vault,
    }),
    stdoutPath: paths.stdoutLogPath,
    stderrPath: paths.stderrLogPath,
  })

  const stateRecord: DeviceDaemonStateRecord = {
    version: DEVICE_DAEMON_STATE_VERSION,
    pid: child.pid,
    baseUrl,
    controlToken,
    startedAt: dependencies.now().toISOString(),
  }
  await writeDeviceDaemonState(paths, stateRecord, dependencies)

  const healthy = await waitForDeviceDaemonHealth(
    baseUrl,
    dependencies,
    DEVICE_DAEMON_START_TIMEOUT_MS,
  )

  if (!healthy) {
    if (dependencies.isProcessAlive(child.pid)) {
      dependencies.killProcess(child.pid, 'SIGTERM')
    }
    await dependencies.removeFile(paths.launcherStatePath)
    const startupLogSnippet = await readRecentDeviceDaemonLog(
      paths.stderrLogPath,
      dependencies,
    )
    throw new VaultCliError(
      'DEVICE_SYNC_DAEMON_START_FAILED',
      startupLogSnippet
        ? `Healthy Bob could not start the local device sync daemon: ${startupLogSnippet}`
        : 'Healthy Bob could not start the local device sync daemon.',
      { baseUrl, pid: child.pid },
    )
  }

  return buildDeviceDaemonStartResult({
    vault,
    paths,
    baseUrl,
    state: stateRecord,
    managed: true,
    running: true,
    healthy: true,
    message:
      'Healthy Bob started and is now managing the local device sync daemon.',
    started: true,
  })
}

export async function stopManagedDeviceSyncDaemon(input: {
  vault: string
  baseUrl?: string | null
  env?: NodeJS.ProcessEnv
  dependencies?: DeviceDaemonDependencyOverrides
}): Promise<DeviceDaemonStopResult> {
  const dependencies = createDeviceDaemonDependencies(input.dependencies)
  const vault = requireManagedVault(input.vault)
  const paths = resolveDeviceDaemonPaths(vault)
  const baseUrl = resolveDeviceSyncBaseUrl(input.baseUrl, input.env ?? process.env)
  const state = await readDeviceDaemonState(paths, dependencies)

  if (state === null || state.baseUrl !== baseUrl) {
    throw new VaultCliError(
      'DEVICE_SYNC_NOT_RUNNING',
      'Healthy Bob is not currently managing a device sync daemon for this vault and base URL.',
      { baseUrl },
    )
  }

  if (!dependencies.isProcessAlive(state.pid)) {
    await dependencies.removeFile(paths.launcherStatePath)
    return buildDeviceDaemonStopResult({
      vault,
      paths,
      baseUrl,
      state: null,
      managed: false,
      running: false,
      healthy: false,
      message:
        'Removed stale device sync daemon launcher state; the recorded process was already gone.',
      stopped: true,
    })
  }

  dependencies.killProcess(state.pid, 'SIGTERM')

  const stopped = await waitForDeviceDaemonExit(
    state.pid,
    dependencies,
    DEVICE_DAEMON_STOP_TIMEOUT_MS,
  )

  if (!stopped) {
    throw new VaultCliError(
      'DEVICE_SYNC_STOP_TIMEOUT',
      'Device sync daemon did not stop within the expected timeout.',
      { pid: state.pid, baseUrl },
    )
  }

  await dependencies.removeFile(paths.launcherStatePath)

  return buildDeviceDaemonStopResult({
    vault,
    paths,
    baseUrl,
    state: null,
    managed: false,
    running: false,
    healthy: false,
    message:
      'Healthy Bob stopped the managed local device sync daemon.',
    stopped: true,
  })
}

function createDeviceDaemonDependencies(
  overrides: DeviceDaemonDependencyOverrides = {},
): DeviceDaemonDependencies {
  return {
    now: overrides.now ?? (() => new Date()),
    sleep:
      overrides.sleep ??
      (async (milliseconds) => {
        await new Promise((resolve) => {
          setTimeout(resolve, milliseconds)
        })
      }),
    mkdir:
      overrides.mkdir ??
      (async (directoryPath) => {
        await mkdir(directoryPath, { recursive: true })
      }),
    readFile:
      overrides.readFile ??
      (async (filePath) => {
        return await readFile(filePath, 'utf8')
      }),
    writeFile:
      overrides.writeFile ??
      (async (filePath, text) => {
        await writeTextFileAtomic(filePath, text, { trailingNewline: true })
      }),
    removeFile:
      overrides.removeFile ??
      (async (filePath) => {
        await rm(filePath, { force: true })
      }),
    chmod:
      overrides.chmod ??
      (async (filePath, mode) => {
        await chmod(filePath, mode)
      }),
    fetchImpl: overrides.fetchImpl ?? fetch,
    isProcessAlive: overrides.isProcessAlive ?? defaultIsProcessAlive,
    killProcess:
      overrides.killProcess ??
      ((pid, signal) => {
        process.kill(pid, signal)
      }),
    spawnProcess: overrides.spawnProcess ?? defaultSpawnDeviceDaemonProcess,
    resolveDeviceSyncPackageEntry:
      overrides.resolveDeviceSyncPackageEntry ??
      resolveInstalledDeviceSyncPackageEntry,
  }
}

function hasExplicitControlPlaneTarget(
  baseUrl: string | null | undefined,
  env: NodeJS.ProcessEnv,
): boolean {
  return (
    (typeof baseUrl === 'string' && baseUrl.trim().length > 0) ||
    typeof env[DEVICE_SYNC_BASE_URL_ENV] === 'string'
  )
}

function requireManagedVault(vault: string | null | undefined): string {
  if (typeof vault === 'string' && vault.trim().length > 0) {
    return vault.trim()
  }

  throw new VaultCliError(
    'DEVICE_SYNC_VAULT_REQUIRED',
    'Device sync daemon management needs a vault path. Pass `--vault <path>` or configure a default Healthy Bob vault first.',
  )
}

function assertLoopbackBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl)
  if (isLoopbackHostname(url.hostname)) {
    return
  }

  throw new VaultCliError(
    'DEVICE_SYNC_REMOTE_BASE_URL_UNSUPPORTED',
    'Healthy Bob can only manage loopback device sync daemons. Use a localhost base URL or manage remote control planes explicitly.',
    { baseUrl },
  )
}

function isLoopbackHostname(hostname: string): boolean {
  const normalized = hostname.trim().toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized.startsWith('127.')
  )
}

function generateDeviceSyncControlToken(): string {
  return randomBytes(24).toString('hex')
}

function readManagedControlToken(
  vaultRoot: string,
  _overrides?: DeviceDaemonDependencyOverrides,
): string | null {
  const paths = resolveDeviceDaemonPaths(vaultRoot)
  return resolveManagedControlToken(paths)
}
