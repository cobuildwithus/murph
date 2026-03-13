import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
import { pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const payloadSchema = z.record(z.string(), z.unknown())
const inputFileSchema = z
  .string()
  .regex(/^@.+/u, 'Expected an @file.json payload reference.')

const scaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('goal'),
  payload: payloadSchema,
})

const upsertResultSchema = z.object({
  vault: pathSchema,
  goalId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
})

const showResultSchema = z.object({
  vault: pathSchema,
  entity: payloadSchema,
})

const listResultSchema = z.object({
  vault: pathSchema,
  items: z.array(payloadSchema),
  count: z.number().int().nonnegative(),
})

interface GoalServices extends VaultCliServices {
  core: VaultCliServices['core'] & {
    scaffoldGoal(input: {
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof scaffoldResultSchema>>
    upsertGoal(input: {
      input: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof upsertResultSchema>>
  }
  query: VaultCliServices['query'] & {
    showGoal(input: {
      id: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof showResultSchema>>
    listGoals(input: {
      vault: string
      requestId: string | null
      status?: string
      cursor?: string
      limit?: number
    }): Promise<z.infer<typeof listResultSchema>>
  }
}

function stripAtPrefix(input: string) {
  return input.slice(1)
}

export function registerGoalCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as GoalServices
  const goal = Cli.create('goal', {
    description: 'Goal registry commands for the health extension surface.',
  })

  goal.command(
    'scaffold',
    {
      description: 'Emit a payload template for goal upserts.',
      args: z.object({}),
      options: withBaseOptions(),
      output: scaffoldResultSchema,
      async run({ options }) {
        return healthServices.core.scaffoldGoal({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  goal.command(
    'upsert',
    {
      description: 'Upsert one goal from an @file.json payload.',
      args: z.object({}),
      options: withBaseOptions({
        input: inputFileSchema,
      }),
      output: upsertResultSchema,
      async run({ options }) {
        return healthServices.core.upsertGoal({
          input: stripAtPrefix(options.input),
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  goal.command(
    'show',
    {
      description: 'Show one goal by canonical id or slug.',
      args: z.object({
        id: z.string().min(1),
      }),
      options: withBaseOptions(),
      output: showResultSchema,
      async run({ args, options }) {
        return healthServices.query.showGoal({
          id: args.id,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  goal.command(
    'list',
    {
      description: 'List goals through the health read model.',
      args: z.object({}),
      options: withBaseOptions({
        status: z.string().min(1).optional(),
        cursor: z.string().min(1).optional(),
        limit: z.number().int().positive().max(200).default(50),
      }),
      output: listResultSchema,
      async run({ options }) {
        return healthServices.query.listGoals({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          status: options.status,
          cursor: options.cursor,
          limit: options.limit,
        })
      },
    },
  )

  cli.command(goal)
}
