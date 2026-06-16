import type { Cli } from 'incur'
import type { VaultServices } from '@murphai/vault-usecases'
import type { InboxServices } from '@murphai/inbox-services'
import {
  createDefaultVaultServices,
  createVaultCliShell,
} from './vault-cli-bootstrap.js'
import { createDefaultInboxServices } from './vault-cli-inbox-services.js'
import {
  ensureCliVaultServices,
  type CliVaultServices,
} from './device-services.js'
import { registerVaultCliCommandDescriptors } from './vault-cli-command-manifest.js'
import { installVaultCliLlmsNormalizer } from './vault-cli-llms-normalizer.js'
import { installVaultCliSchemaIndex } from './vault-cli-schema-index.js'
import {
  createVaultCliVaultContext,
  installVaultCliVaultContext,
  type VaultCliVaultContext,
} from './vault-cli-vault-context.js'

export {
  CLI_CONFIG_FILES,
  CLI_DESCRIPTION,
} from './vault-cli-bootstrap.js'

export interface CreateVaultCliOptions {
  commandName?: string
  excludeCommandDescriptorIds?: ReadonlySet<string>
  inboxServices?: InboxServices
  services?: VaultServices | CliVaultServices
  vaultContext?: VaultCliVaultContext
}

export function createVaultCliWithOptions(
  input: CreateVaultCliOptions = {},
): Cli.Cli {
  const services =
    input.services === undefined
      ? createDefaultVaultServices()
      : ensureCliVaultServices(input.services)
  const inboxServices = input.inboxServices ?? createDefaultInboxServices()
  const commandName = input.commandName ?? 'vault-cli'
  const cli = createVaultCliShell(commandName)

  registerVaultCliCommandDescriptors({
    cli,
    ...(input.excludeCommandDescriptorIds
      ? { excludeDescriptorIds: input.excludeCommandDescriptorIds }
      : {}),
    services,
    inboxServices,
  })
  installVaultCliSchemaIndex(cli)
  installVaultCliLlmsNormalizer(cli, commandName)
  installVaultCliVaultContext(
    cli,
    input.vaultContext ?? createVaultCliVaultContext(),
  )

  return cli
}

export { createVaultCliVaultContext }
export type { VaultCliVaultContext }

export function createVaultCli(
  services: VaultServices | CliVaultServices = createDefaultVaultServices(),
  inboxServices: InboxServices = createDefaultInboxServices(),
): Cli.Cli {
  return createVaultCliWithOptions({
    inboxServices,
    services,
  })
}
