import { Cli, z } from 'incur'
import { registerHealthCrudCommands } from './health-command-factory.js'
import {
  createHealthScaffoldResultSchema,
  healthListResultSchema,
  healthShowResultSchema,
} from '../health-cli-descriptors.js'
import { pathSchema } from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const scaffoldResultSchema = createHealthScaffoldResultSchema('history')

const upsertResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema.optional(),
  created: z.boolean(),
})

const showResultSchema = healthShowResultSchema
const listResultSchema = healthListResultSchema

interface HistoryServices extends VaultCliServices {
  core: VaultCliServices['core'] & {
    scaffoldHistoryEvent(input: {
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof scaffoldResultSchema>>
    upsertHistoryEvent(input: {
      input: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof upsertResultSchema>>
  }
  query: VaultCliServices['query'] & {
    showHistoryEvent(input: {
      id: string
      vault: string
      requestId: string | null
    }): Promise<z.infer<typeof showResultSchema>>
    listHistoryEvents(input: {
      vault: string
      requestId: string | null
      status?: string
      cursor?: string
      limit?: number
    }): Promise<z.infer<typeof listResultSchema>>
  }
}

export function registerHistoryCommands(cli: Cli.Cli, services: VaultCliServices) {
  const healthServices = services as HistoryServices
  const history = Cli.create('history', {
    description: 'Timed health history commands for the extension surface.',
  })

  registerHealthCrudCommands({
    descriptions: {
      list: 'List timed history events through the health read model.',
      scaffold: 'Emit a payload template for timed history events.',
      show: 'Show one timed history event.',
      upsert: 'Append one timed history event from an @file.json payload.',
    },
    group: history,
    groupName: 'history',
    listStatusDescription: 'Optional health-event status to filter by.',
    noun: 'history event',
    outputs: {
      list: listResultSchema,
      scaffold: scaffoldResultSchema,
      show: showResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'history.json',
    pluralNoun: 'history events',
    services: {
      list(input) {
        return healthServices.query.listHistoryEvents(input)
      },
      scaffold(input) {
        return healthServices.core.scaffoldHistoryEvent(input)
      },
      show(input) {
        return healthServices.query.showHistoryEvent(input)
      },
      upsert(input) {
        return healthServices.core.upsertHistoryEvent(input)
      },
    },
    showId: {
      description: 'Timed history event id to show.',
      example: '<history-event-id>',
      fromUpsert(result) {
        return result.eventId
      },
    },
  })

  cli.command(history)
}
