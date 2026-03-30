/**
 * Neutral vault service surface shared by the CLI shell and headless assistant consumers.
 */
export type { CommandContext } from "./usecases/types.js"
export type {
  CoreWriteServices,
  DeviceSyncServices,
  ImporterServices,
  QueryServices,
  VaultServices,
} from "./usecases/types.js"
export {
  createIntegratedVaultServices,
  createUnwiredVaultServices,
} from "./usecases/integrated-services.js"
