import { Cli, z } from 'incur'
import { registerHealthCrudCommands, healthPayloadSchema } from './health-command-factory.js'
import { pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const scaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('goal'),
  payload: healthPayloadSchema,
})

const upsertResultSchema = z.object({
  vault: pathSchema,
  goalId: z.string().min(1),
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

interface GoalServices extends VaultCliServices {
  core: VaultCliServices['core'] & {
    scaffoldGoal(input: {
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof scaffoldResultSchema>>
    upsertGoal(input: {
      input: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof upsertResultSchema>>
  }
  query: VaultCliServices['query'] & {
    showGoal(input: {
      id: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof showResultSchema>>
    listGoals(input: {
      vault: string
      requestId: string | null
      status?: string
      cursor?: string
      limit?: number
    }): Promise<z.infer<typeof listResultSchema>>
  }
}

export function registerGoalCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as GoalServices
  const goal = Cli.create('goal', {
    description: 'Goal registry commands for the health extension surface.',
  })

  registerHealthCrudCommands({
    descriptions: {
      list: 'List goals through the health read model.',
      scaffold: 'Emit a payload template for goal upserts.',
      show: 'Show one goal by canonical id or slug.',
      upsert: 'Upsert one goal from an @file.json payload.',
    },
    group: goal,
    groupName: 'goal',
    listStatusDescription: 'Optional goal status to filter by.',
    noun: 'goal',
    outputs: {
      list: listResultSchema,
      scaffold: scaffoldResultSchema,
      show: showResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'goal.json',
    pluralNoun: 'goals',
    services: {
      list(input) {
        return healthServices.query.listGoals(input)
      },
      scaffold(input) {
        return healthServices.core.scaffoldGoal(input)
      },
      show(input) {
        return healthServices.query.showGoal(input)
      },
      upsert(input) {
        return healthServices.core.upsertGoal(input)
      },
    },
    showId: {
      description: 'Goal id or slug to show.',
      example: '<goal-id>',
      fromUpsert(result) {
        return result.goalId
      },
    },
  })

  cli.command(goal)
}
