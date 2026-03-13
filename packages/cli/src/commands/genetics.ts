import { Cli, z } from 'incur'
import {
  bindHealthCrudServices,
  registerHealthCrudGroup,
} from './health-command-factory.js'
import {
  createHealthScaffoldResultSchema,
  healthListResultSchema,
  healthShowResultSchema,
} from '../health-cli-descriptors.js'
import { pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const scaffoldResultSchema = createHealthScaffoldResultSchema('genetics')

const upsertResultSchema = z.object({
  vault: pathSchema,
  variantId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
})

export function registerGeneticsCommands(
  cli: Cli.Cli,
  services: VaultCliServices,
) {
  registerHealthCrudGroup(cli, {
    commandName: 'genetics',
    description: 'Genetic variant commands for the health extension surface.',
    descriptions: {
      list: 'List genetic variants through the health read model.',
      scaffold: 'Emit a payload template for genetic variant upserts.',
      show: 'Show one genetic variant by canonical id or slug.',
      upsert: 'Upsert one genetic variant from an @file.json payload.',
    },
    listStatusDescription: 'Optional genetic-variant status to filter by.',
    noun: 'genetic variant',
    outputs: {
      list: healthListResultSchema,
      scaffold: scaffoldResultSchema,
      show: healthShowResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'genetics.json',
    pluralNoun: 'genetic variants',
    services: bindHealthCrudServices(services, {
      list: 'listGeneticVariants',
      scaffold: 'scaffoldGeneticVariant',
      show: 'showGeneticVariant',
      upsert: 'upsertGeneticVariant',
    }),
    showId: {
      description: 'Genetic variant id or slug to show.',
      example: '<genetic-variant-id>',
      fromUpsert(result) {
        return result.variantId
      },
    },
  })
}
