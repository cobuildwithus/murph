import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
import {
  listFilterSchema,
  listResultSchema,
  showResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const reservedCursorOptionSchema = listFilterSchema.shape.cursor.describe(
  'Reserved for future pagination support. Accepted for compatibility but ignored today.',
)

export function registerReadCommands(cli: Cli.Cli, services: VaultCliServices) {
  cli.command(
    'show',
    {
      description: 'Read one canonical vault record through the query layer.',
      args: z.object({
        id: z
          .string()
          .min(1)
          .describe('Queryable record identifier to resolve with `show`.'),
      }),
      options: withBaseOptions(),
      output: showResultSchema,
      async run({ args, options }) {
        return services.query.show({
          id: args.id,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  cli.command(
    'list',
    {
      description: 'List canonical vault records through the query layer.',
      args: z.object({}),
      options: withBaseOptions({
        kind: listFilterSchema.shape.kind,
        experiment: listFilterSchema.shape.experiment,
        dateFrom: listFilterSchema.shape.dateFrom,
        dateTo: listFilterSchema.shape.dateTo,
        cursor: reservedCursorOptionSchema,
        limit: listFilterSchema.shape.limit,
      }),
      output: listResultSchema,
      async run({ options }) {
        return services.query.list({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          kind: options.kind,
          experiment: options.experiment,
          dateFrom: options.dateFrom,
          dateTo: options.dateTo,
          limit: options.limit,
        })
      },
    },
  )
}
