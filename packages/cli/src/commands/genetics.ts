import { Cli, z } from 'incur'
import { registerHealthCrudCommands, healthPayloadSchema } from './health-command-factory.js'
import { pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const scaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('genetics'),
  payload: healthPayloadSchema,
})

const upsertResultSchema = z.object({
  vault: pathSchema,
  variantId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
})

const showResultSchema = z.object({
  vault: pathSchema,
  entity: healthPayloadSchema,
})

const listResultSchema = z.object({
  vault: pathSchema,
  items: z.array(healthPayloadSchema),
  count: z.number().int().nonnegative(),
})

interface GeneticsServices extends VaultCliServices {
  core: VaultCliServices['core'] & {
    scaffoldGeneticVariant(input: {
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof scaffoldResultSchema>>
    upsertGeneticVariant(input: {
      input: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof upsertResultSchema>>
  }
  query: VaultCliServices['query'] & {
    showGeneticVariant(input: {
      id: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof showResultSchema>>
    listGeneticVariants(input: {
      vault: string
      requestId: string | null
      status?: string
      cursor?: string
      limit?: number
    }): Promise<z.infer<typeof listResultSchema>>
  }
}

export function registerGeneticsCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as GeneticsServices
  const genetics = Cli.create('genetics', {
    description: 'Genetic variant commands for the health extension surface.',
  })

  registerHealthCrudCommands({
    descriptions: {
      list: 'List genetic variants through the health read model.',
      scaffold: 'Emit a payload template for genetic variant upserts.',
      show: 'Show one genetic variant by canonical id or slug.',
      upsert: 'Upsert one genetic variant from an @file.json payload.',
    },
    group: genetics,
    groupName: 'genetics',
    listStatusDescription: 'Optional genetic-variant status to filter by.',
    noun: 'genetic variant',
    outputs: {
      list: listResultSchema,
      scaffold: scaffoldResultSchema,
      show: showResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'genetics.json',
    pluralNoun: 'genetic variants',
    services: {
      list(input) {
        return healthServices.query.listGeneticVariants(input)
      },
      scaffold(input) {
        return healthServices.core.scaffoldGeneticVariant(input)
      },
      show(input) {
        return healthServices.query.showGeneticVariant(input)
      },
      upsert(input) {
        return healthServices.core.upsertGeneticVariant(input)
      },
    },
    showId: {
      description: 'Genetic variant id or slug to show.',
      example: '<genetic-variant-id>',
      fromUpsert(result) {
        return result.variantId
      },
    },
  })

  cli.command(genetics)
}
