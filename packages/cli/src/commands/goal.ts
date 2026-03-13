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

const scaffoldResultSchema = createHealthScaffoldResultSchema('goal')

const upsertResultSchema = z.object({
  vault: pathSchema,
  goalId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
})

export function registerGoalCommands(cli: Cli.Cli, services: VaultCliServices) {
  registerHealthCrudGroup(cli, {
    commandName: 'goal',
    description: 'Goal registry commands for the health extension surface.',
    descriptions: {
      list: 'List goals through the health read model.',
      scaffold: 'Emit a payload template for goal upserts.',
      show: 'Show one goal by canonical id or slug.',
      upsert: 'Upsert one goal from an @file.json payload.',
    },
    listStatusDescription: 'Optional goal status to filter by.',
    noun: 'goal',
    outputs: {
      list: healthListResultSchema,
      scaffold: scaffoldResultSchema,
      show: healthShowResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'goal.json',
    pluralNoun: 'goals',
    services: bindHealthCrudServices(services, {
      list: 'listGoals',
      scaffold: 'scaffoldGoal',
      show: 'showGoal',
      upsert: 'upsertGoal',
    }),
    showId: {
      description: 'Goal id or slug to show.',
      example: '<goal-id>',
      fromUpsert(result) {
        return result.goalId
      },
    },
  })
}
