import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '@murph/assistant-core/command-helpers'
import {
  listFilterSchema,
  listResultSchema,
  showResultSchema,
} from '@murph/assistant-core/vault-cli-contracts'
import type { VaultServices } from '@murph/assistant-core/vault-services'

export function registerReadCommands(cli: Cli.Cli, services: VaultServices) {
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
        recordType: listFilterSchema.shape.recordType,
        kind: listFilterSchema.shape.kind,
        status: listFilterSchema.shape.status,
        stream: listFilterSchema.shape.stream,
        experiment: listFilterSchema.shape.experiment,
        from: listFilterSchema.shape.from,
        to: listFilterSchema.shape.to,
        tag: listFilterSchema.shape.tag,
        limit: listFilterSchema.shape.limit,
      }),
      output: listResultSchema,
      async run({ options }) {
        return services.query.list({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          recordType: options.recordType,
          kind: options.kind,
          status: options.status,
          stream: options.stream,
          experiment: options.experiment,
          from: options.from,
          to: options.to,
          tag: options.tag,
          limit: options.limit,
        })
      },
    },
  )
}
