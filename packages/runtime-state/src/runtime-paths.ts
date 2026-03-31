import path from "node:path";

export const RUNTIME_ROOT_RELATIVE_PATH = ".runtime";
export const SEARCH_DB_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/search.sqlite`;
export const INBOX_DB_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/inboxd.sqlite`;
export const INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/inboxd`;
export const INBOX_CONFIG_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/config.json`;
export const INBOX_STATE_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/state.json`;
export const INBOX_PROMOTIONS_RELATIVE_PATH =
  `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/promotions.json`;
export const DEVICE_SYNC_DB_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/device-syncd.sqlite`;
export const GATEWAY_DB_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/gateway.sqlite`;
export const DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH =
  `${RUNTIME_ROOT_RELATIVE_PATH}/device-syncd`;
export const DEVICE_SYNC_LAUNCHER_STATE_RELATIVE_PATH =
  `${DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH}/launcher.json`;
export const DEVICE_SYNC_STDOUT_LOG_RELATIVE_PATH =
  `${DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH}/stdout.log`;
export const DEVICE_SYNC_STDERR_LOG_RELATIVE_PATH =
  `${DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH}/stderr.log`;

export interface RuntimePaths {
  absoluteVaultRoot: string;
  runtimeRoot: string;
  searchDbPath: string;
  inboxDbPath: string;
  inboxRuntimeRoot: string;
  inboxConfigPath: string;
  inboxStatePath: string;
  inboxPromotionsPath: string;
  deviceSyncDbPath: string;
  gatewayDbPath: string;
  deviceSyncRuntimeRoot: string;
  deviceSyncLauncherStatePath: string;
  deviceSyncStdoutLogPath: string;
  deviceSyncStderrLogPath: string;
}

export type InboxRuntimePaths = Pick<
  RuntimePaths,
  | "absoluteVaultRoot"
  | "runtimeRoot"
  | "inboxDbPath"
  | "inboxRuntimeRoot"
  | "inboxConfigPath"
  | "inboxStatePath"
  | "inboxPromotionsPath"
>;

export type DeviceSyncRuntimePaths = Pick<
  RuntimePaths,
  | "absoluteVaultRoot"
  | "runtimeRoot"
  | "deviceSyncDbPath"
  | "deviceSyncRuntimeRoot"
  | "deviceSyncLauncherStatePath"
  | "deviceSyncStdoutLogPath"
  | "deviceSyncStderrLogPath"
>;

export type GatewayRuntimePaths = Pick<
  RuntimePaths,
  | "absoluteVaultRoot"
  | "runtimeRoot"
  | "gatewayDbPath"
>;

export function resolveRuntimePaths(vaultRoot: string): RuntimePaths {
  const absoluteVaultRoot = path.resolve(vaultRoot);
  const runtimeRoot = path.join(absoluteVaultRoot, RUNTIME_ROOT_RELATIVE_PATH);
  const inboxRuntimeRoot = path.join(absoluteVaultRoot, INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH);
  const deviceSyncRuntimeRoot = path.join(
    absoluteVaultRoot,
    DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH,
  );

  return {
    absoluteVaultRoot,
    runtimeRoot,
    searchDbPath: path.join(absoluteVaultRoot, SEARCH_DB_RELATIVE_PATH),
    inboxDbPath: path.join(absoluteVaultRoot, INBOX_DB_RELATIVE_PATH),
    inboxRuntimeRoot,
    inboxConfigPath: path.join(absoluteVaultRoot, INBOX_CONFIG_RELATIVE_PATH),
    inboxStatePath: path.join(absoluteVaultRoot, INBOX_STATE_RELATIVE_PATH),
    inboxPromotionsPath: path.join(absoluteVaultRoot, INBOX_PROMOTIONS_RELATIVE_PATH),
    deviceSyncDbPath: path.join(absoluteVaultRoot, DEVICE_SYNC_DB_RELATIVE_PATH),
    gatewayDbPath: path.join(absoluteVaultRoot, GATEWAY_DB_RELATIVE_PATH),
    deviceSyncRuntimeRoot,
    deviceSyncLauncherStatePath: path.join(
      absoluteVaultRoot,
      DEVICE_SYNC_LAUNCHER_STATE_RELATIVE_PATH,
    ),
    deviceSyncStdoutLogPath: path.join(
      absoluteVaultRoot,
      DEVICE_SYNC_STDOUT_LOG_RELATIVE_PATH,
    ),
    deviceSyncStderrLogPath: path.join(
      absoluteVaultRoot,
      DEVICE_SYNC_STDERR_LOG_RELATIVE_PATH,
    ),
  };
}

export function resolveGatewayRuntimePaths(vaultRoot: string): GatewayRuntimePaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    runtimeRoot: runtimePaths.runtimeRoot,
    gatewayDbPath: runtimePaths.gatewayDbPath,
  };
}

export function resolveInboxRuntimePaths(vaultRoot: string): InboxRuntimePaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    runtimeRoot: runtimePaths.runtimeRoot,
    inboxDbPath: runtimePaths.inboxDbPath,
    inboxRuntimeRoot: runtimePaths.inboxRuntimeRoot,
    inboxConfigPath: runtimePaths.inboxConfigPath,
    inboxStatePath: runtimePaths.inboxStatePath,
    inboxPromotionsPath: runtimePaths.inboxPromotionsPath,
  };
}

export function resolveDeviceSyncRuntimePaths(vaultRoot: string): DeviceSyncRuntimePaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    runtimeRoot: runtimePaths.runtimeRoot,
    deviceSyncDbPath: runtimePaths.deviceSyncDbPath,
    deviceSyncRuntimeRoot: runtimePaths.deviceSyncRuntimeRoot,
    deviceSyncLauncherStatePath: runtimePaths.deviceSyncLauncherStatePath,
    deviceSyncStdoutLogPath: runtimePaths.deviceSyncStdoutLogPath,
    deviceSyncStderrLogPath: runtimePaths.deviceSyncStderrLogPath,
  };
}
