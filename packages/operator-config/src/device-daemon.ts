import { randomBytes } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  rm,
} from 'node:fs/promises'
import {
  isLoopbackHostname,
  writeTextFileAtomic,
} from '@murphai/runtime-state/node'

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
  removeManagedControlToken,
  readDeviceDaemonState,
  resolveManagedControlToken,
  writeManagedControlToken,
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
} from './device-daemon/types.js'
import { VaultCliError } from './vault-cli-errors.js'
export type { DeviceDaemonPaths } from './device-daemon/types.js'

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
    controlToken: readManagedControlToken(requireManagedVault(input.vault)),
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
  const managedToken = readManagedControlToken(vault)
  const managed = state !== null && state.baseUrl === baseUrl
  const stateProcessAlive =
    managed && state !== null ? dependencies.isProcessAlive(state.pid) : false
  const controlPlaneReachable = await isDeviceDaemonControlPlaneReachable(
    baseUrl,
    dependencies.fetchImpl,
  )
  const healthy = stateProcessAlive && managedToken
    ? await isDeviceDaemonHealthy(baseUrl, dependencies.fetchImpl, managedToken)
    : false
  const running =
    managed &&
    state !== null &&
    healthy
  let message: string | null = null

  if (managed && !stateProcessAlive) {
    message =
      'Stale device-sync daemon state found; recorded PID is no longer running.'
  } else if (controlPlaneReachable && !managed) {
    message =
      'Device sync control plane is reachable at the target base URL, but it is not managed by this Murph vault.'
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
  const existingToken = readManagedControlToken(vault)
  const explicitControlToken = resolveDeviceSyncControlToken(undefined, env)
  const stateProcessAlive =
    state !== null && state.baseUrl === baseUrl
      ? dependencies.isProcessAlive(state.pid)
      : false
  const managedHealthy =
    stateProcessAlive &&
    existingToken
    ? await isDeviceDaemonHealthy(baseUrl, dependencies.fetchImpl, existingToken)
    : false
  const managedTokenUnavailable =
    state !== null &&
    state.baseUrl === baseUrl &&
    !existingToken &&
    !explicitControlToken

  if (state !== null && state.baseUrl === baseUrl) {
    if (stateProcessAlive && managedHealthy) {
      return buildDeviceDaemonStartResult({
        vault,
        paths,
        baseUrl,
        state,
        managed: true,
        running: true,
        healthy: true,
        message: 'Murph is already managing the local device sync daemon.',
        started: false,
      })
    }

    if (stateProcessAlive && managedTokenUnavailable) {
      throw new VaultCliError(
        'DEVICE_SYNC_DAEMON_CONFLICT',
        `The tracked device sync daemon process is still running, but this vault no longer has its managed token. Stop it with \`murph device daemon stop --vault <path>\` or retry with \`DEVICE_SYNC_PORT=<free-port>\`.`,
        { pid: state.pid, baseUrl },
      )
    }

    if (stateProcessAlive && !managedHealthy) {
      throw new VaultCliError(
        'DEVICE_SYNC_DAEMON_UNHEALTHY',
        'The managed device sync daemon process is running but not healthy. Stop it with `murph device daemon stop --vault <path>` and retry.',
        { pid: state.pid, baseUrl },
      )
    }
  }

  if (await isDeviceDaemonControlPlaneReachable(baseUrl, dependencies.fetchImpl)) {
    throw new VaultCliError(
      'DEVICE_SYNC_DAEMON_CONFLICT',
      buildUnmanagedReachableDeviceDaemonMessage(baseUrl),
      { baseUrl },
    )
  }

  const controlToken =
    explicitControlToken ?? generateDeviceSyncControlToken()
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
    pid: child.pid,
    baseUrl,
    startedAt: dependencies.now().toISOString(),
  }
  try {
    await writeDeviceDaemonState(paths, stateRecord, dependencies)
    await writeManagedControlToken(paths, controlToken, dependencies)
  } catch (error) {
    await dependencies.removeFile(paths.launcherStatePath)
    await removeManagedControlToken(paths, dependencies)
    throw error
  }

  const healthy = await waitForDeviceDaemonHealth(
    baseUrl,
    dependencies,
    DEVICE_DAEMON_START_TIMEOUT_MS,
    controlToken,
  )

  if (!healthy) {
    if (dependencies.isProcessAlive(child.pid)) {
      dependencies.killProcess(child.pid, 'SIGTERM')
    }
    await dependencies.removeFile(paths.launcherStatePath)
    await removeManagedControlToken(paths, dependencies)
    const startupLogSnippet = await readRecentDeviceDaemonLog(
      paths.stderrLogPath,
      dependencies,
    )
    if (startupLogSnippet && isAddressInUseStartupFailure(startupLogSnippet)) {
      throw new VaultCliError(
        'DEVICE_SYNC_DAEMON_CONFLICT',
        buildUnmanagedReachableDeviceDaemonMessage(baseUrl),
        { baseUrl, pid: child.pid },
      )
    }
    throw new VaultCliError(
      'DEVICE_SYNC_DAEMON_START_FAILED',
      startupLogSnippet
        ? `Murph could not start the local device sync daemon: ${startupLogSnippet}`
        : 'Murph could not start the local device sync daemon.',
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
      'Murph started and is now managing the local device sync daemon.',
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
      'Murph is not currently managing a device sync daemon for this vault and base URL.',
      { baseUrl },
    )
  }

  if (!dependencies.isProcessAlive(state.pid)) {
    await dependencies.removeFile(paths.launcherStatePath)
    await removeManagedControlToken(paths, dependencies)
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
  await removeManagedControlToken(paths, dependencies)

  return buildDeviceDaemonStopResult({
    vault,
    paths,
    baseUrl,
    state: null,
    managed: false,
    running: false,
    healthy: false,
    message:
      'Murph stopped the managed local device sync daemon.',
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
    'Device sync daemon management needs a vault path. Pass `--vault <path>` or configure a default Murph vault first.',
  )
}

function assertLoopbackBaseUrl(baseUrl: string): void {
  const url = new URL(baseUrl)
  if (isLoopbackHostname(url.hostname)) {
    return
  }

  throw new VaultCliError(
    'DEVICE_SYNC_REMOTE_BASE_URL_UNSUPPORTED',
    'Murph can only manage loopback device sync daemons. Use a localhost base URL or manage remote control planes explicitly.',
    { baseUrl },
  )
}

async function isDeviceDaemonControlPlaneReachable(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(new URL('healthz', `${baseUrl}/`), {
      signal: AbortSignal.timeout(750),
    })
    return response.ok || response.status === 401 || response.status === 403
  } catch {
    return false
  }
}

function isAddressInUseStartupFailure(message: string): boolean {
  return /\bEADDRINUSE\b|address already in use/iu.test(message)
}

function buildUnmanagedReachableDeviceDaemonMessage(baseUrl: string): string {
  const port = readBaseUrlPort(baseUrl)
  const portHint = port
    ? ` Stop the listener on port ${port} (for example: \`lsof -nP -iTCP:${port} -sTCP:LISTEN\`, then \`kill <pid>\`) or retry with \`DEVICE_SYNC_PORT=<free-port>\`.`
    : ' Stop the listener on that port or retry with `DEVICE_SYNC_PORT=<free-port>`.'

  return `A device sync daemon is already listening at ${baseUrl}, but this vault is not managing it. This can happen after deleting \`.runtime\` while the old daemon is still running.${portHint}`
}

function readBaseUrlPort(baseUrl: string): string | null {
  const url = new URL(baseUrl)
  if (url.port) {
    return url.port
  }

  if (url.protocol === 'http:') {
    return '80'
  }

  if (url.protocol === 'https:') {
    return '443'
  }

  return null
}

function generateDeviceSyncControlToken(): string {
  return randomBytes(24).toString('hex')
}

function readManagedControlToken(vaultRoot: string): string | null {
  const paths = resolveDeviceDaemonPaths(vaultRoot)
  return resolveManagedControlToken(paths)
}
