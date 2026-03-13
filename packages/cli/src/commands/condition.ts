import { Cli, z } from 'incur'
import { registerHealthCrudCommands, healthPayloadSchema } from './health-command-factory.js'
import { pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const scaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('condition'),
  payload: healthPayloadSchema,
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
  entity: healthPayloadSchema,
})

const listResultSchema = z.object({
  vault: pathSchema,
  items: z.array(healthPayloadSchema),
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

export function registerConditionCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as ConditionServices
  const condition = Cli.create('condition', {
    description: 'Condition registry commands for the health extension surface.',
  })

  registerHealthCrudCommands({
    descriptions: {
      list: 'List conditions through the health read model.',
      scaffold: 'Emit a payload template for condition upserts.',
      show: 'Show one condition by canonical id or slug.',
      upsert: 'Upsert one condition from an @file.json payload.',
    },
    group: condition,
    groupName: 'condition',
    listStatusDescription: 'Optional condition status to filter by.',
    noun: 'condition',
    outputs: {
      list: listResultSchema,
      scaffold: scaffoldResultSchema,
      show: showResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'condition.json',
    pluralNoun: 'conditions',
    services: {
      list(input) {
        return healthServices.query.listConditions(input)
      },
      scaffold(input) {
        return healthServices.core.scaffoldCondition(input)
      },
      show(input) {
        return healthServices.query.showCondition(input)
      },
      upsert(input) {
        return healthServices.core.upsertCondition(input)
      },
    },
    showId: {
      description: 'Condition id or slug to show.',
      example: '<condition-id>',
      fromUpsert(result) {
        return result.conditionId
      },
    },
  })

  cli.command(condition)
}
