import type { Cli } from 'incur'
import type { VaultServices } from '@murphai/vault-usecases'
import { loadRuntimeModule } from '@murphai/vault-usecases/runtime'
import {
  createIntegratedInboxServices,
  type InboxImessageRuntimeModule,
  type InboxServices,
} from '@murphai/inbox-services'
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
    loadInboxImessageModule: () =>
      loadRuntimeModule<InboxImessageRuntimeModule>('@murphai/inboxd-imessage'),
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
