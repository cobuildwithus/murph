import { Cli, z } from 'incur'
import {
  eventSourceSchema,
  type MeasurementEntry,
} from '@murphai/contracts'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  measurementAddResultSchema,
  listResultSchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
  normalizeRepeatableFlagOption,
  normalizeRepeatableTextFlagOption,
} from '@murphai/vault-usecases'
import {
  addMeasurementRecord,
  addMeasurementDraftRecord,
  buildMeasurementEventDraft,
  listMeasurementRecords,
  listMeasurementEntries,
  measurementEntryListResultSchema,
  measurementImportManifestResultSchema,
  measurementLookupSchema,
  normalizeMeasurementEntry,
  showMeasurementManifest,
  showMeasurementRecord,
} from '@murphai/vault-usecases/measurements'
import {
  occurredAtOptionSchema,
  slugSchema,
  timeZoneSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  commonDateRangeOptionDescriptions,
  commonListLimitOptionSchema,
  createCommonListCommand,
  registerFactoryCommand,
} from './command-factory-primitives.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'

function parseQualifierValue(rawValue: string): string | number | boolean {
  const trimmed = rawValue.trim()
  if (trimmed === 'true') {
    return true
  }
  if (trimmed === 'false') {
    return false
  }

  const numeric = Number(trimmed)
  if (trimmed.length > 0 && Number.isFinite(numeric)) {
    return numeric
  }

  return trimmed
}

function normalizeRepeatedMeasurementText(
  value: readonly string[] | undefined,
  optionName: string,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  const entries = value.map((entry) => entry.trim()).filter((entry) => entry.length > 0)
  if (entries.some((entry) => entry.includes(','))) {
    throw new VaultCliError(
      'invalid_option',
      `Comma-delimited values are not supported for --${optionName}. Repeat the flag instead.`,
    )
  }

  return entries.length > 0 ? entries : undefined
}

function parseMeasurementNoteEntries(
  value: readonly string[] | undefined,
  measurementCount: number,
): Array<string | undefined> {
  const entries = normalizeRepeatableTextFlagOption(value)
  const notes = Array<string | undefined>(measurementCount)
  if (!entries) {
    return notes
  }

  for (const entry of entries) {
    const targetSeparatorIndex = entry.indexOf(':')
    const hasExplicitTarget = targetSeparatorIndex > 0 && /^\d+$/u.test(entry.slice(0, targetSeparatorIndex))
    if (measurementCount > 1 && !hasExplicitTarget) {
      throw new VaultCliError(
        'invalid_option',
        'Grouped --measurement-note entries must use N:note, for example 1:after coffee.',
      )
    }

    const targetIndex = hasExplicitTarget
      ? Number(entry.slice(0, targetSeparatorIndex)) - 1
      : 0
    const note = hasExplicitTarget ? entry.slice(targetSeparatorIndex + 1).trim() : entry.trim()
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= measurementCount) {
      throw new VaultCliError(
        'invalid_option',
        `--measurement-note index must be between 1 and ${measurementCount}.`,
      )
    }
    if (!note) {
      throw new VaultCliError(
        'invalid_option',
        'Indexed --measurement-note entries must include note text after N:, for example 1:after coffee.',
      )
    }

    notes[targetIndex] = note
  }

  return notes
}

function parseMeasurementQualifierEntries(
  value: readonly string[] | undefined,
  measurementCount: number,
): Array<Record<string, string | number | boolean> | undefined> {
  const entries = normalizeRepeatedMeasurementText(value, 'qualifier')
  const qualifiers = Array<Record<string, string | number | boolean> | undefined>(measurementCount)
  if (!entries) {
    return qualifiers
  }

  for (const entry of entries) {
    const targetSeparatorIndex = entry.indexOf(':')
    const hasExplicitTarget = targetSeparatorIndex > 0 && /^\d+$/u.test(entry.slice(0, targetSeparatorIndex))
    const targetIndex = hasExplicitTarget
      ? Number(entry.slice(0, targetSeparatorIndex)) - 1
      : 0
    const qualifierEntry = hasExplicitTarget
      ? entry.slice(targetSeparatorIndex + 1)
      : entry
    const separatorIndex = qualifierEntry.indexOf('=')
    if (measurementCount > 1 && !hasExplicitTarget) {
      throw new VaultCliError(
        'invalid_option',
        'Grouped --qualifier entries must use N:key=value, for example 1:side=right.',
      )
    }
    if (targetIndex < 0 || !Number.isInteger(targetIndex) || targetIndex >= measurementCount) {
      throw new VaultCliError(
        'invalid_option',
        `--qualifier index must be between 1 and ${measurementCount}.`,
      )
    }
    if (separatorIndex <= 0 || separatorIndex === qualifierEntry.length - 1) {
      throw new VaultCliError(
        'invalid_option',
        hasExplicitTarget
          ? 'Indexed --qualifier entries must use N:key=value, for example 1:side=right.'
          : '--qualifier entries must use key=value, for example side=right.',
      )
    }

    const key = qualifierEntry.slice(0, separatorIndex).trim()
    const rawValue = qualifierEntry.slice(separatorIndex + 1).trim()
    if (!key || !rawValue) {
      throw new VaultCliError(
        'invalid_option',
        hasExplicitTarget
          ? 'Indexed --qualifier entries must use N:key=value, for example 1:side=right.'
          : '--qualifier entries must use key=value, for example side=right.',
      )
    }

    qualifiers[targetIndex] ??= {}
    qualifiers[targetIndex][key] = parseQualifierValue(rawValue)
  }

  return qualifiers
}

function buildTypedMeasurements(input: {
  metric: readonly string[] | undefined
  value: readonly number[] | undefined
  unit: readonly string[] | undefined
  qualifier: readonly string[] | undefined
  measurementNote: readonly string[] | undefined
  note: string | undefined
}): MeasurementEntry[] {
  const metrics = normalizeRepeatedMeasurementText(input.metric, 'metric')
  const units = normalizeRepeatedMeasurementText(input.unit, 'unit')
  const values = input.value

  if (!metrics || !values || !units) {
    throw new VaultCliError(
      'invalid_option',
      'measurement add requires repeated --metric, --value, and --unit fields.',
    )
  }

  const measurementCount = metrics.length
  if (values.length !== measurementCount || units.length !== measurementCount) {
    throw new VaultCliError(
      'invalid_option',
      'Repeated --metric, --value, and --unit fields must have the same count.',
    )
  }

  const qualifierEntries = parseMeasurementQualifierEntries(input.qualifier, measurementCount)
  const noteEntries = parseMeasurementNoteEntries(input.measurementNote, measurementCount)
  if (measurementCount === 1 && noteEntries[0] === undefined && input.note) {
    noteEntries[0] = input.note
  }

  return metrics.map((metric, index) => normalizeMeasurementEntry({
    metric,
    value: values[index],
    unit: units[index],
    qualifiers: qualifierEntries[index],
    note: noteEntries[index],
  }, `measurements[${index}]`))
}

export const measurementCommandDescriptions = {
  root: 'Primary scalar-measurement commands. Use this group for any numeric body, vitals, performance, or custom metric.',
  add: 'Primary write path for scalar measurements. Record one or more measurements from open metric slugs plus optional qualifiers.',
  importJson:
    'Import one measurement event from a structured JSON payload file or stdin.',
  addHint:
    'Prefer this command for all new metrics. Repeat --metric/--value/--unit for grouped measurements. Use measurement import-json --input @file.json only when you need nested links, external references, rawRefs, or stored-media import metadata.',
  show: 'Show one measurement event by canonical event id.',
  list: 'List measurement events with optional date bounds.',
  entryList: 'List lossless scalar measurement and observation entries for one or more canonical metric identities.',
  manifest: 'Show the immutable raw import manifest for one imported measurement event.',
} as const

export function registerMeasurementCommands(cli: Cli.Cli) {
  const measurement = Cli.create('measurement', {
    description: measurementCommandDescriptions.root,
  })
  const entry = Cli.create('entry', {
    description: 'Read scalar measurement and observation entries without compacting their metric, value, unit, or parent-event identity.',
  })

  const measurementTypedOptionShape = {
    metric: z
      .array(z.string().min(1).max(120))
      .optional()
      .describe('Measurement metric name or slug. Repeat --metric with --value and --unit for grouped measurements; keep the order aligned. Shell-quote friendly names with spaces. Do not comma-delimit multiple metrics.'),
    value: z
      .array(z.coerce.number())
      .optional()
      .describe('Measurement numeric value. Repeat --value with --metric and --unit for grouped measurements; keep the order aligned.'),
    unit: z
      .array(z.string().min(1).max(64))
      .optional()
      .describe('Measurement unit such as lb, kg, percent, ms, bpm, or mmol/L. Repeat --unit with --metric and --value for grouped measurements; keep the order aligned. Do not comma-delimit multiple units.'),
    qualifier: z
      .array(z.string().min(1))
      .optional()
      .describe('Optional measurement qualifier as key=value for one measurement or N:key=value for grouped measurements. Example values: side=right, 1:side=right, 2:posture=seated. Repeat --qualifier for multiple entries.'),
    measurementNote: z
      .array(z.string().min(1).max(4000))
      .optional()
      .describe('Optional per-measurement note. Use note for one measurement or N:note for grouped measurements. Example values: 1:after coffee, 2:five quiet minutes.'),
    note: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe('Optional measurement note.'),
    title: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe('Optional measurement title override.'),
    occurredAt: occurredAtOptionSchema
      .optional()
      .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
    source: eventSourceSchema
      .optional()
      .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
    media: z
      .array(pathSchema)
      .optional()
      .describe('Optional measurement photo or video file paths to copy into raw/measurements/** and attach to the measurement event.'),
    tag: z
      .array(slugSchema)
      .optional()
      .describe('Optional event tag slug. Repeat --tag for multiple tags.'),
    timeZone: timeZoneSchema
      .optional()
      .describe('Optional IANA timezone for the measurement event.'),
  }
  const measurementImportJsonOptionShape = {
    input: inputFileOptionSchema.describe('Structured measurement payload in @file.json form or - for stdin.'),
    note: measurementTypedOptionShape.note,
    title: measurementTypedOptionShape.title,
    occurredAt: measurementTypedOptionShape.occurredAt,
    source: measurementTypedOptionShape.source,
    media: measurementTypedOptionShape.media,
  }

  measurement.command('add', {
    description: measurementCommandDescriptions.add,
    args: z.object({}),
    examples: [
      {
        description: 'Record right-hand grip strength directly.',
        args: {},
        options: {
          vault: './vault',
          metric: ["'grip strength'"],
          value: [97.2],
          unit: ['lb'],
          qualifier: ['side=right'],
        },
      },
      {
        description: 'Record one heart-rate measurement with a qualifier and note.',
        args: {},
        options: {
          vault: './vault',
          metric: ["'resting heart rate'"],
          value: [54],
          unit: ['bpm'],
          qualifier: ['posture=seated'],
          measurementNote: ["'five quiet minutes'"],
        },
      },
    ],
    hint: measurementCommandDescriptions.addHint,
    options: withBaseOptions(measurementTypedOptionShape),
    output: measurementAddResultSchema,
    async run({ options }) {
      const occurredAt = await normalizeOccurredAtOption({
        vault: options.vault,
        occurredAt:
          typeof options.occurredAt === 'string'
            ? options.occurredAt
            : undefined,
      })
      const mediaPaths = Array.isArray(options.media)
        ? options.media.filter((entry): entry is string => typeof entry === 'string')
        : undefined
      const measurements = buildTypedMeasurements({
        metric: options.metric,
        value: options.value,
        unit: options.unit,
        qualifier: options.qualifier,
        measurementNote: options.measurementNote,
        note: typeof options.note === 'string' ? options.note : undefined,
      })
      const draft = buildMeasurementEventDraft({
        occurredAt,
        title: typeof options.title === 'string' ? options.title : undefined,
        note: typeof options.note === 'string' ? options.note : undefined,
        measurements,
        source: typeof options.source === 'string' ? options.source : undefined,
        payload: {
          tags: normalizeRepeatableFlagOption(options.tag, 'tag'),
          timeZone:
            typeof options.timeZone === 'string'
              ? options.timeZone
              : undefined,
        },
      })

      return addMeasurementDraftRecord({
        vault: options.vault,
        draft,
        mediaPaths,
      })
    },
  })

  measurement.command('import-json', {
    description: measurementCommandDescriptions.importJson,
    args: z.object({}),
    examples: [
      {
        description: 'Import a richer grouped measurement payload from disk.',
        args: {},
        options: {
          vault: './vault',
          input: '@measurement.json',
        },
      },
    ],
    hint:
      '--input accepts @file.json or - for stdin. Use this escape hatch for nested links, external references, rawRefs, stored-media import metadata, and other structured measurement fields outside the typed add surface.',
    options: withBaseOptions(measurementImportJsonOptionShape),
    output: measurementAddResultSchema,
    async run({ options }) {
      const occurredAt = await normalizeOccurredAtOption({
        vault: options.vault,
        occurredAt:
          typeof options.occurredAt === 'string'
            ? options.occurredAt
            : undefined,
      })
      const mediaPaths = Array.isArray(options.media)
        ? options.media.filter((entry): entry is string => typeof entry === 'string')
        : undefined

      return addMeasurementRecord({
        vault: options.vault,
        inputFile: normalizeInputFileOption(options.input),
        metric: undefined,
        value: undefined,
        unit: undefined,
        qualifiers: undefined,
        note: typeof options.note === 'string' ? options.note : undefined,
        title: typeof options.title === 'string' ? options.title : undefined,
        occurredAt,
        source: typeof options.source === 'string' ? options.source : undefined,
        mediaPaths,
      })
    },
  })

  measurement.command('show', {
    description: measurementCommandDescriptions.show,
    args: z.object({
      id: measurementLookupSchema,
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return showMeasurementRecord(options.vault, args.id)
    },
  })

  registerFactoryCommand(
    measurement,
    createCommonListCommand({
      description: measurementCommandDescriptions.list,
      options: {
        from: {
          description: commonDateRangeOptionDescriptions.from,
          name: 'from',
        },
        to: {
          description: commonDateRangeOptionDescriptions.to,
          name: 'to',
        },
        limit: commonListLimitOptionSchema,
      },
      output: listResultSchema,
      run(input) {
        return listMeasurementRecords({
          vault: input.vault,
          from: input.from,
          to: input.to,
          limit: input.limit,
        })
      },
    }),
  )

  entry.command('list', {
    description: measurementCommandDescriptions.entryList,
    args: z.object({}),
    examples: [
      {
        description: 'Read recent BMI, height, and weight evidence without compacting grouped measurements.',
        args: {},
        options: {
          vault: './vault',
          metric: ['bmi', 'height', 'weight', 'body-weight'],
          from: '2026-07-01',
          to: '2026-08-15',
          limit: 200,
        },
      },
    ],
    hint: 'Repeat --metric for OR matching. Registered aliases resolve through the canonical health-metric identity owner; unknown custom metrics retain normalized exact matching, never fuzzy matching. Results preserve stored metric spellings, original values and units, canonical record kind, and parent event ID, with a zero-based measurement index for array-backed records or null for scalar observations.',
    options: withBaseOptions({
      metric: z
        .array(z.string().min(1).max(120))
        .min(1)
        .describe('Measurement metric name or slug. Repeat --metric for OR matching. Registered aliases match their canonical metric identity; unknown custom metrics use normalized exact matching, never fuzzy matching.'),
      from: localDateSchema
        .optional()
        .describe(commonDateRangeOptionDescriptions.from),
      to: localDateSchema
        .optional()
        .describe(commonDateRangeOptionDescriptions.to),
      limit: commonListLimitOptionSchema,
    }),
    output: measurementEntryListResultSchema,
    async run({ options }) {
      return listMeasurementEntries({
        vault: options.vault,
        metrics: options.metric,
        from: options.from,
        to: options.to,
        limit: options.limit,
      })
    },
  })

  measurement.command(entry)

  measurement.command('manifest', {
    description: measurementCommandDescriptions.manifest,
    args: z.object({
      id: measurementLookupSchema,
    }),
    options: withBaseOptions(),
    output: measurementImportManifestResultSchema,
    async run({ args, options }) {
      return showMeasurementManifest(options.vault, args.id)
    },
  })

  cli.command(measurement)
}
