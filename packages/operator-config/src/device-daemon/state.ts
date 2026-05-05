import { chmodSync, lstatSync, readFileSync } from 'node:fs'
import path from 'node:path'
import {
  readVersionedJsonStateFile,
  toVaultRelativePath,
  writeVersionedJsonStateFile,
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
import {
  DEVICE_DAEMON_STATE_SCHEMA,
  DEVICE_DAEMON_STATE_SCHEMA_VERSION,
} from './types.js'
import { isMissingFileError } from './process.js'

const MANAGED_CONTROL_TOKEN_FILE_NAME = 'control-token'
const MANAGED_ENCRYPTION_SECRET_FILE_NAME = 'encryption-secret'
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
  try {
    const { value } = await readVersionedJsonStateFile(
      {
        currentPath: paths.launcherStatePath,
        label: 'Device sync daemon launcher state',
        parseValue(value) {
          return parseDeviceDaemonStateRecord(value)
        },
        schema: DEVICE_DAEMON_STATE_SCHEMA,
        schemaVersion: DEVICE_DAEMON_STATE_SCHEMA_VERSION,
      },
      dependencies,
    )
    return value
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw new VaultCliError(
      'DEVICE_SYNC_STATE_INVALID',
      'Device sync daemon launcher state is invalid.',
    )
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
  await writeVersionedJsonStateFile(
    {
      filePath: paths.launcherStatePath,
      mode: DEVICE_DAEMON_RUNTIME_FILE_MODE,
      schema: DEVICE_DAEMON_STATE_SCHEMA,
      schemaVersion: DEVICE_DAEMON_STATE_SCHEMA_VERSION,
      value: parseDeviceDaemonStateRecord(state),
    },
    dependencies,
  )
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

export async function writeManagedEncryptionSecret(
  paths: DeviceDaemonPaths,
  encryptionSecret: string,
  dependencies: Pick<DeviceDaemonDependencies, 'mkdir' | 'writeFile' | 'chmod'>,
): Promise<void> {
  const encryptionSecretPath = resolveManagedEncryptionSecretPath(paths)
  await ensurePrivateDeviceDaemonDirectory(
    path.dirname(encryptionSecretPath),
    dependencies,
  )
  await dependencies.writeFile(encryptionSecretPath, `${encryptionSecret}\n`)
  await dependencies.chmod(encryptionSecretPath, DEVICE_DAEMON_RUNTIME_FILE_MODE)
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

export function resolveManagedEncryptionSecret(paths: DeviceDaemonPaths): string | null {
  const encryptionSecretPath = resolveManagedEncryptionSecretPath(paths)
  try {
    ensurePrivateManagedEncryptionSecretPath(encryptionSecretPath)
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw normalizeManagedEncryptionSecretError(error)
  }

  try {
    const secret = readFileSync(encryptionSecretPath, 'utf8').trim()
    if (secret.length === 0) {
      throw new VaultCliError(
        'DEVICE_SYNC_SECRET_INVALID',
        'Managed device sync encryption secret is empty.',
      )
    }
    return secret
  } catch (error) {
    if (isMissingFileError(error)) {
      return null
    }

    throw normalizeManagedEncryptionSecretError(error)
  }
}

function resolveManagedControlTokenPath(paths: DeviceDaemonPaths): string {
  return path.join(path.dirname(paths.launcherStatePath), MANAGED_CONTROL_TOKEN_FILE_NAME)
}

function resolveManagedEncryptionSecretPath(paths: DeviceDaemonPaths): string {
  return path.join(path.dirname(paths.launcherStatePath), MANAGED_ENCRYPTION_SECRET_FILE_NAME)
}

function ensurePrivateManagedEncryptionSecretPath(encryptionSecretPath: string): void {
  const directoryPath = path.dirname(encryptionSecretPath)
  const directoryStats = lstatSync(directoryPath)
  if (!directoryStats.isDirectory() || directoryStats.isSymbolicLink()) {
    throw new VaultCliError(
      'DEVICE_SYNC_SECRET_INVALID',
      'Managed device sync encryption secret directory is invalid.',
    )
  }
  if ((directoryStats.mode & 0o777) !== DEVICE_DAEMON_RUNTIME_DIRECTORY_MODE) {
    chmodSync(directoryPath, DEVICE_DAEMON_RUNTIME_DIRECTORY_MODE)
  }

  const secretStats = lstatSync(encryptionSecretPath)
  if (!secretStats.isFile() || secretStats.isSymbolicLink()) {
    throw new VaultCliError(
      'DEVICE_SYNC_SECRET_INVALID',
      'Managed device sync encryption secret file is invalid.',
    )
  }

  if ((secretStats.mode & 0o777) !== DEVICE_DAEMON_RUNTIME_FILE_MODE) {
    chmodSync(encryptionSecretPath, DEVICE_DAEMON_RUNTIME_FILE_MODE)
  }
}

function normalizeManagedEncryptionSecretError(error: unknown): Error {
  if (error instanceof VaultCliError) {
    return error
  }

  return new VaultCliError(
    'DEVICE_SYNC_SECRET_INVALID',
    'Managed device sync encryption secret is invalid or unavailable.',
  )
}

function parseDeviceDaemonStateRecord(value: unknown): DeviceDaemonStateRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Device sync daemon launcher state must be an object.')
  }

  const pid = (value as { pid?: unknown }).pid
  if (typeof pid !== 'number' || !Number.isInteger(pid) || pid <= 0) {
    throw new TypeError('Device sync daemon launcher state pid must be a positive integer.')
  }

  const baseUrl = (value as { baseUrl?: unknown }).baseUrl
  if (typeof baseUrl !== 'string' || baseUrl.trim().length === 0) {
    throw new TypeError('Device sync daemon launcher state baseUrl must be a string.')
  }

  const startedAt = (value as { startedAt?: unknown }).startedAt
  if (typeof startedAt !== 'string' || startedAt.trim().length === 0) {
    throw new TypeError('Device sync daemon launcher state startedAt must be a string.')
  }

  return {
    pid,
    baseUrl,
    startedAt,
  }
}

async function ensurePrivateDeviceDaemonDirectory(
  directoryPath: string,
  dependencies: Pick<DeviceDaemonDependencies, 'mkdir' | 'chmod'>,
): Promise<void> {
  await dependencies.mkdir(directoryPath)
  await dependencies.chmod(directoryPath, DEVICE_DAEMON_RUNTIME_DIRECTORY_MODE)
}
