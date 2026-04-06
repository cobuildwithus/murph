import { Cli, z } from 'incur'
import { emptyArgsSchema, withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  ALL_QUERY_ENTITY_FAMILIES,
  loadQueryRuntime,
} from '@murphai/assistant-engine/query-runtime'
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
} from '@murphai/assistant-engine/option-utils'
import type { VaultServices } from '@murphai/vault-inbox/vault-services'

const recordTypeValues = ALL_QUERY_ENTITY_FAMILIES

const timelineEntryTypeValues = [
  'assessment',
  'history',
  'journal',
  'profile_snapshot',
  'event',
  'sample_summary',
] as const
const searchBackendValues = ['auto', 'scan', 'sqlite'] as const

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
    backend: z.enum(searchBackendValues),
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
  data: z.record(z.string(), z.unknown()),
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

const searchIndexStatusSchema = z.object({
  vault: pathSchema,
  backend: z.literal('sqlite'),
  dbPath: pathSchema,
  exists: z.boolean(),
  schemaVersion: z.string().min(1).nullable(),
  indexedAt: isoTimestampSchema.nullable(),
  documentCount: z.number().int().nonnegative(),
})

const searchIndexRebuildSchema = searchIndexStatusSchema.extend({
  rebuilt: z.literal(true),
})

export function registerSearchCommands(
  cli: Cli.Cli,
  _services: VaultServices,
) {
  const search = Cli.create('search', {
    description:
      'Search commands for the local read model and the optional SQLite lexical index.',
  })

  search.command('query', {
    description:
      'Search the local read model with lexical scoring and optional SQLite-backed candidate retrieval when the target is fuzzy or remembered by phrase rather than exact id.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      text: z
        .string()
        .min(1)
        .optional()
        .describe('Search text to run across titles, notes, tags, ids, and record payloads.'),
      backend: z
        .enum(searchBackendValues)
        .optional()
        .describe('Retrieval backend. Defaults to `auto`, which prefers SQLite when an index exists and otherwise falls back to the scan backend.'),
      recordType: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional record families. Repeat --record-type for multiple values: core, experiment, journal, event, sample, audit, assessment, profile_snapshot, current_profile, goal, condition, allergy, protocol, history, family, genetics.'),
      kind: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional record kinds such as meal, note, document, or journal_day. Repeat --kind for multiple values.'),
      stream: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional sample streams; setting this also opts sample rows into search. Repeat --stream for multiple values.'),
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
        options: {
          text: 'magnesium',
          vault: './vault',
        },
      },
      {
        description: 'Search only profile and protocol records for insulin sensitivity mentions.',
        options: {
          text: 'insulin sensitivity',
          recordType: ['profile_snapshot', 'current_profile', 'protocol'],
          vault: './vault',
        },
      },
    ],
    hint:
      'Use `search query` for fuzzy recall or remembered phrases. Use `show` for one exact id, `list` for structured filters, and `timeline` for chronology.',
    output: searchResultSchema,
    async run({ options }) {
      const query = await loadQueryRuntime()
      const text = options.text?.trim()

      if (!text) {
        throw new VaultCliError(
          'invalid_query',
          'Search text is required for `search query`.',
        )
      }

      const recordTypes =
        normalizeRepeatableEnumFlagOption(
          options.recordType,
          'record-type',
          recordTypeValues,
        ) ?? []
      const kinds = normalizeRepeatableFlagOption(options.kind, 'kind') ?? []
      const streams = normalizeRepeatableFlagOption(options.stream, 'stream') ?? []
      const tags = normalizeRepeatableFlagOption(options.tag, 'tag') ?? []
      const backend = options.backend ?? 'auto'
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
        { backend },
      )

      return {
        vault: options.vault,
        query: result.query,
        filters: {
          text,
          backend,
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

  const index = Cli.create('index', {
    description: 'Inspect and rebuild the optional SQLite lexical search index.',
  })

  index.command('status', {
    description: 'Show the current SQLite lexical search index status.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
    output: searchIndexStatusSchema,
    async run({ options }) {
      const query = await loadQueryRuntime()
      const status = query.getSqliteSearchStatus(options.vault)

      return {
        vault: options.vault,
        ...status,
      }
    },
  })

  index.command('rebuild', {
    description: 'Rebuild the SQLite lexical search index from the current read model.',
    args: emptyArgsSchema,
    options: withBaseOptions(),
    output: searchIndexRebuildSchema,
    async run({ options }) {
      const query = await loadQueryRuntime()
      const rebuilt = await query.rebuildSqliteSearchIndex(options.vault)

      return {
        vault: options.vault,
        ...rebuilt,
      }
    },
  })

  search.command(index)
  cli.command(search)

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
          .describe('Optional streams; applies to sample summaries and any stream-carrying events. Repeat --stream for multiple values.'),
        entryType: z
          .array(z.string().min(1))
          .optional()
          .describe('Optional entry types: journal, event, assessment, history, profile_snapshot, sample_summary. Repeat --entry-type for multiple values.'),
        limit: z
          .number()
          .int()
          .positive()
          .max(500)
          .default(200)
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
        'Use `timeline` when you need chronology across journals, events, assessments, profile snapshots, and sample summaries. Drill into `show` or family-specific reads after you find the relevant entries.',
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
          includeHistory: entryTypeSet ? entryTypeSet.has('history') : true,
          includeProfileSnapshots: entryTypeSet
            ? entryTypeSet.has('profile_snapshot')
            : true,
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
          items: items as z.infer<typeof timelineResultSchema>['items'],
        }
      },
    },
  )
}
