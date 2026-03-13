import { Cli, z } from 'incur'
import { registerHealthCrudCommands, healthPayloadSchema } from './health-command-factory.js'
import { pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const scaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('family'),
  payload: healthPayloadSchema,
})

const upsertResultSchema = z.object({
  vault: pathSchema,
  familyMemberId: z.string().min(1),
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

interface FamilyServices extends VaultCliServices {
  core: VaultCliServices['core'] & {
    scaffoldFamilyMember(input: {
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof scaffoldResultSchema>>
    upsertFamilyMember(input: {
      input: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof upsertResultSchema>>
  }
  query: VaultCliServices['query'] & {
    showFamilyMember(input: {
      id: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof showResultSchema>>
    listFamilyMembers(input: {
      vault: string
      requestId: string | null
      status?: string
      cursor?: string
      limit?: number
    }): Promise<z.infer<typeof listResultSchema>>
  }
}

export function registerFamilyCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as FamilyServices
  const family = Cli.create('family', {
    description: 'Family registry commands for the health extension surface.',
  })

  registerHealthCrudCommands({
    descriptions: {
      list: 'List family members through the health read model.',
      scaffold: 'Emit a payload template for family member upserts.',
      show: 'Show one family member by canonical id or slug.',
      upsert: 'Upsert one family member from an @file.json payload.',
    },
    group: family,
    groupName: 'family',
    listStatusDescription: 'Optional family-member status to filter by.',
    noun: 'family member',
    outputs: {
      list: listResultSchema,
      scaffold: scaffoldResultSchema,
      show: showResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'family.json',
    pluralNoun: 'family members',
    services: {
      list(input) {
        return healthServices.query.listFamilyMembers(input)
      },
      scaffold(input) {
        return healthServices.core.scaffoldFamilyMember(input)
      },
      show(input) {
        return healthServices.query.showFamilyMember(input)
      },
      upsert(input) {
        return healthServices.core.upsertFamilyMember(input)
      },
    },
    showId: {
      description: 'Family member id or slug to show.',
      example: '<family-member-id>',
      fromUpsert(result) {
        return result.familyMemberId
      },
    },
  })

  cli.command(family)
}
