import { Cli } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import {
  vaultInitResultSchema,
  vaultValidateResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

export function registerVaultCommands(cli: Cli.Cli, services: VaultCliServices) {
  cli.command(
    'init',
    {
      description: 'Create the baseline vault layout through the core write path.',
      args: emptyArgsSchema,
      options: withBaseOptions(),
      output: vaultInitResultSchema,
      async run({ options }) {
        return services.core.init({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  cli.command(
    'validate',
    {
      description: 'Validate the vault through the core read/validation path.',
      args: emptyArgsSchema,
      options: withBaseOptions(),
      output: vaultValidateResultSchema,
      async run({ options }) {
        return services.core.validate({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )
}
