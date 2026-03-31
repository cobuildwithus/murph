import { createRequire } from 'node:module'
import path from 'node:path'
import { URL } from 'node:url'
import {
  DEVICE_SYNC_CONTROL_TOKEN_ENV,
  DEVICE_SYNC_SECRET_ENV,
  DEVICE_SYNC_SECRET_ENV_KEYS,
  resolveDeviceSyncRuntimePaths,
} from '@murph/runtime-state'
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
  return require.resolve('@murph/device-syncd')
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
    readEnvValue(input.env, DEVICE_SYNC_HOST_ENV_KEYS) ||
    normalizedBaseUrl.hostname

  return {
    ...input.env,
    VAULT_ROOT: input.vault,
    DEVICE_SYNC_VAULT_ROOT: input.vault,
    [DEVICE_SYNC_PUBLIC_BASE_URL_ENV]:
      readEnvValue(input.env, DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS) ||
      input.baseUrl,
    // device-syncd still needs a stable service secret for local token
    // encryption, so managed launches seed DEVICE_SYNC_SECRET from the
    // operator-provided secret when available and otherwise reuse the managed
    // control token value.
    [DEVICE_SYNC_SECRET_ENV]:
      readEnvValue(input.env, DEVICE_SYNC_SECRET_ENV_KEYS) ||
      input.controlToken,
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
