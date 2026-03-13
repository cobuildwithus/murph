import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
import {
  journalEnsureResultSchema,
  localDateSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

export function registerJournalCommands(cli: Cli.Cli, services: VaultCliServices) {
  const journal = Cli.create('journal', {
    description: 'Journal document commands routed through the core write API.',
  })

  journal.command(
    'ensure',
    {
      description: 'Create or confirm the daily journal document for a date.',
      args: z.object({
        date: localDateSchema,
      }),
      options: withBaseOptions(),
      output: journalEnsureResultSchema,
      async run({ args, options }) {
        return services.core.ensureJournal({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          date: args.date,
        })
      },
    },
  )

  cli.command(journal)
}
