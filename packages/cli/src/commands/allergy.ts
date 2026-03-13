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
  noun: z.literal('allergy'),
  payload: payloadSchema,
})

const upsertResultSchema = z.object({
  vault: pathSchema,
  allergyId: z.string().min(1),
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

interface AllergyServices extends VaultCliServices {
  core: VaultCliServices['core'] & {
    scaffoldAllergy(input: {
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof scaffoldResultSchema>>
    upsertAllergy(input: {
      input: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof upsertResultSchema>>
  }
  query: VaultCliServices['query'] & {
    showAllergy(input: {
      id: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof showResultSchema>>
    listAllergies(input: {
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

export function registerAllergyCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as AllergyServices
  const allergy = Cli.create('allergy', {
    description: 'Allergy registry commands for the health extension surface.',
  })

  allergy.command(
    'scaffold',
    {
      description: 'Emit a payload template for allergy upserts.',
      args: z.object({}),
      options: withBaseOptions(),
      output: scaffoldResultSchema,
      async run({ options }) {
        return healthServices.core.scaffoldAllergy({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  allergy.command(
    'upsert',
    {
      description: 'Upsert one allergy from an @file.json payload.',
      args: z.object({}),
      options: withBaseOptions({
        input: inputFileSchema,
      }),
      output: upsertResultSchema,
      async run({ options }) {
        return healthServices.core.upsertAllergy({
          input: stripAtPrefix(options.input),
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  allergy.command(
    'show',
    {
      description: 'Show one allergy by canonical id or slug.',
      args: z.object({
        id: z.string().min(1),
      }),
      options: withBaseOptions(),
      output: showResultSchema,
      async run({ args, options }) {
        return healthServices.query.showAllergy({
          id: args.id,
          vault: options.vault,
          requestId: requestIdFromOptions(options),
        })
      },
    },
  )

  allergy.command(
    'list',
    {
      description: 'List allergies through the health read model.',
      args: z.object({}),
      options: withBaseOptions({
        status: z.string().min(1).optional(),
        cursor: z.string().min(1).optional(),
        limit: z.number().int().positive().max(200).default(50),
      }),
      output: listResultSchema,
      async run({ options }) {
        return healthServices.query.listAllergies({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          status: options.status,
          cursor: options.cursor,
          limit: options.limit,
        })
      },
    },
  )

  cli.command(allergy)
}
