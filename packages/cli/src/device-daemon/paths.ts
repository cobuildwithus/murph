import { createRequire } from 'node:module'
import path from 'node:path'
import { URL } from 'node:url'
import { resolveDeviceSyncRuntimePaths } from '@healthybob/runtime-state'
import { HEALTHYBOB_DEVICE_SYNC_CONTROL_TOKEN_ENV } from '../device-sync-client.js'
import {
  HEALTHYBOB_DEVICE_SYNC_HOST_ENV,
  HEALTHYBOB_DEVICE_SYNC_PORT_ENV,
  HEALTHYBOB_DEVICE_SYNC_PUBLIC_BASE_URL_ENV,
  HEALTHYBOB_DEVICE_SYNC_SECRET_ENV,
  HEALTHYBOB_DEVICE_SYNC_STATE_DB_PATH_ENV,
  type DeviceDaemonDependencies,
  type DeviceDaemonPaths,
} from './types.js'

const require = createRequire(import.meta.url)

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
  return require.resolve('@healthybob/device-syncd')
}

export function buildManagedDeviceSyncEnvironment(input: {
  vault: string
  baseUrl: string
  controlToken: string
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
    input.env[HEALTHYBOB_DEVICE_SYNC_HOST_ENV]?.trim() ||
    (normalizedBaseUrl.hostname === 'localhost'
      ? '127.0.0.1'
      : normalizedBaseUrl.hostname)

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
