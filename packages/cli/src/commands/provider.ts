import { Cli, z } from 'incur'
import {
  requestIdFromOptions,
} from '../command-helpers.js'
import {
  listItemSchema,
  pathSchema,
  showResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import { registerRegistryDocEntityGroup } from './health-command-factory.js'

const providerStatusSchema = z.string().min(1)

const providerScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('provider'),
  payload: z.record(z.string(), z.unknown()),
})

const providerUpsertResultSchema = z.object({
  vault: pathSchema,
  providerId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
})

const providerListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: providerStatusSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

export function registerProviderCommands(
  cli: Cli.Cli,
  services: VaultCliServices,
) {
  registerRegistryDocEntityGroup(cli, {
    commandName: 'provider',
    description: 'Provider registry commands for bank/providers Markdown records.',
    scaffold: {
      name: 'scaffold',
      args: z.object({}),
      description: 'Emit a provider payload template for `provider upsert`.',
      output: providerScaffoldResultSchema,
      async run({ options, requestId }) {
        return services.core.scaffoldProvider({
          vault: String(options.vault ?? ''),
          requestId,
        })
      },
    },
    upsert: {
      description: 'Create or update one provider Markdown record from a JSON payload file or stdin.',
      output: providerUpsertResultSchema,
      async run(input) {
        return services.core.upsertProvider({
          vault: input.vault,
          requestId: input.requestId,
          inputFile: input.input,
        })
      },
    },
    show: {
      description: 'Show one provider by canonical id or slug.',
      argName: 'id',
      argSchema: z.string().min(1).describe('Provider id or slug to show.'),
      output: showResultSchema,
      async run(input) {
        return services.query.showProvider({
          lookup: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    list: {
      description: 'List provider records with an optional status filter.',
      output: providerListResultSchema,
      statusOption: providerStatusSchema.optional(),
      async run(input) {
        return services.query.listProviders({
          vault: input.vault,
          requestId: input.requestId,
          status: input.status as z.infer<typeof providerStatusSchema> | undefined,
          limit: input.limit ?? 50,
        })
      },
    },
  })
}
