import { Cli, z } from 'incur'
import {
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  listResultSchema,
  journalEnsureResultSchema,
  localDateSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import type { VaultServices } from '@murphai/vault-usecases'
import { normalizeRepeatableFlagOption } from '@murphai/vault-usecases'
import {
  commonDateRangeOptionDescriptions,
  commonListLimitOptionSchema,
} from './command-factory-primitives.js'

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
    .describe(
      'Optional event ids to mutate. Repeat --event-id for multiple values. Mutually exclusive with --stream.',
    ),
  stream: z
    .array(z.string().min(1))
    .optional()
    .describe(
      'Optional sample streams to mutate. Repeat --stream for multiple values. Mutually exclusive with --event-id.',
    ),
})

const journalReferenceArgsSchema = z.object({
  date: localDateSchema.describe('Journal day to mutate.'),
})

const journalReferenceCommandHint =
  'Choose exactly one target type per command: repeat --event-id for events or repeat --stream for sample streams.'

export function registerJournalCommands(cli: Cli.Cli, _services: VaultServices) {
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
      from: localDateSchema
        .optional()
        .describe(commonDateRangeOptionDescriptions.from),
      to: localDateSchema
        .optional()
        .describe(commonDateRangeOptionDescriptions.to),
      limit: commonListLimitOptionSchema,
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

  journal.command('link', createJournalReferenceCommandDefinition(_services, 'link'))
  journal.command('unlink', createJournalReferenceCommandDefinition(_services, 'unlink'))

  cli.command(journal)
}

async function mutateJournalReferences(
  services: VaultServices,
  input: {
    operation: 'link' | 'unlink'
    vault: string
    requestId: string | null
    date: string
    eventIds?: string[]
    sampleStreams?: string[]
  },
) {
  const eventIds = normalizeRepeatableFlagOption(input.eventIds, 'event-id')
  const sampleStreams = normalizeRepeatableFlagOption(input.sampleStreams, 'stream')

  if (!eventIds && !sampleStreams) {
    throw new VaultCliError(
      'invalid_option',
      'Expected at least one of --event-id or --stream.',
    )
  }

  if (eventIds && sampleStreams) {
    throw new VaultCliError(
      'invalid_option',
      'Pass either --event-id or --stream in one command.',
    )
  }

  if (eventIds) {
    return input.operation === 'link'
      ? services.core.linkJournalEvents({
          vault: input.vault,
          requestId: input.requestId,
          date: input.date,
          eventIds,
        })
      : services.core.unlinkJournalEvents({
          vault: input.vault,
          requestId: input.requestId,
          date: input.date,
          eventIds,
        })
  }

  if (sampleStreams) {
    return input.operation === 'link'
      ? services.core.linkJournalStreams({
          vault: input.vault,
          requestId: input.requestId,
          date: input.date,
          sampleStreams,
        })
      : services.core.unlinkJournalStreams({
          vault: input.vault,
          requestId: input.requestId,
          date: input.date,
          sampleStreams,
        })
  }

  throw new VaultCliError(
    'command_failed',
    'Journal reference mutation requires normalized event ids or streams.',
  )
}

function createJournalReferenceCommandDefinition(
  services: VaultServices,
  operation: 'link' | 'unlink',
) {
  return {
    description:
      operation === 'link'
        ? 'Link either event ids or sample streams into the journal day frontmatter.'
        : 'Remove either event ids or sample streams from the journal day frontmatter.',
    args: journalReferenceArgsSchema,
    hint: journalReferenceCommandHint,
    options: journalReferenceOptionsSchema,
    output: journalLinkResultSchema,
    async run({ args, options }: {
      args: z.infer<typeof journalReferenceArgsSchema>
      options: z.infer<typeof journalReferenceOptionsSchema>
    }) {
      return mutateJournalReferences(services, {
        operation,
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        date: args.date,
        eventIds: options.eventId,
        sampleStreams: options.stream,
      })
    },
  }
}
