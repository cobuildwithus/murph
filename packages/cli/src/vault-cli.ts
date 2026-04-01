import { createRequire } from 'node:module'
import { Cli } from 'incur'
import {
  createIntegratedVaultServices,
  type VaultServices,
} from '@murphai/assistant-core/vault-services'
import {
  createIntegratedInboxServices,
  type InboxServices,
} from '@murphai/assistant-core/inbox-services'
import { registerVaultCliCommandDescriptors } from './vault-cli-command-manifest.js'

const require = createRequire(import.meta.url)
const packageJson = require('../package.json') as { version?: string }

export const CLI_DESCRIPTION =
  'Typed operator surface for the Murph vault baseline'

const CLI_SYNC_SUGGESTIONS = [
  'initialize a new Murph vault',
  'search recent notes in a Murph vault',
  'bootstrap the Murph inbox runtime',
]

export function createVaultCli(
  services: VaultServices = createIntegratedVaultServices(),
  inboxServices: InboxServices = createIntegratedInboxServices(),
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
