import type { Cli } from 'incur'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  createIntegratedInboxServices,
  type InboxServices,
} from '@murphai/inbox-services'
import { enableAssistantAutoReplyChannelLocal } from '@murphai/assistant-engine/assistant-state'
import {
  CLI_DESCRIPTION,
  createDefaultVaultServices,
  createVaultCliShell,
} from './vault-cli-bootstrap.js'
import { registerVaultCliCommandDescriptors } from './vault-cli-command-manifest.js'

export { CLI_DESCRIPTION } from './vault-cli-bootstrap.js'

export function createVaultCli(
  services: VaultServices = createDefaultVaultServices(),
  inboxServices: InboxServices = createIntegratedInboxServices({
    enableAssistantAutoReplyChannel: async (vault, channel) =>
      enableAssistantAutoReplyChannelLocal({
        channel,
        vault,
      }),
  }),
): Cli.Cli {
  const cli = createVaultCliShell()

  registerVaultCliCommandDescriptors({
    cli,
    services,
    inboxServices,
  })

  return cli
}
