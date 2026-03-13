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

const scaffoldResultSchema = createHealthScaffoldResultSchema('allergy')

const upsertResultSchema = z.object({
  vault: pathSchema,
  allergyId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
})

export function registerAllergyCommands(cli: Cli.Cli, services: VaultCliServices) {
  registerHealthCrudGroup(cli, {
    commandName: 'allergy',
    description: 'Allergy registry commands for the health extension surface.',
    descriptions: {
      list: 'List allergies through the health read model.',
      scaffold: 'Emit a payload template for allergy upserts.',
      show: 'Show one allergy by canonical id or slug.',
      upsert: 'Upsert one allergy from an @file.json payload.',
    },
    listStatusDescription: 'Optional allergy status to filter by.',
    noun: 'allergy',
    outputs: {
      list: healthListResultSchema,
      scaffold: scaffoldResultSchema,
      show: healthShowResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'allergy.json',
    pluralNoun: 'allergies',
    services: bindHealthCrudServices(services, {
      list: 'listAllergies',
      scaffold: 'scaffoldAllergy',
      show: 'showAllergy',
      upsert: 'upsertAllergy',
    }),
    showId: {
      description: 'Allergy id or slug to show.',
      example: '<allergy-id>',
      fromUpsert(result) {
        return result.allergyId
      },
    },
  })
}
