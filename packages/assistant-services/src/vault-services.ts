import {
  createIntegratedVaultCliServices as createMurphIntegratedVaultCliServices,
  createUnwiredVaultCliServices as createMurphUnwiredVaultCliServices,
  type CommandContext,
  type CoreWriteServices,
  type DeviceSyncServices,
  type ImporterServices,
  type QueryServices,
  type VaultCliServices,
} from "murph/vault-cli-services";

export type {
  CommandContext,
  CoreWriteServices,
  DeviceSyncServices,
  ImporterServices,
  QueryServices,
  VaultCliServices,
} from "murph/vault-cli-services";

export function createIntegratedVaultCliServices(
  ...args: Parameters<typeof createMurphIntegratedVaultCliServices>
): ReturnType<typeof createMurphIntegratedVaultCliServices> {
  return createMurphIntegratedVaultCliServices(...args);
}

export function createUnwiredVaultCliServices(
  ...args: Parameters<typeof createMurphUnwiredVaultCliServices>
): ReturnType<typeof createMurphUnwiredVaultCliServices> {
  return createMurphUnwiredVaultCliServices(...args);
}
