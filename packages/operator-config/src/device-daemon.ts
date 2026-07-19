import { randomBytes } from 'node:crypto'
import {
  chmod,
  mkdir,
  readFile,
  rm,
} from 'node:fs/promises'
import {
  writeTextFileAtomic,
} from '@murphai/runtime-state/node'

import {
  hasConfiguredDeviceSyncProviderConfigs,
  readConfiguredDeviceSyncProviderConfigs,
} from '@murphai/device-syncd/config'
import {
  DEVICE_SYNC_SECRET_ENV_KEYS,
} from '@murphai/device-syncd/client'
import {
  DEVICE_SYNC_BASE_URL_ENV,
  resolveDeviceSyncBaseUrl,
  resolveDeviceSyncControlToken,
} from './device-sync-client.js'
import {
  assertManagedDeviceSyncLoopbackBaseUrl,
  buildManagedDeviceSyncEnvironment,
  requireManagedDeviceSyncVaultRoot,
  resolveDeviceDaemonPaths,
  resolveDeviceSyncDaemonBinPath,
  resolveInstalledDeviceSyncPackageEntry,
} from './device-daemon/paths.js'
import {
  defaultFindUnmanagedDeviceSyncDaemonPid,
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
  resolveManagedEncryptionSecret,
  writeManagedControlToken,
  writeDeviceDaemonState,
  writeManagedEncryptionSecret,
} from './device-daemon/state.js'
import type {
  DeviceDaemonDependencies,
  DeviceDaemonDependencyOverrides,
  DeviceDaemonPaths,
  DeviceDaemonStartResult,
  DeviceDaemonStateRecord,
  DeviceDaemonStatusResult,
  DeviceDaemonStopResult,
} from './device-daemon/types.js'
import {
  DEVICE_DAEMON_START_TIMEOUT_MS,
  DEVICE_DAEMON_STOP_TIMEOUT_MS,
} from './device-daemon/types.js'
import { readEnvValue } from './env-values.js'
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
    vault: requireManagedDeviceSyncVaultRoot(input.vault),
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
      requireManagedDeviceSyncVaultRoot(input.vault),
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
  const vault = requireManagedDeviceSyncVaultRoot(input.vault)
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
  const vault = requireManagedDeviceSyncVaultRoot(input.vault)
  const baseUrl = resolveDeviceSyncBaseUrl(input.baseUrl, env)
  assertManagedDeviceSyncLoopbackBaseUrl(baseUrl)

  const paths = resolveDeviceDaemonPaths(vault)
  const state = await readDeviceDaemonState(paths, dependencies)
  const existingToken = readManagedControlToken(vault)
  const explicitControlToken = resolveDeviceSyncControlToken(undefined, env)
  let recoveredUnmanagedDaemon = false
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
    recoveredUnmanagedDaemon = canStartDeviceSyncDaemonFromEnv(env)
      ? await recoverUnmanagedReachableDeviceDaemon({
          baseUrl,
          dependencies,
        })
      : false

    if (!recoveredUnmanagedDaemon) {
      throw new VaultCliError(
        'DEVICE_SYNC_DAEMON_CONFLICT',
        buildUnmanagedReachableDeviceDaemonMessage(baseUrl),
        { baseUrl },
      )
    }
  }

  if (!hasConfiguredDeviceSyncProviderConfigs(readConfiguredDeviceSyncProviderConfigs(env))) {
    throw buildMissingProviderCredentialsError(baseUrl)
  }

  const encryptionSecret = await resolveManagedDeviceSyncEncryptionSecret({
    paths,
    env,
    dependencies,
  })
  const controlToken =
    explicitControlToken ?? generateDeviceSyncControlToken()
  const child = await dependencies.spawnProcess({
    command: process.execPath,
    args: [resolveDeviceSyncDaemonBinPath(dependencies)],
    env: buildManagedDeviceSyncEnvironment({
      baseUrl,
      controlToken,
      encryptionSecret,
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
    await terminateSpawnedDeviceDaemon(child.pid, dependencies)
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
    await terminateSpawnedDeviceDaemon(child.pid, dependencies)
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
    if (startupLogSnippet && isMissingProviderCredentialsStartupFailure(startupLogSnippet)) {
      throw buildMissingProviderCredentialsError(baseUrl, child.pid)
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
      recoveredUnmanagedDaemon
        ? 'Murph stopped an orphaned local device sync daemon and started a fresh managed daemon.'
        : 'Murph started and is now managing the local device sync daemon.',
    started: true,
  })
}

async function terminateSpawnedDeviceDaemon(
  pid: number,
  dependencies: DeviceDaemonDependencies,
): Promise<void> {
  if (!dependencies.isProcessAlive(pid)) {
    return
  }

  if (!killProcessIfAlive(pid, 'SIGTERM', dependencies)) {
    return
  }
  const stopped = await waitForDeviceDaemonExit(
    pid,
    dependencies,
    DEVICE_DAEMON_STOP_TIMEOUT_MS,
  )
  if (!stopped && dependencies.isProcessAlive(pid)) {
    if (killProcessIfAlive(pid, 'SIGKILL', dependencies)) {
      await waitForDeviceDaemonExit(
        pid,
        dependencies,
        DEVICE_DAEMON_STOP_TIMEOUT_MS,
      )
    }
  }
}

function killProcessIfAlive(
  pid: number,
  signal: NodeJS.Signals,
  dependencies: DeviceDaemonDependencies,
): boolean {
  try {
    dependencies.killProcess(pid, signal)
    return true
  } catch (error) {
    if (!isProcessGoneError(error)) {
      throw error
    }
    return false
  }
}

function isProcessGoneError(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    (error as { code?: unknown }).code === 'ESRCH'
  )
}

export async function stopManagedDeviceSyncDaemon(input: {
  vault: string
  baseUrl?: string | null
  env?: NodeJS.ProcessEnv
  dependencies?: DeviceDaemonDependencyOverrides
}): Promise<DeviceDaemonStopResult> {
  const dependencies = createDeviceDaemonDependencies(input.dependencies)
  const vault = requireManagedDeviceSyncVaultRoot(input.vault)
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

  const processVerified = await isRecordedManagedDeviceDaemonProcess({
    baseUrl,
    dependencies,
    pid: state.pid,
  })
  if (!processVerified) {
    throw new VaultCliError(
      'DEVICE_SYNC_DAEMON_IDENTITY_UNVERIFIED',
      'The recorded device sync daemon process is still running, but Murph could not verify that PID belongs to the managed daemon. Refusing to stop it automatically.',
      { pid: state.pid, baseUrl },
    )
  }

  const stopped = killProcessIfAlive(state.pid, 'SIGTERM', dependencies)
    ? await waitForDeviceDaemonExit(
        state.pid,
        dependencies,
        DEVICE_DAEMON_STOP_TIMEOUT_MS,
      )
    : true

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

async function isRecordedManagedDeviceDaemonProcess(input: {
  baseUrl: string
  dependencies: DeviceDaemonDependencies
  pid: number
}): Promise<boolean> {
  let expectedBinPath: string
  try {
    expectedBinPath = resolveDeviceSyncDaemonBinPath(input.dependencies)
  } catch {
    return false
  }

  const pid = await input.dependencies.findUnmanagedDeviceSyncDaemonPid({
    baseUrl: input.baseUrl,
    expectedBinPath,
    port: readBaseUrlPort(input.baseUrl),
  })

  return pid === input.pid
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
    findUnmanagedDeviceSyncDaemonPid:
      overrides.findUnmanagedDeviceSyncDaemonPid ??
      defaultFindUnmanagedDeviceSyncDaemonPid,
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

async function recoverUnmanagedReachableDeviceDaemon(input: {
  baseUrl: string
  dependencies: DeviceDaemonDependencies
}): Promise<boolean> {
  let expectedBinPath: string
  try {
    expectedBinPath = resolveDeviceSyncDaemonBinPath(input.dependencies)
  } catch {
    return false
  }

  const pid = await input.dependencies.findUnmanagedDeviceSyncDaemonPid({
    baseUrl: input.baseUrl,
    expectedBinPath,
    port: readBaseUrlPort(input.baseUrl),
  })
  if (pid === null) {
    return false
  }

  if (!input.dependencies.isProcessAlive(pid)) {
    return true
  }

  if (!killProcessIfAlive(pid, 'SIGTERM', input.dependencies)) {
    return true
  }

  return await waitForDeviceDaemonExit(
    pid,
    input.dependencies,
    DEVICE_DAEMON_STOP_TIMEOUT_MS,
  )
}

function canStartDeviceSyncDaemonFromEnv(env: NodeJS.ProcessEnv): boolean {
  try {
    return hasConfiguredDeviceSyncProviderConfigs(
      readConfiguredDeviceSyncProviderConfigs(env),
    )
  } catch {
    return false
  }
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

function isMissingProviderCredentialsStartupFailure(message: string): boolean {
  return /No device sync providers are configured|provider client credential pair/iu.test(message)
}

function buildMissingProviderCredentialsError(
  baseUrl: string,
  pid?: number,
): VaultCliError {
  return new VaultCliError(
    'DEVICE_SYNC_PROVIDER_CONFIG_REQUIRED',
    'No local device sync provider credentials are configured. Set at least one supported provider client credential pair, such as WHOOP_CLIENT_ID and WHOOP_CLIENT_SECRET, before starting the local device sync daemon.',
    pid === undefined ? { baseUrl } : { baseUrl, pid },
  )
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

function generateDeviceSyncEncryptionSecret(): string {
  return randomBytes(32).toString('hex')
}

async function resolveManagedDeviceSyncEncryptionSecret(input: {
  paths: DeviceDaemonPaths
  env: NodeJS.ProcessEnv
  dependencies: Pick<DeviceDaemonDependencies, 'mkdir' | 'writeFile' | 'chmod'>
}): Promise<string> {
  const explicitSecret = readEnvValue(input.env, DEVICE_SYNC_SECRET_ENV_KEYS)
  if (explicitSecret) {
    return explicitSecret
  }

  const existingSecret = resolveManagedEncryptionSecret(input.paths)
  if (existingSecret) {
    return existingSecret
  }

  const generatedSecret = generateDeviceSyncEncryptionSecret()
  await writeManagedEncryptionSecret(
    input.paths,
    generatedSecret,
    input.dependencies,
  )
  return generatedSecret
}

function readManagedControlToken(vaultRoot: string): string | null {
  const paths = resolveDeviceDaemonPaths(vaultRoot)
  return resolveManagedControlToken(paths)
}
