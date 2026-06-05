import { Cli, z } from 'incur'
import { emptyArgsSchema, withBaseOptions } from '@murphai/operator-config/command-helpers'
import { ALL_QUERY_ENTITY_FAMILIES } from '@murphai/query/entity-families'
import { loadQueryRuntime } from '@murphai/vault-usecases/runtime'
import {
  isoTimestampSchema,
  localDateSchema,
  pathSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  normalizeRepeatableEnumFlagOption,
  normalizeRepeatableFlagOption,
} from '@murphai/vault-usecases'

const recordTypeValues = ALL_QUERY_ENTITY_FAMILIES
const recordTypeDescription =
  `Optional query record families. Repeat --record-type for multiple values: ${recordTypeValues.join(', ')}.`

const timelineEntryTypeValues = [
  'assessment',
  'journal',
  'event',
  'sample_summary',
] as const

const searchHitSchema = z.object({
  recordId: z.string().min(1),
  aliasIds: z.array(z.string().min(1)),
  recordType: z.enum(recordTypeValues),
  kind: z.string().min(1).nullable(),
  stream: z.string().min(1).nullable(),
  title: z.string().min(1).nullable(),
  occurredAt: z.string().min(1).nullable(),
  date: localDateSchema.nullable(),
  experimentSlug: z.string().min(1).nullable(),
  tags: z.array(z.string().min(1)),
  path: pathSchema,
  snippet: z.string(),
  score: z.number(),
  matchedTerms: z.array(z.string().min(1)),
  citation: z.object({
    path: pathSchema,
    recordId: z.string().min(1),
    aliasIds: z.array(z.string().min(1)),
  }),
})

const searchResultSchema = z.object({
  vault: pathSchema,
  query: z.string().min(1),
  filters: z.object({
    text: z.string().min(1),
    recordTypes: z.array(z.enum(recordTypeValues)),
    kinds: z.array(z.string().min(1)),
    streams: z.array(z.string().min(1)),
    experiment: slugSchema.nullable(),
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
    tags: z.array(z.string().min(1)),
    limit: z.number().int().positive().max(200),
  }),
  total: z.number().int().nonnegative(),
  hits: z.array(searchHitSchema),
})

const timelineEntrySchema = z.object({
  id: z.string().min(1),
  entryType: z.enum(timelineEntryTypeValues),
  occurredAt: z.string().min(1),
  date: localDateSchema,
  title: z.string().min(1),
  kind: z.string().min(1),
  stream: z.string().min(1).nullable(),
  experimentSlug: z.string().min(1).nullable(),
  path: pathSchema.nullable(),
  relatedIds: z.array(z.string().min(1)),
  tags: z.array(z.string().min(1)),
})

const timelineResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
    experiment: slugSchema.nullable(),
    kinds: z.array(z.string().min(1)),
    streams: z.array(z.string().min(1)),
    entryTypes: z.array(z.enum(timelineEntryTypeValues)),
    limit: z.number().int().positive().max(500),
  }),
  items: z.array(timelineEntrySchema),
})

const queryProjectionStatusSchema = z.object({
  vault: pathSchema,
  dbPath: pathSchema,
  exists: z.boolean(),
  schemaVersion: z.string().min(1).nullable(),
  builtAt: isoTimestampSchema.nullable(),
  entityCount: z.number().int().nonnegative(),
  searchDocumentCount: z.number().int().nonnegative(),
  fresh: z.boolean(),
})

const queryProjectionRebuildSchema = queryProjectionStatusSchema.extend({
  rebuilt: z.literal(true),
})

function normalizeSearchQueryInput(input: {
  positionalQuery?: string
  namedQuery?: string
}): string {
  const positionalQuery = input.positionalQuery?.trim()
  const namedQuery = input.namedQuery?.trim()

  if (input.positionalQuery !== undefined && !positionalQuery) {
    throw new VaultCliError(
      'invalid_query',
      'Positional search text must not be blank.',
    )
  }

  if (input.namedQuery !== undefined && !namedQuery) {
    throw new VaultCliError(
      'invalid_query',
      'Search text passed to `--text` must not be blank.',
    )
  }

  if (positionalQuery && namedQuery && positionalQuery !== namedQuery) {
    throw new VaultCliError(
      'invalid_query',
      'Positional search text and `--text` must match when both are provided.',
    )
  }

  const text = positionalQuery ?? namedQuery
  if (!text) {
    throw new VaultCliError(
      'invalid_query',
      'Search text is required for `search query`. Use `search query <query>` or `search query --text "<query>"`.',
    )
  }

  return text
}

export function registerSearchCommands(cli: Cli.Cli) {
  const search = Cli.create('search', {
    description:
      'Search commands for the shared local query projection over canonical vault records.',
  })

  search.command('query', {
    description:
      'Search the shared local query projection when the target is fuzzy or remembered by phrase rather than exact id. Provide the query either positionally or with `--text`.',
    args: z.object({
      query: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Positional search text. Required when `--text` is omitted; prefer this direct CLI form when searching by one remembered phrase.',
        ),
    }),
    options: withBaseOptions({
      text: z
        .string()
        .min(1)
        .optional()
        .describe(
          'Named search text alias. Required when the positional query is omitted; use this for explicit machine-oriented calls.',
        ),
      recordType: z
        .array(z.string().min(1))
        .optional()
        .describe(recordTypeDescription),
      kind: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional record kinds such as meal, note, document, or journal_day. Repeat --kind for multiple values.'),
      stream: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional stream filter for stream-carrying records, including query-visible metric samples and summaries. Repeat --stream for multiple values.'),
      experiment: slugSchema
        .optional()
        .describe('Optional experiment slug filter.'),
      from: localDateSchema
        .optional()
        .describe('Inclusive lower date bound.'),
      to: localDateSchema
        .optional()
        .describe('Inclusive upper date bound.'),
      tag: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional tags that matching records must contain. Repeat --tag for multiple values.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(200)
        .default(20)
        .describe('Maximum number of hits to return.'),
    }),
    examples: [
      {
        description: 'Find prior mentions of magnesium across records and notes.',
        args: {
          query: 'magnesium',
        },
        options: {
          vault: './vault',
        },
      },
      {
        description: 'Search only assessment, event, and regimen records for insulin sensitivity mentions.',
        args: {
          query: 'insulin sensitivity',
        },
        options: {
          recordType: ['assessment', 'event', 'regimen'],
          vault: './vault',
        },
      },
      {
        description: 'Use the explicit named text form when a caller prefers fully named options.',
        options: {
          text: 'sauna recovery',
          vault: './vault',
        },
      },
    ],
    hint:
      'Use `search query <query>` for direct fuzzy recall, or `search query --text "<query>"` for explicit machine-oriented calls. Use `show` for one exact id, `list` for structured filters, and `timeline` for chronology.',
    output: searchResultSchema,
    async run({ args, options }) {
      const query = await loadQueryRuntime()
      const text = normalizeSearchQueryInput({
        positionalQuery: args.query,
        namedQuery: options.text,
      })

      const recordTypes =
        normalizeRepeatableEnumFlagOption(
          options.recordType,
          'record-type',
          recordTypeValues,
        ) ?? []
      const kinds = normalizeRepeatableFlagOption(options.kind, 'kind') ?? []
      const streams = normalizeRepeatableFlagOption(options.stream, 'stream') ?? []
      const tags = normalizeRepeatableFlagOption(options.tag, 'tag') ?? []
      const result = await query.searchVaultRuntime(
        options.vault,
        text,
        {
          recordTypes: recordTypes.length > 0 ? recordTypes : undefined,
          kinds: kinds.length > 0 ? kinds : undefined,
          streams: streams.length > 0 ? streams : undefined,
          experimentSlug: options.experiment,
          from: options.from,
          to: options.to,
          tags: tags.length > 0 ? tags : undefined,
          limit: options.limit,
        },
      )

      return {
        vault: options.vault,
        query: result.query,
        filters: {
          text,
          recordTypes,
          kinds,
          streams,
          experiment: options.experiment ?? null,
          from: options.from ?? null,
          to: options.to ?? null,
          tags,
          limit: options.limit,
        },
        total: result.total,
        hits: result.hits as z.infer<typeof searchResultSchema>['hits'],
      }
    },
  })
  cli.command(search)

  const query = Cli.create('query', {
    description:
      'Commands for the shared local query projection that powers canonical reads and lexical search.',
  })

  const projection = Cli.create('projection', {
    description:
      'Inspect and rebuild the shared local query projection under .runtime/projections/query.sqlite.',
  })

  projection.command('status', {
    description: 'Show the current query projection status and freshness.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
    output: queryProjectionStatusSchema,
    async run({ options }) {
      const queryRuntime = await loadQueryRuntime()
      const status = await queryRuntime.getQueryProjectionStatus(options.vault)

      return {
        vault: options.vault,
        ...status,
      }
    },
  })

  projection.command('rebuild', {
    description: 'Rebuild the shared local query projection from canonical vault data.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
    output: queryProjectionRebuildSchema,
    async run({ options }) {
      const queryRuntime = await loadQueryRuntime()
      const rebuilt = await queryRuntime.rebuildQueryProjection(options.vault)

      return {
        vault: options.vault,
        ...rebuilt,
      }
    },
  })

  query.command(projection)
  cli.command(query)

  cli.command(
    'timeline',
    {
      description:
        'Build a descending cross-record timeline when the question is about what changed, what happened over a window, or what stood out over time.',
      args: emptyArgsSchema,
      options: withBaseOptions({
        from: localDateSchema
          .optional()
          .describe('Inclusive lower date bound.'),
        to: localDateSchema
          .optional()
          .describe('Inclusive upper date bound.'),
        experiment: slugSchema
          .optional()
          .describe('Optional experiment slug filter.'),
        kind: z
          .array(z.string().min(1))
          .optional()
          .describe('Optional entry kinds such as meal, note, journal_day, or sample_summary. Repeat --kind for multiple values.'),
        stream: z
          .array(z.string().min(1))
          .optional()
          .describe('Optional streams; applies to metric sample summaries and any stream-carrying events. Repeat --stream for multiple values.'),
        entryType: z
          .array(z.string().min(1))
          .optional()
          .describe('Optional entry types: journal, event, assessment, sample_summary. Repeat --entry-type for multiple values.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .default(50)
          .describe('Maximum number of timeline entries to return.'),
      }),
      examples: [
        {
          description: 'Review what happened across journals, events, and summaries over the last week.',
          options: {
            from: '2026-04-01',
            to: '2026-04-07',
            vault: './vault',
          },
        },
        {
          description: 'Review recovery-related sample summaries over one experiment window.',
          options: {
            entryType: ['sample_summary'],
            stream: ['hrv', 'resting_heart_rate'],
            experiment: 'sleep-reset',
            vault: './vault',
          },
        },
      ],
      hint:
        'Use `timeline` when you need chronology across journals, events, assessments, and sample summaries. Drill into `show` or family-specific reads after you find the relevant entries.',
      output: timelineResultSchema,
      async run({ options }) {
        const kinds = normalizeRepeatableFlagOption(options.kind, 'kind') ?? []
        const streams = normalizeRepeatableFlagOption(options.stream, 'stream') ?? []
        const entryTypes =
          normalizeRepeatableEnumFlagOption(
            options.entryType,
            'entry-type',
            timelineEntryTypeValues,
          ) ?? []
        const entryTypeSet = entryTypes.length > 0 ? new Set(entryTypes) : null
        const query = await loadQueryRuntime()
        const vault = await query.readVault(options.vault)
        const items = query.buildTimeline(vault, {
          from: options.from,
          to: options.to,
          experimentSlug: options.experiment,
          kinds: kinds.length > 0 ? kinds : undefined,
          streams: streams.length > 0 ? streams : undefined,
          includeJournal: entryTypeSet ? entryTypeSet.has('journal') : true,
          includeEvents: entryTypeSet ? entryTypeSet.has('event') : true,
          includeAssessments: entryTypeSet ? entryTypeSet.has('assessment') : true,
          includeDailySampleSummaries: entryTypeSet
            ? entryTypeSet.has('sample_summary')
            : true,
          limit: options.limit,
        })

        return {
          vault: options.vault,
          filters: {
            from: options.from ?? null,
            to: options.to ?? null,
            experiment: options.experiment ?? null,
            kinds,
            streams,
            entryTypes,
            limit: options.limit,
          },
          items: items.map((item) => ({
            id: item.id,
            entryType: item.entryType,
            occurredAt: item.occurredAt,
            date: item.date,
            title: item.title,
            kind: item.kind,
            stream: item.stream,
            experimentSlug: item.experimentSlug,
            path: item.path,
            relatedIds: item.relatedIds,
            tags: item.tags,
          })),
        }
      },
    },
  )
}
