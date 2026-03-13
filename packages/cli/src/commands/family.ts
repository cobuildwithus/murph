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

const scaffoldResultSchema = createHealthScaffoldResultSchema('family')

const upsertResultSchema = z.object({
  vault: pathSchema,
  familyMemberId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
})

export function registerFamilyCommands(cli: Cli.Cli, services: VaultCliServices) {
  registerHealthCrudGroup(cli, {
    commandName: 'family',
    description: 'Family registry commands for the health extension surface.',
    descriptions: {
      list: 'List family members through the health read model.',
      scaffold: 'Emit a payload template for family member upserts.',
      show: 'Show one family member by canonical id or slug.',
      upsert: 'Upsert one family member from an @file.json payload.',
    },
    listStatusDescription: 'Optional family-member status to filter by.',
    noun: 'family member',
    outputs: {
      list: healthListResultSchema,
      scaffold: scaffoldResultSchema,
      show: healthShowResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'family.json',
    pluralNoun: 'family members',
    services: bindHealthCrudServices(services, {
      list: 'listFamilyMembers',
      scaffold: 'scaffoldFamilyMember',
      show: 'showFamilyMember',
      upsert: 'upsertFamilyMember',
    }),
    showId: {
      description: 'Family member id or slug to show.',
      example: '<family-member-id>',
      fromUpsert(result) {
        return result.familyMemberId
      },
    },
  })
}
