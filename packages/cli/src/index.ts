import { Cli } from 'incur'
import { createVaultCli } from './vault-cli.js'

const cli: Cli.Cli = createVaultCli()

export default cli
export { createVaultCli, CLI_DESCRIPTION } from './vault-cli.js'
export {
  createIntegratedInboxCliServices,
  type InboxCliServices,
} from './inbox-services.js'
export {
  createIntegratedVaultCliServices,
  createUnwiredVaultCliServices,
  type CommandContext,
  type CoreWriteServices,
  type ImporterServices,
  type QueryServices,
  type VaultCliServices,
} from './vault-cli-services.js'
export * from './vault-cli-contracts.js'
export * from './inbox-cli-contracts.js'
export * from './vault-cli-errors.js'
