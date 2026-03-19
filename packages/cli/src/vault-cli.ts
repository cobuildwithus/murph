import { createRequire } from 'node:module'
import { Cli } from 'incur'
import {
  createIntegratedVaultCliServices,
  type VaultCliServices,
} from './vault-cli-services.js'
import {
  createIntegratedInboxCliServices,
  type InboxCliServices,
} from './inbox-services.js'
import { registerVaultCliCommandDescriptors } from './vault-cli-command-manifest.js'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version?: string }

export const CLI_DESCRIPTION =
  'Typed operator surface for the Healthy Bob vault baseline'

const CLI_SYNC_SUGGESTIONS = [
  'initialize a new Healthy Bob vault',
  'search recent notes in a Healthy Bob vault',
  'bootstrap the Healthy Bob inbox runtime',
]

export function createVaultCli(
  services: VaultCliServices = createIntegratedVaultCliServices(),
  inboxServices: InboxCliServices = createIntegratedInboxCliServices(),
): Cli.Cli {
  const cli = Cli.create('vault-cli', {
    description: CLI_DESCRIPTION,
    sync: {
      depth: 1,
      suggestions: CLI_SYNC_SUGGESTIONS,
    },
    version: packageJson.version,
  })

  registerVaultCliCommandDescriptors({
    cli,
    services,
    inboxServices,
  })

  return cli
}
