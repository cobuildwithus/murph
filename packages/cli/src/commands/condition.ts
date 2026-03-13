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
  noun: z.literal('condition'),
  payload: payloadSchema,
})

const upsertResultSchema = z.object({
  vault: pathSchema,
  conditionId: z.string().min(1),
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

interface ConditionServices extends VaultCliServices {
  core: VaultCliServices['core'] & {
    scaffoldCondition(input: {
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof scaffoldResultSchema>>
    upsertCondition(input: {
      input: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof upsertResultSchema>>
  }
  query: VaultCliServices['query'] & {
    showCondition(input: {
      id: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof showResultSchema>>
    listConditions(input: {
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

export function registerConditionCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as ConditionServices
  const condition = Cli.create('condition', {
    description: 'Condition registry commands for the health extension surface.',
  })

  condition.command(
    'scaffold',
    {
      description: 'Emit a payload template for condition upserts.',
      args: z.object({}),
      options: withBaseOptions(),
      output: scaffoldResultSchema,
      async run({ options }) {
        return healthServices.core.scaffoldCondition({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  condition.command(
    'upsert',
    {
      description: 'Upsert one condition from an @file.json payload.',
      args: z.object({}),
      options: withBaseOptions({
        input: inputFileSchema,
      }),
      output: upsertResultSchema,
      async run({ options }) {
        return healthServices.core.upsertCondition({
          input: stripAtPrefix(options.input),
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  condition.command(
    'show',
    {
      description: 'Show one condition by canonical id or slug.',
      args: z.object({
        id: z.string().min(1),
      }),
      options: withBaseOptions(),
      output: showResultSchema,
      async run({ args, options }) {
        return healthServices.query.showCondition({
          id: args.id,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  condition.command(
    'list',
    {
      description: 'List conditions through the health read model.',
      args: z.object({}),
      options: withBaseOptions({
        status: z.string().min(1).optional(),
        cursor: z.string().min(1).optional(),
        limit: z.number().int().positive().max(200).default(50),
      }),
      output: listResultSchema,
      async run({ options }) {
        return healthServices.query.listConditions({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          status: options.status,
          cursor: options.cursor,
          limit: options.limit,
        })
      },
    },
  )

  cli.command(condition)
}
