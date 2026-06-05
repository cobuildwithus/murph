import {
  createIntegratedVaultServices,
} from '@murphai/vault-usecases'
import type { CliVaultServices } from './device-services.js'
import { ensureCliVaultServices } from './device-services.js'

export {
  CLI_CONFIG_FILES,
  CLI_DESCRIPTION,
  getVaultCliPackageVersion,
} from './vault-cli-package.js'
export { createVaultCliShell } from './vault-cli-shell.js'

export function createDefaultVaultServices(): CliVaultServices {
  return ensureCliVaultServices(
    createIntegratedVaultServices(),
  )
}
