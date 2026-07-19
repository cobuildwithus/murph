import { createRequire } from 'node:module'
import path from 'node:path'
import { URL } from 'node:url'
import {
  DEVICE_SYNC_CONTROL_TOKEN_ENV,
  DEVICE_SYNC_SECRET_ENV,
} from '@murphai/device-syncd/client'
import {
  isLoopbackHostname,
  resolveDeviceSyncRuntimePaths,
} from '@murphai/runtime-state/node'
import {
  DEVICE_SYNC_HOST_ENV,
  DEVICE_SYNC_HOST_ENV_KEYS,
  DEVICE_SYNC_PORT_ENV,
  DEVICE_SYNC_PORT_ENV_KEYS,
  DEVICE_SYNC_PUBLIC_BASE_URL_ENV,
  DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS,
  DEVICE_SYNC_STATE_DB_PATH_ENV,
  DEVICE_SYNC_STATE_DB_PATH_ENV_KEYS,
  type DeviceDaemonDependencies,
  type DeviceDaemonPaths,
} from './types.js'
import { readEnvValue } from '../env-values.js'
import { VaultCliError } from '../vault-cli-errors.js'

export function requireManagedDeviceSyncVaultRoot(
  vault: string | null | undefined,
): string {
  if (typeof vault === 'string' && vault.trim().length > 0) {
    return vault.trim()
  }

  throw new VaultCliError(
    'DEVICE_SYNC_VAULT_REQUIRED',
    'Device sync daemon management needs a vault path. Pass `--vault <path>` or configure a default Murph vault first.',
  )
}

export function assertManagedDeviceSyncLoopbackBaseUrl(baseUrl: string): void {
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

export function resolveDeviceDaemonPaths(vaultRoot: string): DeviceDaemonPaths {
  const runtimePaths = resolveDeviceSyncRuntimePaths(vaultRoot)

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    launcherStatePath: runtimePaths.deviceSyncLauncherStatePath,
    stdoutLogPath: runtimePaths.deviceSyncStdoutLogPath,
    stderrLogPath: runtimePaths.deviceSyncStderrLogPath,
    stateDbPath: runtimePaths.deviceSyncDbPath,
  }
}

export function resolveDeviceSyncDaemonBinPath(
  dependencies: Pick<DeviceDaemonDependencies, 'resolveDeviceSyncPackageEntry'>,
): string {
  return path.join(
    path.dirname(dependencies.resolveDeviceSyncPackageEntry()),
    'bin.js',
  )
}

export function resolveInstalledDeviceSyncPackageEntry(): string {
  try {
    return createPackageScopedRequire('../../package.json').resolve(
      '@murphai/device-syncd',
    )
  } catch (error) {
    if (!isMissingDeviceSyncPackageError(error)) {
      throw error
    }

    return createPackageScopedRequire('../../../../package.json').resolve(
      '@murphai/device-syncd',
    )
  }
}

function createPackageScopedRequire(relativePackageJsonPath: string): NodeJS.Require {
  const moduleUrl =
    typeof import.meta.url === 'string' && import.meta.url.length > 0
      ? import.meta.url
      : null

  if (moduleUrl !== null) {
    try {
      return createRequire(new URL(relativePackageJsonPath, moduleUrl))
    } catch (error) {
      if (!isInvalidCreateRequirePathError(error)) {
        throw error
      }
    }
  }

  if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
    return createRequire(path.join(process.cwd(), 'package.json'))
  }

  throw new TypeError(
    'Unable to resolve a package root for @murphai/device-syncd.',
  )
}

function isInvalidCreateRequirePathError(error: unknown): boolean {
  return (
    error instanceof TypeError &&
    error.message.includes(
      "The argument must be a file URL object, a file URL string, or an absolute path string.",
    )
  )
}

function isMissingDeviceSyncPackageError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'object' &&
          error &&
          'message' in error &&
          typeof (error as { message?: unknown }).message === 'string'
        ? (error as { message: string }).message
        : null

  return Boolean(
    message?.includes("Cannot find module '@murphai/device-syncd'") &&
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: unknown }).code === 'MODULE_NOT_FOUND',
  )
}

export function buildManagedDeviceSyncEnvironment(input: {
  vault: string
  baseUrl: string
  controlToken: string
  encryptionSecret: string
  env: NodeJS.ProcessEnv
  paths: DeviceDaemonPaths
}): NodeJS.ProcessEnv {
  const normalizedBaseUrl = new URL(input.baseUrl)
  const effectivePort =
    normalizedBaseUrl.port.length > 0
      ? normalizedBaseUrl.port
      : normalizedBaseUrl.protocol === 'https:'
        ? '443'
        : '80'
  const normalizedHost =
    readEnvValue(input.env, DEVICE_SYNC_HOST_ENV_KEYS) ||
    normalizedBaseUrl.hostname

  return {
    ...input.env,
    DEVICE_SYNC_VAULT_ROOT: input.vault,
    [DEVICE_SYNC_PUBLIC_BASE_URL_ENV]:
      readEnvValue(input.env, DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS) ||
      input.baseUrl,
    [DEVICE_SYNC_SECRET_ENV]: input.encryptionSecret,
    [DEVICE_SYNC_CONTROL_TOKEN_ENV]:
      input.env[DEVICE_SYNC_CONTROL_TOKEN_ENV]?.trim() ||
      input.controlToken,
    [DEVICE_SYNC_HOST_ENV]: normalizedHost,
    [DEVICE_SYNC_PORT_ENV]:
      readEnvValue(input.env, DEVICE_SYNC_PORT_ENV_KEYS) || effectivePort,
    [DEVICE_SYNC_STATE_DB_PATH_ENV]:
      readEnvValue(input.env, DEVICE_SYNC_STATE_DB_PATH_ENV_KEYS) ||
      input.paths.stateDbPath,
  }
}
