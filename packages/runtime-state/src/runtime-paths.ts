import path from "node:path";

import {
  RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH,
  RUNTIME_PROJECTION_ROOT_RELATIVE_PATH,
  RUNTIME_ROOT_RELATIVE_PATH,
  RUNTIME_CACHE_ROOT_RELATIVE_PATH,
  RUNTIME_TEMP_ROOT_RELATIVE_PATH,
} from "./local-state-taxonomy.ts";

export {
  RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH,
  RUNTIME_PROJECTION_ROOT_RELATIVE_PATH,
  RUNTIME_ROOT_RELATIVE_PATH,
  RUNTIME_CACHE_ROOT_RELATIVE_PATH,
  RUNTIME_TEMP_ROOT_RELATIVE_PATH,
} from "./local-state-taxonomy.ts";

export const SEARCH_DB_RELATIVE_PATH = `${RUNTIME_PROJECTION_ROOT_RELATIVE_PATH}/search.sqlite`;
export const SEARCH_DB_LEGACY_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/search.sqlite`;
export const INBOX_DB_RELATIVE_PATH = `${RUNTIME_PROJECTION_ROOT_RELATIVE_PATH}/inboxd.sqlite`;
export const INBOX_DB_LEGACY_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/inboxd.sqlite`;
export const INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/inbox`;
export const INBOX_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/inboxd`;
export const INBOX_CONFIG_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/config.json`;
export const INBOX_CONFIG_LEGACY_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH}/config.json`;
export const INBOX_STATE_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/state.json`;
export const INBOX_STATE_LEGACY_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH}/state.json`;
export const INBOX_PROMOTIONS_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/promotions.json`;
export const INBOX_PROMOTIONS_LEGACY_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH}/promotions.json`;
export const DEVICE_SYNC_DB_RELATIVE_PATH = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/device-sync/state.sqlite`;
export const DEVICE_SYNC_DB_LEGACY_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/device-syncd.sqlite`;
export const GATEWAY_DB_RELATIVE_PATH = `${RUNTIME_PROJECTION_ROOT_RELATIVE_PATH}/gateway.sqlite`;
export const GATEWAY_DB_LEGACY_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/gateway.sqlite`;
export const DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/device-sync`;
export const DEVICE_SYNC_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/device-syncd`;
export const DEVICE_SYNC_LAUNCHER_STATE_RELATIVE_PATH = `${DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH}/launcher.json`;
export const DEVICE_SYNC_LAUNCHER_STATE_LEGACY_RELATIVE_PATH = `${DEVICE_SYNC_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH}/launcher.json`;
export const DEVICE_SYNC_STDOUT_LOG_RELATIVE_PATH = `${DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH}/stdout.log`;
export const DEVICE_SYNC_STDOUT_LOG_LEGACY_RELATIVE_PATH = `${DEVICE_SYNC_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH}/stdout.log`;
export const DEVICE_SYNC_STDERR_LOG_RELATIVE_PATH = `${DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH}/stderr.log`;
export const DEVICE_SYNC_STDERR_LOG_LEGACY_RELATIVE_PATH = `${DEVICE_SYNC_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH}/stderr.log`;
export const PARSER_RUNTIME_DIRECTORY_RELATIVE_PATH = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/parsers`;
export const PARSER_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH = `${RUNTIME_ROOT_RELATIVE_PATH}/parsers`;
export const PARSER_TOOLCHAIN_CONFIG_RELATIVE_PATH = `${PARSER_RUNTIME_DIRECTORY_RELATIVE_PATH}/toolchain.json`;
export const PARSER_TOOLCHAIN_CONFIG_LEGACY_RELATIVE_PATH = `${PARSER_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH}/toolchain.json`;

export interface RuntimePaths {
  absoluteVaultRoot: string;
  runtimeRoot: string;
  operationalRoot: string;
  projectionsRoot: string;
  cacheRoot: string;
  tempRoot: string;
  searchDbPath: string;
  searchDbLegacyPath: string;
  inboxDbPath: string;
  inboxDbLegacyPath: string;
  inboxRuntimeRoot: string;
  inboxRuntimeLegacyRoot: string;
  inboxConfigPath: string;
  inboxConfigLegacyPath: string;
  inboxStatePath: string;
  inboxStateLegacyPath: string;
  inboxPromotionsPath: string;
  inboxPromotionsLegacyPath: string;
  deviceSyncDbPath: string;
  deviceSyncDbLegacyPath: string;
  gatewayDbPath: string;
  gatewayDbLegacyPath: string;
  deviceSyncRuntimeRoot: string;
  deviceSyncRuntimeLegacyRoot: string;
  deviceSyncLauncherStatePath: string;
  deviceSyncLauncherStateLegacyPath: string;
  deviceSyncStdoutLogPath: string;
  deviceSyncStdoutLogLegacyPath: string;
  deviceSyncStderrLogPath: string;
  deviceSyncStderrLogLegacyPath: string;
  parserRuntimeRoot: string;
  parserRuntimeLegacyRoot: string;
  parserToolchainConfigPath: string;
  parserToolchainConfigLegacyPath: string;
}

export type InboxRuntimePaths = Pick<
  RuntimePaths,
  | "absoluteVaultRoot"
  | "runtimeRoot"
  | "operationalRoot"
  | "projectionsRoot"
  | "inboxDbPath"
  | "inboxDbLegacyPath"
  | "inboxRuntimeRoot"
  | "inboxRuntimeLegacyRoot"
  | "inboxConfigPath"
  | "inboxConfigLegacyPath"
  | "inboxStatePath"
  | "inboxStateLegacyPath"
  | "inboxPromotionsPath"
  | "inboxPromotionsLegacyPath"
>;

export type DeviceSyncRuntimePaths = Pick<
  RuntimePaths,
  | "absoluteVaultRoot"
  | "runtimeRoot"
  | "operationalRoot"
  | "deviceSyncDbPath"
  | "deviceSyncDbLegacyPath"
  | "deviceSyncRuntimeRoot"
  | "deviceSyncRuntimeLegacyRoot"
  | "deviceSyncLauncherStatePath"
  | "deviceSyncLauncherStateLegacyPath"
  | "deviceSyncStdoutLogPath"
  | "deviceSyncStdoutLogLegacyPath"
  | "deviceSyncStderrLogPath"
  | "deviceSyncStderrLogLegacyPath"
>;

export type GatewayRuntimePaths = Pick<
  RuntimePaths,
  | "absoluteVaultRoot"
  | "runtimeRoot"
  | "projectionsRoot"
  | "gatewayDbPath"
  | "gatewayDbLegacyPath"
>;

export type ParserRuntimePaths = Pick<
  RuntimePaths,
  | "absoluteVaultRoot"
  | "runtimeRoot"
  | "operationalRoot"
  | "parserRuntimeRoot"
  | "parserRuntimeLegacyRoot"
  | "parserToolchainConfigPath"
  | "parserToolchainConfigLegacyPath"
>;

export function resolveRuntimePaths(vaultRoot: string): RuntimePaths {
  const absoluteVaultRoot = path.resolve(vaultRoot);
  const runtimeRoot = path.join(absoluteVaultRoot, RUNTIME_ROOT_RELATIVE_PATH);
  const operationalRoot = path.join(absoluteVaultRoot, RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH);
  const projectionsRoot = path.join(absoluteVaultRoot, RUNTIME_PROJECTION_ROOT_RELATIVE_PATH);

  return {
    absoluteVaultRoot,
    runtimeRoot,
    operationalRoot,
    projectionsRoot,
    cacheRoot: path.join(absoluteVaultRoot, RUNTIME_CACHE_ROOT_RELATIVE_PATH),
    tempRoot: path.join(absoluteVaultRoot, RUNTIME_TEMP_ROOT_RELATIVE_PATH),
    searchDbPath: path.join(absoluteVaultRoot, SEARCH_DB_RELATIVE_PATH),
    searchDbLegacyPath: path.join(absoluteVaultRoot, SEARCH_DB_LEGACY_RELATIVE_PATH),
    inboxDbPath: path.join(absoluteVaultRoot, INBOX_DB_RELATIVE_PATH),
    inboxDbLegacyPath: path.join(absoluteVaultRoot, INBOX_DB_LEGACY_RELATIVE_PATH),
    inboxRuntimeRoot: path.join(absoluteVaultRoot, INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH),
    inboxRuntimeLegacyRoot: path.join(absoluteVaultRoot, INBOX_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH),
    inboxConfigPath: path.join(absoluteVaultRoot, INBOX_CONFIG_RELATIVE_PATH),
    inboxConfigLegacyPath: path.join(absoluteVaultRoot, INBOX_CONFIG_LEGACY_RELATIVE_PATH),
    inboxStatePath: path.join(absoluteVaultRoot, INBOX_STATE_RELATIVE_PATH),
    inboxStateLegacyPath: path.join(absoluteVaultRoot, INBOX_STATE_LEGACY_RELATIVE_PATH),
    inboxPromotionsPath: path.join(absoluteVaultRoot, INBOX_PROMOTIONS_RELATIVE_PATH),
    inboxPromotionsLegacyPath: path.join(absoluteVaultRoot, INBOX_PROMOTIONS_LEGACY_RELATIVE_PATH),
    deviceSyncDbPath: path.join(absoluteVaultRoot, DEVICE_SYNC_DB_RELATIVE_PATH),
    deviceSyncDbLegacyPath: path.join(absoluteVaultRoot, DEVICE_SYNC_DB_LEGACY_RELATIVE_PATH),
    gatewayDbPath: path.join(absoluteVaultRoot, GATEWAY_DB_RELATIVE_PATH),
    gatewayDbLegacyPath: path.join(absoluteVaultRoot, GATEWAY_DB_LEGACY_RELATIVE_PATH),
    deviceSyncRuntimeRoot: path.join(absoluteVaultRoot, DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH),
    deviceSyncRuntimeLegacyRoot: path.join(absoluteVaultRoot, DEVICE_SYNC_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH),
    deviceSyncLauncherStatePath: path.join(absoluteVaultRoot, DEVICE_SYNC_LAUNCHER_STATE_RELATIVE_PATH),
    deviceSyncLauncherStateLegacyPath: path.join(absoluteVaultRoot, DEVICE_SYNC_LAUNCHER_STATE_LEGACY_RELATIVE_PATH),
    deviceSyncStdoutLogPath: path.join(absoluteVaultRoot, DEVICE_SYNC_STDOUT_LOG_RELATIVE_PATH),
    deviceSyncStdoutLogLegacyPath: path.join(absoluteVaultRoot, DEVICE_SYNC_STDOUT_LOG_LEGACY_RELATIVE_PATH),
    deviceSyncStderrLogPath: path.join(absoluteVaultRoot, DEVICE_SYNC_STDERR_LOG_RELATIVE_PATH),
    deviceSyncStderrLogLegacyPath: path.join(absoluteVaultRoot, DEVICE_SYNC_STDERR_LOG_LEGACY_RELATIVE_PATH),
    parserRuntimeRoot: path.join(absoluteVaultRoot, PARSER_RUNTIME_DIRECTORY_RELATIVE_PATH),
    parserRuntimeLegacyRoot: path.join(absoluteVaultRoot, PARSER_RUNTIME_DIRECTORY_LEGACY_RELATIVE_PATH),
    parserToolchainConfigPath: path.join(absoluteVaultRoot, PARSER_TOOLCHAIN_CONFIG_RELATIVE_PATH),
    parserToolchainConfigLegacyPath: path.join(absoluteVaultRoot, PARSER_TOOLCHAIN_CONFIG_LEGACY_RELATIVE_PATH),
  };
}

export function resolveGatewayRuntimePaths(vaultRoot: string): GatewayRuntimePaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    runtimeRoot: runtimePaths.runtimeRoot,
    projectionsRoot: runtimePaths.projectionsRoot,
    gatewayDbPath: runtimePaths.gatewayDbPath,
    gatewayDbLegacyPath: runtimePaths.gatewayDbLegacyPath,
  };
}

export function resolveInboxRuntimePaths(vaultRoot: string): InboxRuntimePaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    runtimeRoot: runtimePaths.runtimeRoot,
    operationalRoot: runtimePaths.operationalRoot,
    projectionsRoot: runtimePaths.projectionsRoot,
    inboxDbPath: runtimePaths.inboxDbPath,
    inboxDbLegacyPath: runtimePaths.inboxDbLegacyPath,
    inboxRuntimeRoot: runtimePaths.inboxRuntimeRoot,
    inboxRuntimeLegacyRoot: runtimePaths.inboxRuntimeLegacyRoot,
    inboxConfigPath: runtimePaths.inboxConfigPath,
    inboxConfigLegacyPath: runtimePaths.inboxConfigLegacyPath,
    inboxStatePath: runtimePaths.inboxStatePath,
    inboxStateLegacyPath: runtimePaths.inboxStateLegacyPath,
    inboxPromotionsPath: runtimePaths.inboxPromotionsPath,
    inboxPromotionsLegacyPath: runtimePaths.inboxPromotionsLegacyPath,
  };
}

export function resolveDeviceSyncRuntimePaths(vaultRoot: string): DeviceSyncRuntimePaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    runtimeRoot: runtimePaths.runtimeRoot,
    operationalRoot: runtimePaths.operationalRoot,
    deviceSyncDbPath: runtimePaths.deviceSyncDbPath,
    deviceSyncDbLegacyPath: runtimePaths.deviceSyncDbLegacyPath,
    deviceSyncRuntimeRoot: runtimePaths.deviceSyncRuntimeRoot,
    deviceSyncRuntimeLegacyRoot: runtimePaths.deviceSyncRuntimeLegacyRoot,
    deviceSyncLauncherStatePath: runtimePaths.deviceSyncLauncherStatePath,
    deviceSyncLauncherStateLegacyPath: runtimePaths.deviceSyncLauncherStateLegacyPath,
    deviceSyncStdoutLogPath: runtimePaths.deviceSyncStdoutLogPath,
    deviceSyncStdoutLogLegacyPath: runtimePaths.deviceSyncStdoutLogLegacyPath,
    deviceSyncStderrLogPath: runtimePaths.deviceSyncStderrLogPath,
    deviceSyncStderrLogLegacyPath: runtimePaths.deviceSyncStderrLogLegacyPath,
  };
}

export function resolveParserRuntimePaths(vaultRoot: string): ParserRuntimePaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    runtimeRoot: runtimePaths.runtimeRoot,
    operationalRoot: runtimePaths.operationalRoot,
    parserRuntimeRoot: runtimePaths.parserRuntimeRoot,
    parserRuntimeLegacyRoot: runtimePaths.parserRuntimeLegacyRoot,
    parserToolchainConfigPath: runtimePaths.parserToolchainConfigPath,
    parserToolchainConfigLegacyPath: runtimePaths.parserToolchainConfigLegacyPath,
  };
}
