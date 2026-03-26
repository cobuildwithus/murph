import { FOOD_STATUSES } from '@healthybob/contracts'
import { Cli, z } from 'incur'

import {
  listItemSchema,
  pathSchema,
  showResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import { registerRegistryDocEntityGroup } from './health-command-factory.js'

const foodStatusSchema = z.enum(FOOD_STATUSES)

const foodScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('food'),
  payload: z.record(z.string(), z.unknown()),
})

const foodUpsertResultSchema = z.object({
  vault: pathSchema,
  foodId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
})

const foodListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: foodStatusSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

export function registerFoodCommands(cli: Cli.Cli, services: VaultCliServices) {
  registerRegistryDocEntityGroup(cli, {
    commandName: 'food',
    description: 'Food registry commands for bank/foods Markdown records.',
    scaffold: {
      name: 'scaffold',
      args: z.object({}),
      description: 'Emit a food payload template for `food upsert`.',
      output: foodScaffoldResultSchema,
      async run({ options, requestId }) {
        return services.core.scaffoldFood({
          vault: String(options.vault ?? ''),
          requestId,
        })
      },
    },
    upsert: {
      description: 'Create or update one food Markdown record from a JSON payload file or stdin.',
      output: foodUpsertResultSchema,
      async run(input) {
        return services.core.upsertFood({
          vault: input.vault,
          requestId: input.requestId,
          inputFile: input.input,
        })
      },
    },
    show: {
      description: 'Show one food by canonical id or slug.',
      argName: 'id',
      argSchema: z.string().min(1).describe('Food id or slug to show.'),
      output: showResultSchema,
      async run(input) {
        return services.query.showFood({
          lookup: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    list: {
      description: 'List food records with an optional status filter.',
      output: foodListResultSchema,
      statusOption: foodStatusSchema.optional(),
      async run(input) {
        return services.query.listFoods({
          vault: input.vault,
          requestId: input.requestId,
          status: input.status,
          limit: input.limit ?? 50,
        })
      },
    },
  })
}
