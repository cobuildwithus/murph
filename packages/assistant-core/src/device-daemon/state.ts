import { readFileSync } from 'node:fs'
import path from 'node:path'
import {
  toVaultRelativePath,
} from '@murphai/runtime-state/node'
import { VaultCliError } from '../vault-cli-errors.js'
import type {
  DeviceDaemonDependencies,
  DeviceDaemonPaths,
  DeviceDaemonStartResult,
  DeviceDaemonStateRecord,
  DeviceDaemonStatusResult,
  DeviceDaemonStopResult,
} from './types.js'
import { DEVICE_DAEMON_STATE_VERSION } from './types.js'
import { isMissingFileError } from './process.js'

const MANAGED_CONTROL_TOKEN_FILE_NAME = 'control-token'
const DEVICE_DAEMON_RUNTIME_DIRECTORY_MODE = 0o700
const DEVICE_DAEMON_RUNTIME_FILE_MODE = 0o600

export function buildDeviceDaemonStatusResult(input: {
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
    statePath: toVaultRelativePath(input.vault, input.paths.launcherStatePath),
    stdoutLogPath: toVaultRelativePath(input.vault, input.paths.stdoutLogPath),
    stderrLogPath: toVaultRelativePath(input.vault, input.paths.stderrLogPath),
    managed: input.managed,
    running: input.running,
    healthy: input.healthy,
    pid: input.state?.pid ?? null,
    startedAt: input.state?.startedAt ?? null,
    message: input.message,
  }
}

export function buildDeviceDaemonStartResult(
  input: Parameters<typeof buildDeviceDaemonStatusResult>[0] & {
    started: boolean
  },
): DeviceDaemonStartResult {
  return {
    ...buildDeviceDaemonStatusResult(input),
    started: input.started,
  }
}

export function buildDeviceDaemonStopResult(
  input: Parameters<typeof buildDeviceDaemonStatusResult>[0] & {
    stopped: boolean
  },
): DeviceDaemonStopResult {
  return {
    ...buildDeviceDaemonStatusResult(input),
    stopped: input.stopped,
  }
}

export async function readDeviceDaemonState(
  paths: DeviceDaemonPaths,
  dependencies: Pick<DeviceDaemonDependencies, 'readFile'>,
): Promise<DeviceDaemonStateRecord | null> {
  let text: string

  try {
    text = await dependencies.readFile(paths.launcherStatePath)
  } catch (error) {
    if (!isMissingFileError(error)) {
      throw error
    }
    return null
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
    typeof (parsed as { startedAt?: unknown }).startedAt !== 'string'
  ) {
    throw new VaultCliError(
      'DEVICE_SYNC_STATE_INVALID',
      'Device sync daemon launcher state is invalid.',
    )
  }

  const state = parsed as {
    version: number
    pid: number
    baseUrl: string
    startedAt: string
  }

  return {
    version: state.version,
    pid: state.pid,
    baseUrl: state.baseUrl,
    startedAt: state.startedAt,
  }
}

export async function writeDeviceDaemonState(
  paths: DeviceDaemonPaths,
  state: DeviceDaemonStateRecord,
  dependencies: Pick<DeviceDaemonDependencies, 'mkdir' | 'writeFile' | 'chmod'>,
): Promise<void> {
  await ensurePrivateDeviceDaemonDirectory(
    path.dirname(paths.launcherStatePath),
    dependencies,
  )
  await dependencies.writeFile(
    paths.launcherStatePath,
    JSON.stringify(state, null, 2),
  )
  await dependencies.chmod(paths.launcherStatePath, DEVICE_DAEMON_RUNTIME_FILE_MODE)
}

export async function writeManagedControlToken(
  paths: DeviceDaemonPaths,
  controlToken: string,
  dependencies: Pick<DeviceDaemonDependencies, 'mkdir' | 'writeFile' | 'chmod'>,
): Promise<void> {
  const controlTokenPath = resolveManagedControlTokenPath(paths)
  await ensurePrivateDeviceDaemonDirectory(
    path.dirname(controlTokenPath),
    dependencies,
  )
  await dependencies.writeFile(controlTokenPath, `${controlToken}\n`)
  await dependencies.chmod(controlTokenPath, DEVICE_DAEMON_RUNTIME_FILE_MODE)
}

export async function removeManagedControlToken(
  paths: DeviceDaemonPaths,
  dependencies: Pick<DeviceDaemonDependencies, 'removeFile'>,
): Promise<void> {
  await dependencies.removeFile(resolveManagedControlTokenPath(paths)).catch(() => undefined)
}

export function resolveManagedControlToken(paths: DeviceDaemonPaths): string | null {
  try {
    return readFileSync(resolveManagedControlTokenPath(paths), 'utf8').trim() || null
  } catch {
    return null
  }
}

function resolveManagedControlTokenPath(paths: DeviceDaemonPaths): string {
  return path.join(path.dirname(paths.launcherStatePath), MANAGED_CONTROL_TOKEN_FILE_NAME)
}

async function ensurePrivateDeviceDaemonDirectory(
  directoryPath: string,
  dependencies: Pick<DeviceDaemonDependencies, 'mkdir' | 'chmod'>,
): Promise<void> {
  await dependencies.mkdir(directoryPath)
  await dependencies.chmod(directoryPath, DEVICE_DAEMON_RUNTIME_DIRECTORY_MODE)
}
