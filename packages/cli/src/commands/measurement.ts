import { Cli, z } from 'incur'
import { eventSourceSchema } from '@murphai/contracts'
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
  listMeasurementRecords,
  measurementImportManifestResultSchema,
  measurementLookupSchema,
  showMeasurementManifest,
  showMeasurementRecord,
} from '@murphai/vault-usecases/measurements'
import type { VaultServices } from '@murphai/vault-usecases'
import { occurredAtOptionSchema } from '@murphai/operator-config/vault-cli-contracts'
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

function parseMeasurementQualifiers(
  value: readonly string[] | undefined,
): Record<string, string | number | boolean> | undefined {
  const entries = normalizeRepeatableFlagOption(value, 'qualifier')
  if (!entries) {
    return undefined
  }

  const qualifiers: Record<string, string | number | boolean> = {}
  for (const entry of entries) {
    const separatorIndex = entry.indexOf('=')
    if (separatorIndex <= 0 || separatorIndex === entry.length - 1) {
      throw new VaultCliError(
        'invalid_option',
        'Each --qualifier entry must use key=value form, for example --qualifier side=left.',
      )
    }

    const key = entry.slice(0, separatorIndex).trim()
    const rawValue = entry.slice(separatorIndex + 1).trim()
    if (!key || !rawValue) {
      throw new VaultCliError(
        'invalid_option',
        'Each --qualifier entry must use key=value form, for example --qualifier side=left.',
      )
    }

    qualifiers[key] = parseQualifierValue(rawValue)
  }

  return Object.keys(qualifiers).length > 0 ? qualifiers : undefined
}

export const measurementCommandDescriptions = {
  root: 'Primary scalar-measurement commands. Use this group for any numeric body, vitals, performance, or custom metric.',
  add: 'Primary write path for scalar measurements. Record one or more measurements from open metric slugs plus optional qualifiers.',
  addHint:
    'Prefer this command for all new metrics. Use --metric/--value/--unit for one measurement, or pass --input @file.json when you need grouped measurements and richer metadata.',
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
          metric: 'grip strength',
          value: 97.2,
          unit: 'lb',
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
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe('Measurement metric name or slug. Friendly names are normalized to kebab-case.'),
      value: z
        .number()
        .optional()
        .describe('Single measurement numeric value when --input is not provided.'),
      unit: z
        .string()
        .min(1)
        .max(64)
        .optional()
        .describe('Measurement unit such as lb, kg, percent, ms, bpm, or mmol/L.'),
      qualifier: z
        .array(z.string().min(1))
        .optional()
        .describe('Optional measurement qualifier in key=value form. Repeat --qualifier for multiple entries.'),
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
    }),
    output: measurementAddResultSchema,
    async run({ options }) {
      return addMeasurementRecord({
        vault: options.vault,
        inputFile:
          typeof options.input === 'string'
            ? normalizeInputFileOption(options.input)
            : undefined,
        metric: typeof options.metric === 'string' ? options.metric : undefined,
        value: typeof options.value === 'number' ? options.value : undefined,
        unit: typeof options.unit === 'string' ? options.unit : undefined,
        qualifiers: parseMeasurementQualifiers(options.qualifier),
        note: typeof options.note === 'string' ? options.note : undefined,
        title: typeof options.title === 'string' ? options.title : undefined,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string'
              ? options.occurredAt
              : undefined,
        }),
        source: typeof options.source === 'string' ? options.source : undefined,
        mediaPaths: Array.isArray(options.media)
          ? options.media.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
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
