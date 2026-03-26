import { FOOD_STATUSES } from '@healthybob/contracts'
import { Cli, z } from 'incur'

import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
import {
  isoTimestampSchema,
  listItemSchema,
  pathSchema,
  showResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import { dailyFoodTimeSchema } from '../usecases/food-autolog.js'
import { createRegistryDocEntityGroup } from './health-command-factory.js'

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

const foodScheduleResultSchema = z.object({
  vault: pathSchema,
  foodId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
  time: dailyFoodTimeSchema,
  jobId: z.string().min(1),
  jobName: z.string().min(1),
  nextRunAt: isoTimestampSchema.nullable(),
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

function createFoodScheduleCommandConfig(services: VaultCliServices) {
  return {
    args: z.object({
      title: z.string().min(1).max(160).describe('Remembered food title.'),
    }),
    description: 'Schedule one remembered food for daily auto-log meal creation.',
    hint: 'This schedules recurring meal logging for a remembered food. The daily log fires while `vault-cli assistant run` is active for the same vault.',
    options: withBaseOptions({
      time: dailyFoodTimeSchema.describe('Daily local time in 24-hour HH:MM form.'),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional remembered food note that will be used in the auto-logged meal entry.'),
      slug: z
        .string()
        .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')
        .optional()
        .describe('Optional stable slug override for the remembered food record.'),
    }),
    output: foodScheduleResultSchema,
    async run(context: {
      args: {
        title: string
      }
      options: {
        vault: string
        requestId?: string
        time: string
        note?: string
        slug?: string
      }
    }) {
      return services.core.addDailyFood({
        title: context.args.title,
        time: context.options.time,
        note: context.options.note,
        slug: context.options.slug,
        requestId: requestIdFromOptions(context.options),
        vault: context.options.vault,
      })
    },
  }
}

export function registerFoodCommands(cli: Cli.Cli, services: VaultCliServices) {
  const food = createRegistryDocEntityGroup({
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

  food.command('schedule', createFoodScheduleCommandConfig(services))

  cli.command(food)
}
