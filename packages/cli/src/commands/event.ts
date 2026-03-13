import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '../json-input.js'
import {
  listItemSchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
  slugSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import {
  eventScaffoldKindSchema,
} from './event-command-helpers.js'

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

export function registerEventCommands(cli: Cli.Cli, services: VaultCliServices) {
  const event = Cli.create('event', {
    description: 'Generic canonical event commands for event kinds without specialized nouns.',
  })

  event.command('scaffold', {
    description: 'Emit an event payload template for one canonical event kind.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      kind: eventScaffoldKindSchema.describe('Canonical event kind to scaffold.'),
    }),
    output: eventScaffoldResultSchema,
    async run({ options }) {
      const result = await services.core.scaffoldEvent({
        kind: options.kind,
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
      return result as z.infer<typeof eventScaffoldResultSchema>
    },
  })

  event.command('upsert', {
    description: 'Append one canonical event from a JSON payload file or stdin.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: eventUpsertResultSchema,
    async run({ options }) {
      return services.core.upsertEvent({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        inputFile: normalizeInputFileOption(options.input),
      })
    },
  })

  event.command('show', {
    description: 'Show one canonical non-history event by event id.',
    args: z.object({
      id: eventIdSchema.describe('Canonical event id such as evt_<ULID>.'),
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return services.query.showEvent({
        eventId: args.id,
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
    },
  })

  event.command('list', {
    description: 'List canonical non-history events with kind, date, tag, and experiment filters.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      kind: z.string().min(1).optional(),
      from: localDateSchema.optional(),
      to: localDateSchema.optional(),
      tag: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional tag filter. Repeat --tag for multiple values.'),
      experiment: slugSchema.optional(),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: eventListResultSchema,
    async run({ options }) {
      const result = await services.query.listEvents({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        kind: options.kind,
        from: options.from,
        to: options.to,
        tag: options.tag,
        experiment: options.experiment,
        limit: options.limit,
      })
      return result as z.infer<typeof eventListResultSchema>
    },
  })

  cli.command(event)
}
