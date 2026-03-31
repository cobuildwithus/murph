export const DEVICE_DAEMON_START_TIMEOUT_MS = 5_000
export const DEVICE_DAEMON_STOP_TIMEOUT_MS = 5_000
export const DEVICE_DAEMON_HEALTH_POLL_MS = 100
export const DEVICE_DAEMON_STATE_VERSION = 1
export const DEVICE_SYNC_PUBLIC_BASE_URL_ENV =
  'DEVICE_SYNC_PUBLIC_BASE_URL'
export const DEVICE_SYNC_PUBLIC_BASE_URL_ENV_KEYS = [
  DEVICE_SYNC_PUBLIC_BASE_URL_ENV,
] as const
export const DEVICE_SYNC_HOST_ENV = 'DEVICE_SYNC_HOST'
export const DEVICE_SYNC_HOST_ENV_KEYS = [
  DEVICE_SYNC_HOST_ENV,
] as const
export const DEVICE_SYNC_PORT_ENV = 'DEVICE_SYNC_PORT'
export const DEVICE_SYNC_PORT_ENV_KEYS = [
  DEVICE_SYNC_PORT_ENV,
] as const
export const DEVICE_SYNC_STATE_DB_PATH_ENV =
  'DEVICE_SYNC_STATE_DB_PATH'
export const DEVICE_SYNC_STATE_DB_PATH_ENV_KEYS = [
  DEVICE_SYNC_STATE_DB_PATH_ENV,
] as const

export interface DeviceDaemonStateRecord {
  version: number
  pid: number
  baseUrl: string
  startedAt: string
}

export interface DeviceDaemonPaths {
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

export interface DeviceDaemonDependencies {
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

export type DeviceDaemonDependencyOverrides = Partial<DeviceDaemonDependencies>
