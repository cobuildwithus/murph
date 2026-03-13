import { Cli, z } from 'incur'
import {
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import {
  listResultSchema,
  journalEnsureResultSchema,
  localDateSchema,
  showResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

export const journalMutationResultSchema = z.object({
  vault: z.string().min(1),
  date: localDateSchema,
  lookupId: z.string().min(1),
  journalPath: z.string().min(1),
  created: z.boolean(),
  updated: z.boolean(),
})

const journalLinkResultSchema = z.object({
  vault: z.string().min(1),
  date: localDateSchema,
  lookupId: z.string().min(1),
  journalPath: z.string().min(1),
  created: z.boolean(),
  changed: z.number().int().nonnegative(),
  eventIds: z.array(z.string().min(1)),
  sampleStreams: z.array(z.string().min(1)),
})

const journalReferenceOptionsSchema = withBaseOptions({
  eventId: z
    .array(z.string().min(1))
    .optional()
    .describe('Optional event ids to mutate. Repeat --event-id for multiple values.'),
  stream: z
    .array(z.string().min(1))
    .optional()
    .describe('Optional sample streams to mutate. Repeat --stream for multiple values.'),
}).refine(
  (value) =>
    (Array.isArray(value.eventId) && value.eventId.length > 0) ||
    (Array.isArray(value.stream) && value.stream.length > 0),
  'Expected at least one of --event-id or --stream.',
)

export function registerJournalCommands(cli: Cli.Cli, _services: VaultCliServices) {
  const journal = Cli.create('journal', {
    description: 'Journal document commands routed through the core write API.',
  })

  journal.command(
    'ensure',
    {
      description: 'Create or confirm the daily journal document for a date.',
      args: z.object({
        date: localDateSchema,
      }),
      options: withBaseOptions(),
      output: journalEnsureResultSchema,
      async run({ args, options }) {
        const result = await _services.core.ensureJournal({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          date: args.date,
        })
        return result
      },
    },
  )

  journal.command('show', {
    description: 'Show the journal document for one day.',
    args: z.object({
      date: localDateSchema.describe('Journal day to read.'),
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return _services.query.showJournal({
        date: args.date,
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
    },
  })

  journal.command('list', {
    description: 'List journal documents over an optional date range.',
    args: z.object({}),
    options: withBaseOptions({
      from: localDateSchema.optional().describe('Inclusive lower date bound.'),
      to: localDateSchema.optional().describe('Inclusive upper date bound.'),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: listResultSchema,
    async run({ options }) {
      const result = await _services.query.listJournals({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        from: options.from,
        to: options.to,
        limit: options.limit,
      })
      return result as z.infer<typeof listResultSchema>
    },
  })

  journal.command('append', {
    description: 'Append freeform markdown text to one journal day.',
    args: z.object({
      date: localDateSchema.describe('Journal day to mutate.'),
    }),
    options: withBaseOptions({
      text: z.string().min(1).describe('Markdown text block to append.'),
    }),
    output: journalMutationResultSchema,
    async run({ args, options }) {
      return _services.core.appendJournal({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: args.date,
        text: options.text,
      })
    },
  })

  journal.command('link', {
    description: 'Link event ids and/or sample streams into the journal day frontmatter.',
    args: z.object({
      date: localDateSchema.describe('Journal day to mutate.'),
    }),
    options: journalReferenceOptionsSchema,
    output: journalLinkResultSchema,
    async run({ args, options }) {
      return mutateJournalReferences(_services, {
        operation: 'link',
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: args.date,
        eventIds: options.eventId,
        sampleStreams: options.stream,
      })
    },
  })

  journal.command('unlink', {
    description: 'Remove event ids and/or sample streams from the journal day frontmatter.',
    args: z.object({
      date: localDateSchema.describe('Journal day to mutate.'),
    }),
    options: journalReferenceOptionsSchema,
    output: journalLinkResultSchema,
    async run({ args, options }) {
      return mutateJournalReferences(_services, {
        operation: 'unlink',
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: args.date,
        eventIds: options.eventId,
        sampleStreams: options.stream,
      })
    },
  })

  cli.command(journal)
}

async function mutateJournalReferences(
  services: VaultCliServices,
  input: {
    operation: 'link' | 'unlink'
    vault: string
    requestId: string | null
    date: string
    eventIds?: string[]
    sampleStreams?: string[]
  },
) {
  const eventIds = normalizeRepeatedValues(input.eventIds)
  const sampleStreams = normalizeRepeatedValues(input.sampleStreams)

  let result:
    | z.infer<typeof journalLinkResultSchema>
    | null = null

  if (eventIds) {
    result =
      input.operation === 'link'
        ? await services.core.linkJournalEvents({
            vault: input.vault,
            requestId: input.requestId,
            date: input.date,
            eventIds,
          })
        : await services.core.unlinkJournalEvents({
            vault: input.vault,
            requestId: input.requestId,
            date: input.date,
            eventIds,
          })
  }

  if (sampleStreams) {
    const nextResult =
      input.operation === 'link'
        ? await services.core.linkJournalStreams({
            vault: input.vault,
            requestId: input.requestId,
            date: input.date,
            sampleStreams,
          })
        : await services.core.unlinkJournalStreams({
            vault: input.vault,
            requestId: input.requestId,
            date: input.date,
            sampleStreams,
          })
    result = mergeJournalLinkResults(result, nextResult)
  }

  return result as z.infer<typeof journalLinkResultSchema>
}

function mergeJournalLinkResults(
  previous: z.infer<typeof journalLinkResultSchema> | null,
  next: z.infer<typeof journalLinkResultSchema>,
) {
  if (!previous) {
    return next
  }

  return {
    ...next,
    created: previous.created || next.created,
    changed: previous.changed + next.changed,
  }
}

function normalizeRepeatedValues(
  values: string[] | undefined,
): string[] | undefined {
  if (!Array.isArray(values)) {
    return undefined
  }

  const normalized = [
    ...new Set(
      values
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ]

  return normalized.length > 0 ? normalized : undefined
}
