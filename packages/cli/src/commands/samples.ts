import { Cli, z } from 'incur'
import {
  SAMPLE_QUALITIES,
  SAMPLE_SOURCES,
  SAMPLE_STREAMS,
  SLEEP_STAGES,
  type JsonObject,
  type SampleStream,
} from '@murphai/contracts'
import { emptyArgsSchema, requestIdFromOptions, withBaseOptions } from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '@murphai/vault-usecases'
import { addSampleRecords } from '@murphai/vault-usecases/records'
import {
  isoTimestampSchema,
  listItemSchema,
  localDateSchema,
  pathSchema,
  samplesCsvProfileResultSchema,
  showResultSchema,
  samplesImportCsvResultSchema,
  samplesSummarizeResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  importCsvSamples as importCsvSamplesWithArtifacts,
  profileCsvSampleFile as profileCsvSampleFileWithArtifacts,
} from './sample-import-command-helpers.js'
import {
  listSampleBatches as listSampleBatchesWithArtifacts,
  showSampleBatch as showSampleBatchWithArtifacts,
} from './sample-batch-command-helpers.js'
import {
  listSamples as listSamplesWithArtifacts,
  showSample as showSampleWithArtifacts,
  summarizeSampleWindow as summarizeSampleWindowWithArtifacts,
} from './sample-query-command-helpers.js'
import { normalizeRepeatableFlagOption } from '@murphai/vault-usecases'

const sampleIdSchema = z
  .string()
  .regex(/^smp_[0-9A-Za-z]+$/u, 'Expected a canonical sample id in smp_* form.')

const batchIdSchema = z
  .string()
  .regex(/^xfm_[0-9A-Za-z]+$/u, 'Expected a transform batch id in xfm_* form.')

const batchSourceFileNameSchema = z
  .string()
  .trim()
  .min(1)
  .max(255)
  .refine(isBatchSourceFileName, 'Expected a file name without path separators.')

function isBatchSourceFileName(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 255 &&
    !value.startsWith('~') &&
    !/^[A-Za-z]:/u.test(value) &&
    !/[\\/]/u.test(value)
  )
}

function normalizeBatchSourceFileName(value: string): string {
  const fileName = value.trim()

  if (!isBatchSourceFileName(fileName)) {
    throw new VaultCliError(
      'invalid_option',
      '--batch-source-file-name must be a basename only; omit directories, home markers, and drive prefixes.',
    )
  }

  return fileName
}

const sampleSummaryProfileSchema = z
  .enum(['oxygen-night'])
  .describe('Optional summary preset. oxygen-night adds SpO2 thresholds and a cautious oxygen-trace screen.')

function normalizeThresholdBelowOption(value: number[] | undefined): number[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const entries = [...new Set(value.filter((entry) => Number.isFinite(entry)))]
  return entries.length > 0 ? entries : undefined
}

function buildCsvImportOptions(options: {
  delimiter?: string
  metadataColumns?: string[]
  preset?: string
  requestId?: string
  source?: string
  stream?: string
  tsColumn?: string
  unit?: string
  valueColumn?: string
  vault: string
}) {
  return {
    delimiter: options.delimiter,
    metadataColumns: normalizeRepeatableFlagOption(
      options.metadataColumns,
      'metadata-columns',
    ),
    presetId: options.preset,
    requestId: requestIdFromOptions(options),
    source: options.source,
    stream: options.stream,
    tsColumn: options.tsColumn,
    valueColumn: options.valueColumn,
    unit: options.unit,
  }
}

const sampleListItemSchema = listItemSchema.extend({
  quality: z.string().min(1).nullable(),
  stream: z.string().min(1).nullable(),
})

const samplesAddResultSchema = z.object({
  vault: pathSchema,
  stream: z.string().min(1),
  source: z.string().min(1),
  quality: z.string().min(1),
  addedCount: z.number().int().nonnegative(),
  lookupIds: z.array(z.string().min(1)).min(1),
  ledgerFiles: z.array(pathSchema).min(1),
})

const samplesListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    stream: z.string().min(1).nullable(),
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
    quality: z.string().min(1).nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(sampleListItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

const sampleBatchManifestSchema = z.object({}).catchall(z.unknown())

const sampleBatchShowResultSchema = z.object({
  vault: pathSchema,
  batchId: z.string().min(1),
  stream: z.string().min(1).nullable(),
  manifestFile: pathSchema,
  rawDirectory: pathSchema.nullable(),
  importedAt: z.string().min(1).nullable(),
  source: z.string().min(1).nullable(),
  importedCount: z.number().int().nonnegative().nullable(),
  importConfig: sampleBatchManifestSchema,
  artifacts: z.array(sampleBatchManifestSchema),
  manifest: sampleBatchManifestSchema,
})

const sampleBatchListItemSchema = z.object({
  batchId: z.string().min(1),
  stream: z.string().min(1).nullable(),
  manifestFile: pathSchema,
  importedAt: z.string().min(1).nullable(),
  source: z.string().min(1).nullable(),
  importedCount: z.number().int().nonnegative().nullable(),
})

const sampleBatchListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    stream: z.string().min(1).nullable(),
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(sampleBatchListItemSchema),
})

function requireNumericSampleValue(
  stream: SampleStream,
  value: number | undefined,
): number {
  if (value === undefined) {
    throw new VaultCliError(
      'invalid_option',
      `samples add requires --value for numeric stream "${stream}".`,
    )
  }

  return value
}

function validateNoSleepStageFieldsForNumericSample(input: {
  durationMinutes?: number
  endAt?: string
  stage?: string
  startAt?: string
}) {
  if (
    input.stage !== undefined ||
    input.startAt !== undefined ||
    input.endAt !== undefined ||
    input.durationMinutes !== undefined
  ) {
    throw new VaultCliError(
      'invalid_option',
      '--stage, --start-at, --end-at, and --duration-minutes are only valid with --stream sleep_stage.',
    )
  }
}

function requireSleepStageFields(input: {
  durationMinutes?: number
  endAt?: string
  stage?: string
  startAt?: string
  value?: number
}): {
  durationMinutes: number
  endAt: string
  stage: string
  startAt: string
} {
  if (input.value !== undefined) {
    throw new VaultCliError(
      'invalid_option',
      'sleep_stage samples use --stage, --start-at, --end-at, and --duration-minutes; omit --value.',
    )
  }

  const stage = input.stage
  const startAt = input.startAt
  const endAt = input.endAt
  const durationMinutes = input.durationMinutes

  if (
    stage === undefined ||
    startAt === undefined ||
    endAt === undefined ||
    durationMinutes === undefined
  ) {
    const missingFields = [
      ['stage', stage],
      ['start-at', startAt],
      ['end-at', endAt],
      ['duration-minutes', durationMinutes],
    ]
      .filter(([, value]) => value === undefined)
      .map(([field]) => `--${field}`)

    throw new VaultCliError(
      'invalid_option',
      `sleep_stage samples require ${missingFields.join(', ')}.`,
    )
  }

  return {
    stage,
    startAt,
    endAt,
    durationMinutes,
  }
}

function buildTypedSampleBatchProvenance(input: {
  batchDelimiter?: string
  batchMetadataColumns?: string[]
  batchPresetId?: string
  batchSourceFileName?: string
  batchTimestampColumn?: string
  batchValueColumn?: string
  recordedAt: string
  sourcePath?: string
  stream: SampleStream
  value?: number
}): JsonObject | undefined {
  const hasImportConfig =
    input.batchDelimiter !== undefined ||
    input.batchMetadataColumns !== undefined ||
    input.batchPresetId !== undefined ||
    input.batchTimestampColumn !== undefined ||
    input.batchValueColumn !== undefined
  const hasBatchProvenance =
    input.batchSourceFileName !== undefined || hasImportConfig

  if (!hasBatchProvenance) {
    return undefined
  }

  if (input.sourcePath === undefined) {
    throw new VaultCliError(
      'invalid_option',
      'Typed sample batch provenance options require --source-path so the batch manifest is persisted.',
    )
  }

  const batchProvenance: JsonObject = {}

  if (input.batchSourceFileName !== undefined) {
    batchProvenance.sourceFileName = normalizeBatchSourceFileName(
      input.batchSourceFileName,
    )
  }

  if (!hasImportConfig) {
    return batchProvenance
  }

  if (input.stream === 'sleep_stage') {
    throw new VaultCliError(
      'invalid_option',
      'Batch import-config provenance options are only valid for numeric sample streams.',
    )
  }

  const batchDelimiter = input.batchDelimiter
  const batchTimestampColumn = input.batchTimestampColumn
  const batchValueColumn = input.batchValueColumn

  if (
    batchDelimiter === undefined ||
    batchTimestampColumn === undefined ||
    batchValueColumn === undefined
  ) {
    const missingImportConfigFields = [
      ['--batch-delimiter', batchDelimiter],
      ['--batch-timestamp-column', batchTimestampColumn],
      ['--batch-value-column', batchValueColumn],
    ]
      .filter(([, value]) => value === undefined)
      .map(([field]) => field)

    throw new VaultCliError(
      'invalid_option',
      `Batch import-config provenance requires ${missingImportConfigFields.join(', ')}.`,
    )
  }

  const numericValue = requireNumericSampleValue(input.stream, input.value)
  const importConfig: JsonObject = {
    delimiter: batchDelimiter,
    tsColumn: batchTimestampColumn,
    valueColumn: batchValueColumn,
  }
  const row: JsonObject = {
    rowNumber: 1,
    recordedAt: input.recordedAt,
    value: numericValue,
    rawRecordedAt: input.recordedAt,
    rawValue: String(numericValue),
  }

  if (input.batchPresetId !== undefined) {
    importConfig.presetId = input.batchPresetId
  }
  if (input.batchMetadataColumns !== undefined) {
    importConfig.metadataColumns = input.batchMetadataColumns
  }

  batchProvenance.importConfig = importConfig
  batchProvenance.rows = [row]

  return batchProvenance
}

function applyTypedSampleProvenance(
  payload: JsonObject,
  input: {
    batchDelimiter?: string
    batchMetadataColumns?: string[]
    batchPresetId?: string
    batchSourceFileName?: string
    batchTimestampColumn?: string
    batchValueColumn?: string
    recordedAt: string
    sourcePath?: string
    stream: SampleStream
    value?: number
  },
): JsonObject {
  if (input.sourcePath !== undefined) {
    payload.sourcePath = input.sourcePath
  }

  const batchProvenance = buildTypedSampleBatchProvenance(input)
  if (batchProvenance !== undefined) {
    payload.batchProvenance = batchProvenance
  }

  return payload
}

function buildTypedSamplePayload(input: {
  batchDelimiter?: string
  batchMetadataColumns?: string[]
  batchPresetId?: string
  batchSourceFileName?: string
  batchTimestampColumn?: string
  batchValueColumn?: string
  durationMinutes?: number
  endAt?: string
  quality: string
  recordedAt: string
  source: string
  sourcePath?: string
  stage?: string
  startAt?: string
  stream: SampleStream
  unit: string
  value?: number
}): JsonObject {
  if (input.stream === 'sleep_stage') {
    const sleepStage = requireSleepStageFields(input)

    return applyTypedSampleProvenance({
      stream: input.stream,
      unit: input.unit,
      source: input.source,
      quality: input.quality,
      samples: [
        {
          recordedAt: input.recordedAt,
          stage: sleepStage.stage,
          startAt: sleepStage.startAt,
          endAt: sleepStage.endAt,
          durationMinutes: sleepStage.durationMinutes,
        },
      ],
    }, input)
  }

  validateNoSleepStageFieldsForNumericSample(input)
  const numericValue = requireNumericSampleValue(input.stream, input.value)

  return applyTypedSampleProvenance({
    stream: input.stream,
    unit: input.unit,
    source: input.source,
    quality: input.quality,
    samples: [
      {
        recordedAt: input.recordedAt,
        value: numericValue,
      },
    ],
  }, {
    ...input,
    value: numericValue,
  })
}

export function registerSamplesCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const samples = Cli.create('samples', {
    description: 'Sample ingestion and inspection commands routed through importers and the query read model.',
  })

  samples.command(
    'add',
    {
      description: 'Append one manually curated sample record from typed command options.',
      examples: [
        {
          description: 'Add one numeric sample with source-file and import-config provenance.',
          options: {
            batchDelimiter: ',',
            batchMetadataColumns: ['device_id'],
            batchPresetId: 'manual-glucose-csv',
            batchSourceFileName: 'glucose.csv',
            batchTimestampColumn: 'timestamp',
            batchValueColumn: 'glucose_mg_dl',
            recordedAt: '2026-03-12T07:30:00Z',
            source: 'import',
            sourcePath: './imports/glucose.csv',
            stream: 'glucose',
            unit: 'mg/dL',
            value: 92,
            vault: './vault',
          },
        },
        {
          description: 'Add one sleep-stage segment with the stage-specific field group.',
          options: {
            durationMinutes: 45,
            endAt: '2026-03-12T07:15:00Z',
            recordedAt: '2026-03-12T06:30:00Z',
            stage: 'deep',
            startAt: '2026-03-12T06:30:00Z',
            stream: 'sleep_stage',
            unit: 'stage',
            vault: './vault',
          },
        },
      ],
      args: emptyArgsSchema,
      options: withBaseOptions({
        stream: z
          .enum(SAMPLE_STREAMS)
          .describe('Sample stream to record, such as heart_rate, glucose, steps, or sleep_stage.'),
        unit: z
          .string()
          .min(1)
          .describe('Sample unit. Numeric streams require their canonical unit; sleep_stage uses stage.'),
        recordedAt: z
          .string()
          .pipe(isoTimestampSchema)
          .describe('Sample timestamp in ISO 8601 form.'),
        value: z
          .number()
          .optional()
          .describe('Numeric value for non-sleep_stage streams.'),
        source: z
          .enum(SAMPLE_SOURCES)
          .optional()
          .describe('Sample source. Defaults to manual for direct entry.'),
        quality: z
          .enum(SAMPLE_QUALITIES)
          .optional()
          .describe('Sample quality marker. Defaults to raw.'),
        sourcePath: pathSchema
          .optional()
          .describe('Optional original source artifact file path to store with a sample batch manifest.'),
        batchSourceFileName: batchSourceFileNameSchema
          .optional()
          .describe('Optional original source file name to store in the sample batch manifest; requires --source-path.'),
        batchPresetId: z
          .string()
          .min(1)
          .optional()
          .describe('Optional import preset id to store in batch provenance; requires the batch import-config flags.'),
        batchDelimiter: z
          .string()
          .length(1)
          .optional()
          .describe('Single-character delimiter to store in batch import-config provenance.'),
        batchTimestampColumn: z
          .string()
          .min(1)
          .optional()
          .describe('Original timestamp column name to store in batch import-config provenance.'),
        batchValueColumn: z
          .string()
          .min(1)
          .optional()
          .describe('Original numeric value column name to store in batch import-config provenance.'),
        batchMetadataColumns: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Optional metadata column names to store in batch import-config provenance. Repeat --batch-metadata-columns for multiple values.',
          ),
        stage: z
          .enum(SLEEP_STAGES)
          .optional()
          .describe('Sleep stage for --stream sleep_stage.'),
        startAt: z
          .string()
          .pipe(isoTimestampSchema)
          .optional()
          .describe('Sleep-stage segment start timestamp in ISO 8601 form.'),
        endAt: z
          .string()
          .pipe(isoTimestampSchema)
          .optional()
          .describe('Sleep-stage segment end timestamp in ISO 8601 form.'),
        durationMinutes: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('Sleep-stage segment duration in minutes.'),
      }),
      output: samplesAddResultSchema,
      async run({ options }) {
        return addSampleRecords({
          vault: options.vault,
          payload: buildTypedSamplePayload({
            batchDelimiter: options.batchDelimiter,
            batchMetadataColumns: normalizeRepeatableFlagOption(
              options.batchMetadataColumns,
              'batch-metadata-columns',
            ),
            batchPresetId: options.batchPresetId,
            batchSourceFileName: options.batchSourceFileName,
            batchTimestampColumn: options.batchTimestampColumn,
            batchValueColumn: options.batchValueColumn,
            durationMinutes: options.durationMinutes,
            endAt: options.endAt,
            quality: options.quality ?? 'raw',
            recordedAt: options.recordedAt,
            source: options.source ?? 'manual',
            sourcePath: options.sourcePath,
            stage: options.stage,
            startAt: options.startAt,
            stream: options.stream,
            unit: options.unit,
            value: options.value,
          }),
        })
      },
    },
  )

  samples.command(
    'import-json',
    {
      description: 'Import one or more sample records from an explicit JSON payload file or stdin.',
      examples: [
        {
          description: 'Import a sample batch JSON payload containing samples plus sourcePath/importConfig provenance.',
          options: {
            input: '@samples-batch.json',
            vault: './vault',
          },
        },
      ],
      hint: 'Use samples import-json for structured batches with stream, source, quality, sourcePath, importConfig, samples[], or sleep_stage segments.',
      args: emptyArgsSchema,
      options: withBaseOptions({
        input: inputFileOptionSchema.describe('JSON sample batch payload in @file.json form or - for stdin.'),
      }),
      output: samplesAddResultSchema,
      async run({ options }) {
        return services.core.addSamples({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          inputFile: normalizeInputFileOption(options.input),
        })
      },
    },
  )

  samples.command(
    'import-csv',
    {
      description: 'Import timestamped numeric samples from a CSV file, auto-detecting every recognizable metric column when possible.',
      args: z.object({
        file: pathSchema.describe('Source CSV file to import.'),
      }),
      options: withBaseOptions({
        preset: z
          .string()
          .min(1)
          .optional()
          .describe('Optional preset id that supplies stream, delimiter, and column defaults.'),
        stream: z
          .string()
          .min(1)
          .optional()
          .describe('Optional stream identifier. Recognized aliases such as SpO2 are accepted, and the importer can infer the stream from recognizable CSV headers when unambiguous.'),
        tsColumn: z
          .string()
          .min(1)
          .optional()
          .describe('Optional timestamp column override. When omitted, the importer will use recognizable timestamp headers such as time or timestamp.'),
        valueColumn: z
          .string()
          .min(1)
          .optional()
          .describe('Optional numeric value column override. When omitted, the importer will infer a recognizable metric column, or import all recognizable metrics when the CSV is unambiguous.'),
        unit: z
          .string()
          .min(1)
          .optional()
          .describe('Optional unit override. When omitted, the importer will use the preset unit or a stream-specific default.'),
        delimiter: z
          .string()
          .length(1)
          .optional()
          .describe('Optional single-character CSV delimiter override.'),
        metadataColumns: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Optional metadata columns to copy into batch provenance rows. Repeat --metadata-columns for multiple values.',
          ),
        source: z
          .string()
          .min(1)
          .optional()
          .describe('Optional sample source override such as import, device, or manual.'),
      }),
      output: samplesImportCsvResultSchema,
      async run({ args, options }) {
        const csvOptions = buildCsvImportOptions(options)
        return importCsvSamplesWithArtifacts({
          ...csvOptions,
          file: args.file,
          vault: options.vault,
        })
      },
    },
  )

  const csv = Cli.create('csv', {
    description: 'CSV sample planning and import commands.',
  })

  csv.command(
    'profile',
    {
      description: 'Profile a timestamped sample CSV without writing to the vault.',
      args: z.object({
        file: pathSchema.describe('Source CSV file to profile.'),
      }),
      options: withBaseOptions({
        preset: z
          .string()
          .min(1)
          .optional()
          .describe('Optional preset id that supplies stream, delimiter, and column defaults.'),
        stream: z
          .string()
          .min(1)
          .optional()
          .describe('Optional stream identifier. Recognized aliases such as SpO2 are accepted.'),
        tsColumn: z
          .string()
          .min(1)
          .optional()
          .describe('Optional timestamp column override.'),
        valueColumn: z
          .string()
          .min(1)
          .optional()
          .describe('Optional numeric value column override.'),
        unit: z
          .string()
          .min(1)
          .optional()
          .describe('Optional unit override.'),
        delimiter: z
          .string()
          .length(1)
          .optional()
          .describe('Optional single-character CSV delimiter override.'),
        metadataColumns: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Optional metadata columns to copy into batch provenance rows. Repeat --metadata-columns for multiple values.',
          ),
        source: z
          .string()
          .min(1)
          .optional()
          .describe('Optional sample source hint such as import, device, or manual.'),
        includeSummary: z
          .boolean()
          .optional()
          .describe('Include pre-write summaries for the planned numeric streams.'),
        summaryProfile: sampleSummaryProfileSchema.optional(),
        thresholdBelow: z
          .array(z.coerce.number())
          .optional()
          .describe('Threshold burden to compute as value-below-N. Repeat --threshold-below for multiple thresholds.'),
        gapSeconds: z
          .number()
          .positive()
          .optional()
          .describe('Minimum inter-sample gap, in seconds, used for gap and run detection.'),
      }),
      output: samplesCsvProfileResultSchema,
      async run({ args, options }) {
        const csvOptions = buildCsvImportOptions(options)
        return samplesCsvProfileResultSchema.parse(await profileCsvSampleFileWithArtifacts({
          ...csvOptions,
          file: args.file,
          gapSeconds: options.gapSeconds,
          includeSummary: options.includeSummary,
          summaryProfile: options.summaryProfile,
          thresholdBelow: normalizeThresholdBelowOption(options.thresholdBelow),
          vault: options.vault,
        }))
      },
    },
  )

  csv.command(
    'import',
    {
      description: 'Import timestamped numeric samples from a CSV file.',
      args: z.object({
        file: pathSchema.describe('Source CSV file to import.'),
      }),
      options: withBaseOptions({
        preset: z
          .string()
          .min(1)
          .optional()
          .describe('Optional preset id that supplies stream, delimiter, and column defaults.'),
        stream: z
          .string()
          .min(1)
          .optional()
          .describe('Optional stream identifier. Recognized aliases such as SpO2 are accepted.'),
        tsColumn: z
          .string()
          .min(1)
          .optional()
          .describe('Optional timestamp column override.'),
        valueColumn: z
          .string()
          .min(1)
          .optional()
          .describe('Optional numeric value column override.'),
        unit: z
          .string()
          .min(1)
          .optional()
          .describe('Optional unit override.'),
        delimiter: z
          .string()
          .length(1)
          .optional()
          .describe('Optional single-character CSV delimiter override.'),
        metadataColumns: z
          .array(z.string().min(1))
          .optional()
          .describe(
            'Optional metadata columns to copy into batch provenance rows. Repeat --metadata-columns for multiple values.',
          ),
        source: z
          .string()
          .min(1)
          .optional()
          .describe('Optional sample source override such as import, device, or manual.'),
      }),
      output: samplesImportCsvResultSchema,
      async run({ args, options }) {
        const csvOptions = buildCsvImportOptions(options)
        return importCsvSamplesWithArtifacts({
          ...csvOptions,
          file: args.file,
          vault: options.vault,
        })
      },
    },
  )

  samples.command(csv)

  samples.command('summarize', {
    description: 'Summarize stored samples for one stream across a time window.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      stream: z.string().min(1).describe('Sample stream to summarize, such as spo2 or heart_rate.'),
      from: z
        .string()
        .pipe(isoTimestampSchema)
        .optional()
        .describe('Inclusive lower timestamp bound.'),
      to: z
        .string()
        .pipe(isoTimestampSchema)
        .optional()
        .describe('Inclusive upper timestamp bound.'),
      profile: sampleSummaryProfileSchema.optional(),
      thresholdBelow: z
        .array(z.coerce.number())
        .optional()
        .describe('Threshold burden to compute as value-below-N. Repeat --threshold-below for multiple thresholds.'),
      gapSeconds: z
        .number()
        .positive()
        .optional()
        .describe('Minimum inter-sample gap, in seconds, used for gap and run detection.'),
    }),
    output: samplesSummarizeResultSchema,
    async run({ options }) {
      const summary = await summarizeSampleWindowWithArtifacts(options.vault, {
        stream: options.stream,
        from: options.from,
        to: options.to,
        profile: options.profile,
        thresholdBelow: normalizeThresholdBelowOption(options.thresholdBelow),
        gapSeconds: options.gapSeconds,
      })

      return {
        vault: options.vault,
        summary,
      }
    },
  })

  samples.command('show', {
    description: 'Show one sample record by canonical sample id.',
    args: z.object({
      id: sampleIdSchema.describe('Sample id such as smp_<ULID>.'),
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return {
        vault: options.vault,
        entity: await showSampleWithArtifacts(options.vault, args.id),
      }
    },
  })

  samples.command('list', {
    description: 'List sample records with optional stream, date-range, and quality filters.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      stream: z.string().min(1).optional(),
      from: localDateSchema.optional(),
      to: localDateSchema.optional(),
      quality: z.string().min(1).optional(),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: samplesListResultSchema,
    async run({ options }) {
      const items = await listSamplesWithArtifacts(options.vault, {
        from: options.from,
        limit: options.limit,
        quality: options.quality,
        stream: options.stream,
        to: options.to,
      })

      return {
        vault: options.vault,
        filters: {
          stream: options.stream ?? null,
          from: options.from ?? null,
          to: options.to ?? null,
          quality: options.quality ?? null,
          limit: options.limit,
        },
        items,
        count: items.length,
        nextCursor: null,
      }
    },
  })

  const batch = Cli.create('batch', {
    description: 'Sample import-batch inspection commands for xfm_* ids.',
  })

  batch.command('show', {
    description: 'Show one imported sample batch by transform id.',
    args: z.object({
      id: batchIdSchema.describe('Transform batch id such as xfm_<ULID>.'),
    }),
    options: withBaseOptions(),
    output: sampleBatchShowResultSchema,
    async run({ args, options }) {
      const batchDetails = await showSampleBatchWithArtifacts(options.vault, args.id)

      return {
        vault: options.vault,
        ...batchDetails,
      }
    },
  })

  batch.command('list', {
    description: 'List imported sample batches from raw sample manifests.',
    args: emptyArgsSchema,
    options: withBaseOptions({
      stream: z.string().min(1).optional(),
      from: localDateSchema.optional(),
      to: localDateSchema.optional(),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: sampleBatchListResultSchema,
    async run({ options }) {
      const items = await listSampleBatchesWithArtifacts(options.vault, {
        from: options.from,
        limit: options.limit,
        stream: options.stream,
        to: options.to,
      })

      return {
        vault: options.vault,
        filters: {
          stream: options.stream ?? null,
          from: options.from ?? null,
          to: options.to ?? null,
          limit: options.limit,
        },
        items: items.map((item) => ({
          batchId: item.batchId,
          stream: item.stream,
          manifestFile: item.manifestFile,
          importedAt: item.importedAt,
          source: item.source,
          importedCount: item.importedCount,
        })),
      }
    },
  })

  samples.command(batch)

  cli.command(samples)
}
