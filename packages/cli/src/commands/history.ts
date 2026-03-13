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
  noun: z.literal('history'),
  payload: payloadSchema,
})

const upsertResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema.optional(),
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

interface HistoryServices extends VaultCliServices {
  core: VaultCliServices['core'] & {
    scaffoldHistoryEvent(input: {
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof scaffoldResultSchema>>
    upsertHistoryEvent(input: {
      input: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof upsertResultSchema>>
  }
  query: VaultCliServices['query'] & {
    showHistoryEvent(input: {
      id: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof showResultSchema>>
    listHistoryEvents(input: {
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

export function registerHistoryCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as HistoryServices
  const history = Cli.create('history', {
    description: 'Timed health history commands for the extension surface.',
  })

  history.command(
    'scaffold',
    {
      description: 'Emit a payload template for timed history events.',
      args: z.object({}),
      options: withBaseOptions(),
      output: scaffoldResultSchema,
      async run({ options }) {
        return healthServices.core.scaffoldHistoryEvent({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  history.command(
    'upsert',
    {
      description: 'Append one timed history event from an @file.json payload.',
      args: z.object({}),
      options: withBaseOptions({
        input: inputFileSchema,
      }),
      output: upsertResultSchema,
      async run({ options }) {
        return healthServices.core.upsertHistoryEvent({
          input: stripAtPrefix(options.input),
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  history.command(
    'show',
    {
      description: 'Show one timed history event.',
      args: z.object({
        id: z.string().min(1),
      }),
      options: withBaseOptions(),
      output: showResultSchema,
      async run({ args, options }) {
        return healthServices.query.showHistoryEvent({
          id: args.id,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  history.command(
    'list',
    {
      description: 'List timed history events through the health read model.',
      args: z.object({}),
      options: withBaseOptions({
        status: z.string().min(1).optional(),
        cursor: z.string().min(1).optional(),
        limit: z.number().int().positive().max(200).default(50),
      }),
      output: listResultSchema,
      async run({ options }) {
        return healthServices.query.listHistoryEvents({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          status: options.status,
          cursor: options.cursor,
          limit: options.limit,
        })
      },
    },
  )

  cli.command(history)
}
