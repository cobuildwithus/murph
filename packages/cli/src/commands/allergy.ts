import { Cli, z } from 'incur'
import { registerHealthCrudCommands } from './health-command-factory.js'
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

const showResultSchema = healthShowResultSchema
const listResultSchema = healthListResultSchema

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

export function registerAllergyCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as AllergyServices
  const allergy = Cli.create('allergy', {
    description: 'Allergy registry commands for the health extension surface.',
  })

  registerHealthCrudCommands({
    descriptions: {
      list: 'List allergies through the health read model.',
      scaffold: 'Emit a payload template for allergy upserts.',
      show: 'Show one allergy by canonical id or slug.',
      upsert: 'Upsert one allergy from an @file.json payload.',
    },
    group: allergy,
    groupName: 'allergy',
    listStatusDescription: 'Optional allergy status to filter by.',
    noun: 'allergy',
    outputs: {
      list: listResultSchema,
      scaffold: scaffoldResultSchema,
      show: showResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'allergy.json',
    pluralNoun: 'allergies',
    services: {
      list(input) {
        return healthServices.query.listAllergies(input)
      },
      scaffold(input) {
        return healthServices.core.scaffoldAllergy(input)
      },
      show(input) {
        return healthServices.query.showAllergy(input)
      },
      upsert(input) {
        return healthServices.core.upsertAllergy(input)
      },
    },
    showId: {
      description: 'Allergy id or slug to show.',
      example: '<allergy-id>',
      fromUpsert(result) {
        return result.allergyId
      },
    },
  })

  cli.command(allergy)
}
