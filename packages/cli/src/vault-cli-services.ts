/**
 * Legacy CLI-shaped vault service exports kept for compatibility.
 * New code should import from ./vault-services.js.
 */
export type { CommandContext } from "./vault-services.js"
export type {
  CoreWriteServices,
  DeviceSyncServices,
  ImporterServices,
  QueryServices,
  VaultServices,
} from "./vault-services.js"
export type { VaultCliServices } from "./usecases/types.js"
export {
  createIntegratedVaultServices,
  createIntegratedVaultServices as createIntegratedVaultCliServices,
  createUnwiredVaultServices,
  createUnwiredVaultServices as createUnwiredVaultCliServices,
} from "./vault-services.js"
