import { readFileSync } from 'node:fs'
import path from 'node:path'
import { toVaultRelativePath } from '@healthybob/runtime-state'
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
  await dependencies.mkdir(path.dirname(paths.launcherStatePath))
  await dependencies.writeFile(
    paths.launcherStatePath,
    JSON.stringify(state, null, 2),
  )
  await dependencies.chmod(paths.launcherStatePath, 0o600)
}

export async function writeManagedControlToken(
  paths: DeviceDaemonPaths,
  controlToken: string,
  dependencies: Pick<DeviceDaemonDependencies, 'mkdir' | 'writeFile' | 'chmod'>,
): Promise<void> {
  const controlTokenPath = resolveManagedControlTokenPath(paths)
  await dependencies.mkdir(path.dirname(controlTokenPath))
  await dependencies.writeFile(controlTokenPath, `${controlToken}\n`)
  await dependencies.chmod(controlTokenPath, 0o600)
}

export async function removeManagedControlToken(
  paths: DeviceDaemonPaths,
  dependencies: Pick<DeviceDaemonDependencies, 'removeFile'>,
): Promise<void> {
  await dependencies.removeFile(resolveManagedControlTokenPath(paths))
}

export async function migrateLegacyManagedControlToken(
  paths: DeviceDaemonPaths,
  state: DeviceDaemonStateRecord,
  dependencies: Pick<
    DeviceDaemonDependencies,
    'readFile' | 'mkdir' | 'writeFile' | 'chmod'
  >,
): Promise<void> {
  let text: string

  try {
    text = await dependencies.readFile(paths.launcherStatePath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return
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

  const legacyControlToken =
    parsed &&
    typeof parsed === 'object' &&
    !Array.isArray(parsed) &&
    typeof (parsed as { controlToken?: unknown }).controlToken === 'string'
      ? (parsed as { controlToken: string }).controlToken
      : null

  if (!legacyControlToken) {
    return
  }

  await writeManagedControlToken(paths, legacyControlToken, dependencies)
  await writeDeviceDaemonState(paths, state, dependencies)
}

export function resolveManagedControlToken(paths: DeviceDaemonPaths): string | null {
  try {
    return readFileSync(resolveManagedControlTokenPath(paths), 'utf8').trim() || null
  } catch {
    try {
      const text = readFileSync(paths.launcherStatePath, 'utf8')
      const parsed = JSON.parse(text) as Partial<DeviceDaemonStateRecord> & {
        controlToken?: unknown
      }
      return typeof parsed.controlToken === 'string' ? parsed.controlToken : null
    } catch {
      return null
    }
  }
}

function resolveManagedControlTokenPath(paths: DeviceDaemonPaths): string {
  return path.join(path.dirname(paths.launcherStatePath), MANAGED_CONTROL_TOKEN_FILE_NAME)
}
