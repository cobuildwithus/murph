import { Cli, z } from 'incur'
import {
  listItemSchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  deleteEventRecord,
  editEventRecord,
} from '@murphai/assistant-engine/usecases/event-record-mutations'
import {
  eventScaffoldKindSchema,
  showEventRecord,
} from '@murphai/assistant-engine/usecases/provider-event'
import type { VaultServices } from '@murphai/assistant-engine/vault-services'
import { registerLedgerEventEntityGroup } from './health-command-factory.js'
import {
  createEntityDeleteCommandConfig,
  createEventBackedEntityEditCommandConfig,
} from './record-mutation-command-helpers.js'

const eventIdSchema = z
  .string()
  .regex(/^evt_[0-9A-Za-z]+$/u, 'Expected a canonical event id in evt_* form.')

const eventScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('event'),
  kind: eventScaffoldKindSchema,
  payload: z.record(z.string(), z.unknown()),
})

const eventUpsertResultSchema = z.object({
  vault: pathSchema,
  eventId: z.string().min(1),
  lookupId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
})

const eventListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    kind: z.string().min(1).nullable(),
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
    tag: z.array(z.string().min(1)),
    experiment: slugSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

export function registerEventCommands(cli: Cli.Cli, services: VaultServices) {
  registerLedgerEventEntityGroup(cli, {
    commandName: 'event',
    description: 'Generic canonical event commands for event kinds without specialized nouns.',
    scaffold: {
      description: 'Emit an event payload template for one canonical event kind.',
      kindOption: eventScaffoldKindSchema.describe('Canonical event kind to scaffold.'),
      output: eventScaffoldResultSchema,
      async run(input) {
        return services.core.scaffoldEvent({
          kind: input.kind,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    upsert: {
      description: 'Append one canonical event from a JSON payload file or stdin.',
      output: eventUpsertResultSchema,
      async run(input) {
        return services.core.upsertEvent({
          vault: input.vault,
          requestId: input.requestId,
          inputFile: input.input,
        })
      },
    },
    show: {
      description: 'Show one canonical non-history event by event id.',
      argName: 'id',
      argSchema: eventIdSchema.describe('Canonical event id such as evt_<ULID>.'),
      output: showResultSchema,
      async run(input) {
        return services.query.showEvent({
          eventId: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    list: {
      description: 'List canonical non-history events with kind, date, tag, and experiment filters.',
      kindOption: z.string().min(1).optional(),
      tagOption: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional tag filter. Repeat --tag for multiple values.'),
      experimentOption: slugSchema.optional(),
      output: eventListResultSchema,
      async run(input) {
        return services.query.listEvents({
          vault: input.vault,
          requestId: input.requestId,
          kind: input.kind,
          from: input.from,
          to: input.to,
          tag: Array.isArray(input.tag) ? input.tag : undefined,
          experiment: input.experiment,
          limit: input.limit ?? 50,
        })
      },
    },
    additionalCommands: [
      createEventBackedEntityEditCommandConfig({
        arg: {
          name: 'id',
          schema: eventIdSchema.describe('Canonical event id such as evt_<ULID>.'),
        },
        description:
          'Edit one canonical event by merging a partial JSON patch or one or more path assignments into the saved record.',
        async run(input) {
          const result = await editEventRecord({
            vault: input.vault,
            lookup: input.lookup,
            entityLabel: 'event',
            inputFile: input.inputFile,
            set: input.set,
            clear: input.clear,
            dayKeyPolicy: input.dayKeyPolicy,
          })

          return showEventRecord(input.vault, result.lookupId)
        },
      }),
      createEntityDeleteCommandConfig({
        arg: {
          name: 'id',
          schema: eventIdSchema.describe('Canonical event id such as evt_<ULID>.'),
        },
        description: 'Delete one canonical event by event id.',
        run(input) {
          return deleteEventRecord({
            vault: input.vault,
            lookup: input.lookup,
            entityLabel: 'event',
          })
        },
      }),
    ],
  })
}
