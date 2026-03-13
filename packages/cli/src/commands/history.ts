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

const scaffoldResultSchema = createHealthScaffoldResultSchema('history')

const upsertResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema.optional(),
  created: z.boolean(),
})

export function registerHistoryCommands(
  cli: Cli.Cli,
  services: VaultCliServices,
) {
  registerHealthCrudGroup(cli, {
    commandName: 'history',
    description: 'Timed health history commands for the extension surface.',
    descriptions: {
      list: 'List timed history events through the health read model.',
      scaffold: 'Emit a payload template for timed history events.',
      show: 'Show one timed history event.',
      upsert: 'Append one timed history event from an @file.json payload.',
    },
    listStatusDescription: 'Optional health-event status to filter by.',
    noun: 'history event',
    outputs: {
      list: healthListResultSchema,
      scaffold: scaffoldResultSchema,
      show: healthShowResultSchema,
      upsert: upsertResultSchema,
    },
    payloadFile: 'history.json',
    pluralNoun: 'history events',
    services: bindHealthCrudServices(services, {
      list: 'listHistoryEvents',
      scaffold: 'scaffoldHistoryEvent',
      show: 'showHistoryEvent',
      upsert: 'upsertHistoryEvent',
    }),
    showId: {
      description: 'Timed history event id to show.',
      example: '<history-event-id>',
      fromUpsert(result) {
        return result.eventId
      },
    },
  })
}
