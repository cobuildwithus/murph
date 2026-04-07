import path from "node:path";

import {
  RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH,
  RUNTIME_PROJECTION_ROOT_RELATIVE_PATH,
  RUNTIME_ROOT_RELATIVE_PATH,
  RUNTIME_CACHE_ROOT_RELATIVE_PATH,
  RUNTIME_TEMP_ROOT_RELATIVE_PATH,
  ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH,
} from "./local-state-taxonomy.ts";

export {
  RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH,
  RUNTIME_PROJECTION_ROOT_RELATIVE_PATH,
  RUNTIME_ROOT_RELATIVE_PATH,
  RUNTIME_CACHE_ROOT_RELATIVE_PATH,
  RUNTIME_TEMP_ROOT_RELATIVE_PATH,
} from "./local-state-taxonomy.ts";

export const QUERY_DB_RELATIVE_PATH = `${RUNTIME_PROJECTION_ROOT_RELATIVE_PATH}/query.sqlite`;
export const INBOX_DB_RELATIVE_PATH = `${RUNTIME_PROJECTION_ROOT_RELATIVE_PATH}/inboxd.sqlite`;
export const INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/inbox`;
export const INBOX_CONFIG_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/config.json`;
export const INBOX_STATE_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/state.json`;
export const INBOX_PROMOTIONS_RELATIVE_PATH = `${INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH}/promotions.json`;
export const DEVICE_SYNC_DB_RELATIVE_PATH = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/device-sync/state.sqlite`;
export const GATEWAY_DB_RELATIVE_PATH = `${RUNTIME_PROJECTION_ROOT_RELATIVE_PATH}/gateway.sqlite`;
export const DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/device-sync`;
export const DEVICE_SYNC_LAUNCHER_STATE_RELATIVE_PATH = `${DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH}/launcher.json`;
export const DEVICE_SYNC_STDOUT_LOG_RELATIVE_PATH = `${DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH}/stdout.log`;
export const DEVICE_SYNC_STDERR_LOG_RELATIVE_PATH = `${DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH}/stderr.log`;
export const PARSER_RUNTIME_DIRECTORY_RELATIVE_PATH = `${RUNTIME_OPERATIONAL_ROOT_RELATIVE_PATH}/parsers`;
export const PARSER_TOOLCHAIN_CONFIG_RELATIVE_PATH = `${PARSER_RUNTIME_DIRECTORY_RELATIVE_PATH}/toolchain.json`;
export const ASSISTANT_RUNTIME_DIRECTORY_RELATIVE_PATH = ASSISTANT_RUNTIME_ROOT_RELATIVE_PATH;

export interface RuntimePaths {
  absoluteVaultRoot: string;
  runtimeRoot: string;
  operationalRoot: string;
  projectionsRoot: string;
  cacheRoot: string;
  tempRoot: string;
  queryDbPath: string;
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
  parserRuntimeRoot: string;
  parserToolchainConfigPath: string;
}

export type InboxRuntimePaths = Pick<
  RuntimePaths,
  | "absoluteVaultRoot"
  | "runtimeRoot"
  | "operationalRoot"
  | "projectionsRoot"
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
  | "operationalRoot"
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
  | "projectionsRoot"
  | "gatewayDbPath"
>;

export type ParserRuntimePaths = Pick<
  RuntimePaths,
  | "absoluteVaultRoot"
  | "runtimeRoot"
  | "operationalRoot"
  | "parserRuntimeRoot"
  | "parserToolchainConfigPath"
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
    queryDbPath: path.join(absoluteVaultRoot, QUERY_DB_RELATIVE_PATH),
    inboxDbPath: path.join(absoluteVaultRoot, INBOX_DB_RELATIVE_PATH),
    inboxRuntimeRoot: path.join(absoluteVaultRoot, INBOX_RUNTIME_DIRECTORY_RELATIVE_PATH),
    inboxConfigPath: path.join(absoluteVaultRoot, INBOX_CONFIG_RELATIVE_PATH),
    inboxStatePath: path.join(absoluteVaultRoot, INBOX_STATE_RELATIVE_PATH),
    inboxPromotionsPath: path.join(absoluteVaultRoot, INBOX_PROMOTIONS_RELATIVE_PATH),
    deviceSyncDbPath: path.join(absoluteVaultRoot, DEVICE_SYNC_DB_RELATIVE_PATH),
    gatewayDbPath: path.join(absoluteVaultRoot, GATEWAY_DB_RELATIVE_PATH),
    deviceSyncRuntimeRoot: path.join(absoluteVaultRoot, DEVICE_SYNC_RUNTIME_DIRECTORY_RELATIVE_PATH),
    deviceSyncLauncherStatePath: path.join(absoluteVaultRoot, DEVICE_SYNC_LAUNCHER_STATE_RELATIVE_PATH),
    deviceSyncStdoutLogPath: path.join(absoluteVaultRoot, DEVICE_SYNC_STDOUT_LOG_RELATIVE_PATH),
    deviceSyncStderrLogPath: path.join(absoluteVaultRoot, DEVICE_SYNC_STDERR_LOG_RELATIVE_PATH),
    parserRuntimeRoot: path.join(absoluteVaultRoot, PARSER_RUNTIME_DIRECTORY_RELATIVE_PATH),
    parserToolchainConfigPath: path.join(absoluteVaultRoot, PARSER_TOOLCHAIN_CONFIG_RELATIVE_PATH),
  };
}

export function resolveGatewayRuntimePaths(vaultRoot: string): GatewayRuntimePaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    runtimeRoot: runtimePaths.runtimeRoot,
    projectionsRoot: runtimePaths.projectionsRoot,
    gatewayDbPath: runtimePaths.gatewayDbPath,
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
    operationalRoot: runtimePaths.operationalRoot,
    deviceSyncDbPath: runtimePaths.deviceSyncDbPath,
    deviceSyncRuntimeRoot: runtimePaths.deviceSyncRuntimeRoot,
    deviceSyncLauncherStatePath: runtimePaths.deviceSyncLauncherStatePath,
    deviceSyncStdoutLogPath: runtimePaths.deviceSyncStdoutLogPath,
    deviceSyncStderrLogPath: runtimePaths.deviceSyncStderrLogPath,
  };
}

export function resolveParserRuntimePaths(vaultRoot: string): ParserRuntimePaths {
  const runtimePaths = resolveRuntimePaths(vaultRoot);

  return {
    absoluteVaultRoot: runtimePaths.absoluteVaultRoot,
    runtimeRoot: runtimePaths.runtimeRoot,
    operationalRoot: runtimePaths.operationalRoot,
    parserRuntimeRoot: runtimePaths.parserRuntimeRoot,
    parserToolchainConfigPath: runtimePaths.parserToolchainConfigPath,
  };
}
