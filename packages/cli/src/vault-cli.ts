import type { Cli } from 'incur'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  createIntegratedInboxServices,
  type InboxServices,
} from '@murphai/inbox-services'
import { enableAssistantAutoReplyChannelLocal } from '@murphai/assistant-engine/assistant-state'
import {
  createDefaultVaultServices,
  createVaultCliShell,
} from './vault-cli-bootstrap.js'
import {
  ensureCliVaultServices,
  type CliVaultServices,
} from './device-services.js'
import { registerVaultCliCommandDescriptors } from './vault-cli-command-manifest.js'
import { installVaultCliSchemaIndex } from './vault-cli-schema-index.js'

export { CLI_DESCRIPTION } from './vault-cli-bootstrap.js'

export interface CreateVaultCliOptions {
  commandName?: string
  inboxServices?: InboxServices
  services?: VaultServices | CliVaultServices
}

function createDefaultInboxServices(): InboxServices {
  return createIntegratedInboxServices({
    enableAssistantAutoReplyChannel: async (vault, channel) =>
      enableAssistantAutoReplyChannelLocal({
        channel,
        vault,
      }),
  })
}

export function createVaultCliWithOptions(
  input: CreateVaultCliOptions = {},
): Cli.Cli {
  const services =
    input.services === undefined
      ? createDefaultVaultServices()
      : ensureCliVaultServices(input.services)
  const inboxServices = input.inboxServices ?? createDefaultInboxServices()
  const cli = createVaultCliShell(input.commandName)

  registerVaultCliCommandDescriptors({
    cli,
    services,
    inboxServices,
  })
  installVaultCliSchemaIndex(cli)

  return cli
}

export function createVaultCli(
  services: VaultServices | CliVaultServices = createDefaultVaultServices(),
  inboxServices: InboxServices = createDefaultInboxServices(),
): Cli.Cli {
  return createVaultCliWithOptions({
    inboxServices,
    services,
  })
}
