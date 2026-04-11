import { Cli } from 'incur'
import { createVaultCli } from './vault-cli.js'

const cli: Cli.Cli = createVaultCli()

export default cli
export { createVaultCli, CLI_DESCRIPTION } from './vault-cli.js'
export * from './research-runtime.js'
export * from './research-cli-contracts.js'
