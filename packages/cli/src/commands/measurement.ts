import { Cli, z } from 'incur'
import {
  eventSourceSchema,
  type MeasurementEntry,
} from '@murphai/contracts'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  measurementAddResultSchema,
  listResultSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
  normalizeRepeatableFlagOption,
} from '@murphai/vault-usecases'
import {
  addMeasurementRecord,
  addMeasurementDraftRecord,
  buildMeasurementEventDraft,
  listMeasurementRecords,
  measurementImportManifestResultSchema,
  measurementLookupSchema,
  normalizeMeasurementEntry,
  showMeasurementManifest,
  showMeasurementRecord,
} from '@murphai/vault-usecases/measurements'
import type { VaultServices } from '@murphai/vault-usecases'
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
  const entries = normalizeRepeatedMeasurementText(value, 'measurement-note')
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
        'Each --measurement-note entry must use N:note form when multiple measurements are provided.',
      )
    }

    const targetIndex = hasExplicitTarget
      ? Number(entry.slice(0, targetSeparatorIndex)) - 1
      : 0
    const note = hasExplicitTarget ? entry.slice(targetSeparatorIndex + 1).trim() : entry.trim()
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= measurementCount || !note) {
      throw new VaultCliError(
        'invalid_option',
        'Each --measurement-note entry must use N:note form with a valid one-based measurement index.',
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
    if (
      targetIndex < 0 ||
      !Number.isInteger(targetIndex) ||
      targetIndex >= measurementCount ||
      (measurementCount > 1 && !hasExplicitTarget) ||
      separatorIndex <= 0 ||
      separatorIndex === qualifierEntry.length - 1
    ) {
      throw new VaultCliError(
        'invalid_option',
        'Each --qualifier entry must use key=value form for one measurement or N:key=value form for multiple measurements.',
      )
    }

    const key = qualifierEntry.slice(0, separatorIndex).trim()
    const rawValue = qualifierEntry.slice(separatorIndex + 1).trim()
    if (!key || !rawValue) {
      throw new VaultCliError(
        'invalid_option',
        'Each --qualifier entry must use key=value form for one measurement or N:key=value form for multiple measurements.',
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
      'measurement add requires repeated --metric, --value, and --unit fields when --input is not provided.',
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

function rejectTypedMeasurementOptionsWithInput(options: {
  metric?: readonly string[]
  value?: readonly number[]
  unit?: readonly string[]
  qualifier?: readonly string[]
  measurementNote?: readonly string[]
  tag?: readonly string[]
  timeZone?: string
}) {
  const unsupportedOptions: string[] = []
  if (Array.isArray(options.metric) && options.metric.length > 0) {
    unsupportedOptions.push('--metric')
  }
  if (Array.isArray(options.value) && options.value.length > 0) {
    unsupportedOptions.push('--value')
  }
  if (Array.isArray(options.unit) && options.unit.length > 0) {
    unsupportedOptions.push('--unit')
  }
  if (Array.isArray(options.qualifier) && options.qualifier.length > 0) {
    unsupportedOptions.push('--qualifier')
  }
  if (Array.isArray(options.measurementNote) && options.measurementNote.length > 0) {
    unsupportedOptions.push('--measurement-note')
  }
  if (Array.isArray(options.tag) && options.tag.length > 0) {
    unsupportedOptions.push('--tag')
  }
  if (typeof options.timeZone === 'string') {
    unsupportedOptions.push('--time-zone')
  }

  if (unsupportedOptions.length === 0) {
    return
  }

  throw new VaultCliError(
    'invalid_option',
    `measurement add cannot combine --input with ${unsupportedOptions.join(', ')}. Put those fields in the structured input payload or omit --input.`,
  )
}

export const measurementCommandDescriptions = {
  root: 'Primary scalar-measurement commands. Use this group for any numeric body, vitals, performance, or custom metric.',
  add: 'Primary write path for scalar measurements. Record one or more measurements from open metric slugs plus optional qualifiers.',
  addHint:
    'Prefer this command for all new metrics. Repeat --metric/--value/--unit for grouped measurements. Use --input @file.json only when you need nested links, external references, rawRefs, or stored-media import metadata.',
  show: 'Show one measurement event by canonical event id.',
  list: 'List measurement events with optional date bounds.',
  manifest: 'Show the immutable raw import manifest for one imported measurement event.',
} as const

export function registerMeasurementCommands(
  cli: Cli.Cli,
  _services: VaultServices,
) {
  const measurement = Cli.create('measurement', {
    description: measurementCommandDescriptions.root,
  })

  measurement.command('add', {
    description: measurementCommandDescriptions.add,
    args: z.object({}),
    examples: [
      {
        description: 'Record right-hand grip strength directly.',
        args: {},
        options: {
          vault: './vault',
          metric: ['grip strength'],
          value: [97.2],
          unit: ['lb'],
          qualifier: ['side=right'],
        },
      },
      {
        description: 'Record a richer grouped measurement payload from disk.',
        args: {},
        options: {
          vault: './vault',
          input: '@measurement.json',
        },
      },
    ],
    hint: measurementCommandDescriptions.addHint,
    options: withBaseOptions({
      input: inputFileOptionSchema
        .optional()
        .describe('Optional structured measurement payload in @file.json form or - for stdin.'),
      metric: z
        .array(z.string().min(1).max(120))
        .optional()
        .describe('Measurement metric name or slug. Repeat --metric with --value and --unit for grouped measurements. Friendly names are normalized to kebab-case.'),
      value: z
        .array(z.coerce.number())
        .optional()
        .describe('Measurement numeric value. Repeat --value with --metric and --unit for grouped measurements.'),
      unit: z
        .array(z.string().min(1).max(64))
        .optional()
        .describe('Measurement unit such as lb, kg, percent, ms, bpm, or mmol/L. Repeat --unit with --metric and --value for grouped measurements.'),
      qualifier: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional measurement qualifier as key=value for one measurement or N:key=value for grouped measurements. Repeat --qualifier for multiple entries.'),
      measurementNote: z
        .array(z.string().min(1).max(4000))
        .optional()
        .describe('Optional per-measurement note. Use note for one measurement or N:note for grouped measurements.'),
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
    }),
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

      if (typeof options.input !== 'string') {
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
      }

      rejectTypedMeasurementOptionsWithInput({
        metric: options.metric,
        value: options.value,
        unit: options.unit,
        qualifier: options.qualifier,
        measurementNote: options.measurementNote,
        tag: options.tag,
        timeZone:
          typeof options.timeZone === 'string'
            ? options.timeZone
            : undefined,
      })

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
