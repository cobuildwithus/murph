import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import {
  exportPackResultSchema,
  localDateSchema,
  pathSchema,
  slugSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

export function registerExportCommands(cli: Cli.Cli, services: VaultCliServices) {
  const exportCli = Cli.create('export', {
    description: 'Export commands routed through the query layer.',
  })

  exportCli.command(
    'pack',
    {
      description: 'Build a date-bounded export pack from the read model.',
      args: emptyArgsSchema,
      options: withBaseOptions({
        from: localDateSchema.describe('Inclusive start date for the pack.'),
        to: localDateSchema.describe('Inclusive end date for the pack.'),
        experiment: slugSchema
          .optional()
          .describe('Optional experiment slug filter.'),
        out: pathSchema
          .optional()
          .describe('Optional directory for materialized pack output.'),
      }),
      output: exportPackResultSchema,
      async run({ options }) {
        return services.query.exportPack({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          from: options.from,
          to: options.to,
          experiment: options.experiment,
          out: options.out,
        })
      },
    },
  )

  cli.command(exportCli)
}
