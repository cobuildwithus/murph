import { FOOD_STATUSES } from '@murphai/contracts'
import { Cli, z } from 'incur'

import { requestIdFromOptions, withBaseOptions } from '@murphai/assistant-core/command-helpers'
import {
  isoTimestampSchema,
  listItemSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/assistant-core/vault-cli-contracts'
import type { VaultServices } from '@murphai/assistant-core/vault-services'
import { dailyFoodTimeSchema } from '@murphai/assistant-core/usecases/food-autolog'
import {
  deleteFoodRecord,
  editFoodRecord,
} from '@murphai/assistant-core/usecases/food'
import { createRegistryDocEntityGroup } from './health-command-factory.js'
import {
  createDirectEntityDeleteCommandDefinition,
  createDirectEntityEditCommandDefinition,
} from './record-mutation-command-helpers.js'

const foodStatusSchema = z.enum(FOOD_STATUSES)
const foodSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')

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

function createFoodRenameCommandConfig(services: VaultServices) {
  return {
    args: z.object({
      lookup: z.string().min(1).describe('Food id or slug to rename.'),
    }),
    description: 'Rename one remembered food while preserving its canonical id.',
    hint: 'The previous food title is kept as an alias automatically so older operator language still resolves in the saved record.',
    options: withBaseOptions({
      title: z.string().min(1).max(160).describe('New remembered food title.'),
      slug: foodSlugSchema
        .optional()
        .describe('Optional stable slug override for the renamed food record.'),
    }),
    output: foodUpsertResultSchema,
    async run(context: {
      args: {
        lookup: string
      }
      options: {
        vault: string
        requestId?: string
        title: string
        slug?: string
      }
    }) {
      return services.core.renameFood({
        lookup: context.args.lookup,
        title: context.options.title,
        slug: context.options.slug,
        requestId: requestIdFromOptions(context.options),
        vault: context.options.vault,
      })
    },
  }
}

function createFoodScheduleCommandConfig(services: VaultServices) {
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
      slug: foodSlugSchema
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

export function registerFoodCommands(cli: Cli.Cli, services: VaultServices) {
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

  food.command('edit', createDirectEntityEditCommandDefinition({
    arg: {
      name: 'id',
      schema: z.string().min(1).describe('Food id or slug to edit.'),
    },
    description:
      'Edit one food by merging a partial JSON patch or one or more path assignments into the saved record.',
    run(input) {
      return editFoodRecord({
        vault: input.vault,
        lookup: input.lookup,
        inputFile: input.inputFile,
        set: input.set,
        clear: input.clear,
      })
    },
  }))

  food.command('delete', createDirectEntityDeleteCommandDefinition({
    arg: {
      name: 'id',
      schema: z.string().min(1).describe('Food id or slug to delete.'),
    },
    description: 'Delete one remembered food Markdown record.',
    run(input) {
      return deleteFoodRecord({
        vault: input.vault,
        lookup: input.lookup,
      })
    },
  }))

  food.command('rename', createFoodRenameCommandConfig(services))
  food.command('schedule', createFoodScheduleCommandConfig(services))

  cli.command(food)
}
