import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { openSync, closeSync } from 'node:fs'
import {
  chmod,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises'
import { createRequire } from 'node:module'
import path from 'node:path'

import { resolveRuntimePaths } from '@healthybob/runtime-state'

import {
  DEFAULT_DEVICE_SYNC_BASE_URL,
  HEALTHYBOB_DEVICE_SYNC_BASE_URL_ENV,
  HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN_ENV,
  resolveDeviceSyncBaseUrl,
  resolveDeviceSyncControlToken,
} from './device-sync-client.js'
import { VaultCliError } from './vault-cli-errors.js'

const require = createRequire(import.meta.url)

const DEVICE_DAEMON_START_TIMEOUT_MS = 5_000
const DEVICE_DAEMON_STOP_TIMEOUT_MS = 5_000
const DEVICE_DAEMON_HEALTH_POLL_MS = 100
const DEVICE_DAEMON_STATE_VERSION = 1
const HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL_ENV =
  'HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL'
const HEALTHYBOB_DEVICE_SYNC_SECRET_ENV = 'HEALTHYBOB_DEVICE_SYNC_SECRET'
const HEALTHYBOB_DEVICE_SYNC_HOST_ENV = 'HEALTHYBOB_DEVICE_SYNC_HOST'
const HEALTHYBOB_DEVICE_SYNC_PORT_ENV = 'HEALTHYBOB_DEVICE_SYNC_PORT'
const HEALTHYBOB_DEVICE_SYNC_STATE_DB_PATH_ENV =
  'HEALTHYBOB_DEVICE_SYNC_STATE_DB_PATH'

interface DeviceDaemonStateRecord {
  version: number
  pid: number
  baseUrl: string
  controlToken: string
  startedAt: string
}

interface DeviceDaemonPaths {
  absoluteVaultRoot: string
  launcherStatePath: string
  stdoutLogPath: string
  stderrLogPath: string
  stateDbPath: string
}

export interface DeviceDaemonStatusResult {
  baseUrl: string
  statePath: string
  stdoutLogPath: string
  stderrLogPath: string
  managed: boolean
  running: boolean
  healthy: boolean
  pid: number | null
  startedAt: string | null
  message: string | null
}

export interface DeviceDaemonStartResult extends DeviceDaemonStatusResult {
  started: boolean
}

export interface DeviceDaemonStopResult extends DeviceDaemonStatusResult {
  stopped: boolean
}

interface DeviceDaemonDependencies {
  now(): Date
  sleep(milliseconds: number): Promise<void>
  mkdir(path: string): Promise<void>
  readFile(path: string): Promise<string>
  writeFile(path: string, text: string): Promise<void>
  removeFile(path: string): Promise<void>
  chmod(path: string, mode: number): Promise<void>
  fetchImpl: typeof fetch
  isProcessAlive(pid: number): boolean
  killProcess(pid: number, signal?: NodeJS.Signals | number): void
  spawnProcess(input: {
    command: string
    args: string[]
    env: NodeJS.ProcessEnv
    stdoutPath: string
    stderrPath: string
  }): Promise<{ pid: number }>
  resolveDeviceSyncPackageEntry(): string
}

type DeviceDaemonDependencyOverrides = Partial<DeviceDaemonDependencies>

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
      'A device sync control plane is already reachable at this base URL, but Healthy Bob does not own it. Set HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN to reuse it or stop the conflicting process first.',
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
        await writeFile(filePath, text, 'utf8')
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
      (() => require.resolve('@healthybob/device-syncd')),
  }
}

function resolveDeviceDaemonPaths(vaultRoot: string): DeviceDaemonPaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot)

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    launcherStatePath: runtimePaths.deviceSyncLauncherStatePath,
    stdoutLogPath: runtimePaths.deviceSyncStdoutLogPath,
    stderrLogPath: runtimePaths.deviceSyncStderrLogPath,
    stateDbPath: runtimePaths.deviceSyncDbPath,
  }
}

function hasExplicitControlPlaneTarget(
  baseUrl: string | null | undefined,
  env: NodeJS.ProcessEnv,
): boolean {
  return (
    (typeof baseUrl === 'string' && baseUrl.trim().length > 0) ||
    typeof env[HEALTHYBOB_DEVICE_SYNC_BASE_URL_ENV] === 'string'
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

function resolveDeviceSyncDaemonBinPath(
  dependencies: DeviceDaemonDependencies,
): string {
  return path.join(
    path.dirname(dependencies.resolveDeviceSyncPackageEntry()),
    'bin.js',
  )
}

function buildManagedDeviceSyncEnvironment(input: {
  vault: string
  baseUrl: string
  controlToken: string
  env: NodeJS.ProcessEnv
  paths: DeviceDaemonPaths
}): NodeJS.ProcessEnv {
  const parsedBaseUrl = new URL(input.baseUrl)
  const effectivePort =
    parsedBaseUrl.port ||
    (parsedBaseUrl.protocol === 'https:' ? '443' : '80')
  const normalizedHost =
    input.env[HEALTHYBOB_DEVICE_SYNC_HOST_ENV]?.trim() ||
    (parsedBaseUrl.hostname === 'localhost'
      ? '127.0.0.1'
      : parsedBaseUrl.hostname)

  return {
    ...input.env,
    HEALTHYBOB_VAULT_ROOT: input.vault,
    HEALTHYBOB_DEVICE_SYNC_VAULT_ROOT: input.vault,
    [HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL_ENV]:
      input.env[HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL_ENV]?.trim() ||
      input.baseUrl,
    [HEALTHYBOB_DEVICE_SYNC_SECRET_ENV]:
      input.env[HEALTHYBOB_DEVICE_SYNC_SECRET_ENV]?.trim() ||
      input.controlToken,
    [HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN_ENV]:
      input.env[HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN_ENV]?.trim() ||
      input.controlToken,
    [HEALTHYBOB_DEVICE_SYNC_HOST_ENV]: normalizedHost,
    [HEALTHYBOB_DEVICE_SYNC_PORT_ENV]:
      input.env[HEALTHYBOB_DEVICE_SYNC_PORT_ENV]?.trim() || effectivePort,
    [HEALTHYBOB_DEVICE_SYNC_STATE_DB_PATH_ENV]:
      input.env[HEALTHYBOB_DEVICE_SYNC_STATE_DB_PATH_ENV]?.trim() ||
      input.paths.stateDbPath,
  }
}

function buildDeviceDaemonStatusResult(input: {
  vault: string
  paths: DeviceDaemonPaths
  baseUrl: string
  state: DeviceDaemonStateRecord | null
  managed: boolean
  running: boolean
  healthy: boolean
  message: string | null
}): DeviceDaemonStatusResult {
  return {
    baseUrl: input.baseUrl,
    statePath: relativeToVault(input.vault, input.paths.launcherStatePath),
    stdoutLogPath: relativeToVault(input.vault, input.paths.stdoutLogPath),
    stderrLogPath: relativeToVault(input.vault, input.paths.stderrLogPath),
    managed: input.managed,
    running: input.running,
    healthy: input.healthy,
    pid: input.state?.pid ?? null,
    startedAt: input.state?.startedAt ?? null,
    message: input.message,
  }
}

function buildDeviceDaemonStartResult(
  input: Parameters<typeof buildDeviceDaemonStatusResult>[0] & {
    started: boolean
  },
): DeviceDaemonStartResult {
  return {
    ...buildDeviceDaemonStatusResult(input),
    started: input.started,
  }
}

function buildDeviceDaemonStopResult(
  input: Parameters<typeof buildDeviceDaemonStatusResult>[0] & {
    stopped: boolean
  },
): DeviceDaemonStopResult {
  return {
    ...buildDeviceDaemonStatusResult(input),
    stopped: input.stopped,
  }
}

function relativeToVault(vaultRoot: string, targetPath: string): string {
  const relativePath = path.relative(path.resolve(vaultRoot), targetPath)
  return relativePath.length > 0 ? relativePath : '.'
}

function defaultIsProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function defaultSpawnDeviceDaemonProcess(input: {
  command: string
  args: string[]
  env: NodeJS.ProcessEnv
  stdoutPath: string
  stderrPath: string
}): Promise<{ pid: number }> {
  await mkdir(path.dirname(input.stdoutPath), { recursive: true })
  const stdoutFd = openSync(input.stdoutPath, 'a')
  const stderrFd = openSync(input.stderrPath, 'a')

  return await new Promise((resolve, reject) => {
    try {
      const child = spawn(input.command, input.args, {
        detached: true,
        stdio: ['ignore', stdoutFd, stderrFd],
        env: input.env,
      })

      child.once('error', (error) => {
        closeSync(stdoutFd)
        closeSync(stderrFd)
        reject(error)
      })
      child.once('spawn', () => {
        child.unref()
        closeSync(stdoutFd)
        closeSync(stderrFd)
        if (!child.pid) {
          reject(new Error('Device sync daemon spawn did not yield a PID.'))
          return
        }
        resolve({ pid: child.pid })
      })
    } catch (error) {
      closeSync(stdoutFd)
      closeSync(stderrFd)
      reject(error)
    }
  })
}

async function readDeviceDaemonState(
  paths: DeviceDaemonPaths,
  dependencies: DeviceDaemonDependencies,
): Promise<DeviceDaemonStateRecord | null> {
  let text: string

  try {
    text = await dependencies.readFile(paths.launcherStatePath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw error
  }

  let parsed: unknown

  try {
    parsed = JSON.parse(text) as unknown
  } catch {
    throw new VaultCliError(
      'DEVICE_SYNC_STATE_INVALID',
      'Device sync daemon launcher state is invalid.',
    )
  }

  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    (parsed as { version?: unknown }).version !== DEVICE_DAEMON_STATE_VERSION ||
    typeof (parsed as { pid?: unknown }).pid !== 'number' ||
    !Number.isInteger((parsed as { pid: number }).pid) ||
    (parsed as { pid: number }).pid <= 0 ||
    typeof (parsed as { baseUrl?: unknown }).baseUrl !== 'string' ||
    typeof (parsed as { controlToken?: unknown }).controlToken !== 'string' ||
    typeof (parsed as { startedAt?: unknown }).startedAt !== 'string'
  ) {
    throw new VaultCliError(
      'DEVICE_SYNC_STATE_INVALID',
      'Device sync daemon launcher state is invalid.',
    )
  }

  return parsed as DeviceDaemonStateRecord
}

async function writeDeviceDaemonState(
  paths: DeviceDaemonPaths,
  state: DeviceDaemonStateRecord,
  dependencies: DeviceDaemonDependencies,
): Promise<void> {
  await dependencies.mkdir(path.dirname(paths.launcherStatePath))
  await dependencies.writeFile(
    paths.launcherStatePath,
    JSON.stringify(state, null, 2),
  )
  await dependencies.chmod(paths.launcherStatePath, 0o600)
}

function readManagedControlToken(
  vaultRoot: string,
  overrides?: DeviceDaemonDependencyOverrides,
): string | null {
  const dependencies = createDeviceDaemonDependencies(overrides)
  const paths = resolveDeviceDaemonPaths(vaultRoot)
  return resolveManagedControlToken(paths, dependencies)
}

function resolveManagedControlToken(
  paths: DeviceDaemonPaths,
  dependencies: DeviceDaemonDependencies,
): string | null {
  // Synchronous best-effort read for already-started managed daemons.
  try {
    const text = require('node:fs').readFileSync(paths.launcherStatePath, 'utf8')
    const parsed = JSON.parse(text) as Partial<DeviceDaemonStateRecord>
    return typeof parsed.controlToken === 'string' ? parsed.controlToken : null
  } catch {
    return null
  }
}

function generateDeviceSyncControlToken(): string {
  return randomBytes(24).toString('hex')
}

async function isDeviceDaemonHealthy(
  baseUrl: string,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  try {
    const response = await fetchImpl(new URL('healthz', `${baseUrl}/`), {
      signal: AbortSignal.timeout(750),
    })
    return response.ok
  } catch {
    return false
  }
}

async function waitForDeviceDaemonHealth(
  baseUrl: string,
  dependencies: DeviceDaemonDependencies,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = dependencies.now().valueOf() + timeoutMs

  while (dependencies.now().valueOf() < deadline) {
    if (await isDeviceDaemonHealthy(baseUrl, dependencies.fetchImpl)) {
      return true
    }

    await dependencies.sleep(DEVICE_DAEMON_HEALTH_POLL_MS)
  }

  return false
}

async function waitForDeviceDaemonExit(
  pid: number,
  dependencies: DeviceDaemonDependencies,
  timeoutMs: number,
): Promise<boolean> {
  const deadline = dependencies.now().valueOf() + timeoutMs

  while (dependencies.now().valueOf() < deadline) {
    if (!dependencies.isProcessAlive(pid)) {
      return true
    }

    await dependencies.sleep(DEVICE_DAEMON_HEALTH_POLL_MS)
  }

  return false
}

async function readRecentDeviceDaemonLog(
  logPath: string,
  dependencies: DeviceDaemonDependencies,
): Promise<string | null> {
  try {
    const text = await dependencies.readFile(logPath)
    const lines = text
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)

    if (lines.length === 0) {
      return null
    }

    return lines.slice(-4).join(' ')
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw error
  }
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
