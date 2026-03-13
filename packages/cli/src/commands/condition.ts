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

const scaffoldResultSchema = createHealthScaffoldResultSchema('condition')

const upsertResultSchema = z.object({
  vault: pathSchema,
  conditionId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
})

export function registerConditionCommands(
  cli: Cli.Cli,
  services: VaultCliServices,
) {
  registerHealthCrudGroup(cli, {
    commandName: 'condition',
    description: 'Condition registry commands for the health extension surface.',
    descriptions: {
      list: 'List conditions through the health read model.',
      scaffold: 'Emit a payload template for condition upserts.',
      show: 'Show one condition by canonical id or slug.',
      upsert: 'Upsert one condition from an @file.json payload.',
    },
    listStatusDescription: 'Optional condition status to filter by.',
    noun: 'condition',
    outputs: {
      list: healthListResultSchema,
      scaffold: scaffoldResultSchema,
      show: healthShowResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'condition.json',
    pluralNoun: 'conditions',
    services: bindHealthCrudServices(services, {
      list: 'listConditions',
      scaffold: 'scaffoldCondition',
      show: 'showCondition',
      upsert: 'upsertCondition',
    }),
    showId: {
      description: 'Condition id or slug to show.',
      example: '<condition-id>',
      fromUpsert(result) {
        return result.conditionId
      },
    },
  })
}
