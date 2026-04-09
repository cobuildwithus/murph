import { Cli, z } from 'incur'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '@murphai/vault-usecases'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  isoTimestampSchema,
  listResultSchema,
  pathSchema,
  showResultSchema,
  workoutAddResultSchema,
  workoutFormatListResultSchema,
  workoutFormatSaveResultSchema,
  workoutImportCsvResultSchema,
  workoutImportInspectResultSchema,
  workoutMeasurementAddResultSchema,
  workoutUnitPreferencesResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  listWorkoutRecords,
  listWorkoutMeasurementRecords,
  showWorkoutManifest,
  showWorkoutMeasurementManifest,
  showWorkoutMeasurementRecord,
  showWorkoutRecord,
  workoutImportManifestResultSchema,
  workoutLookupSchema,
} from '@murphai/vault-usecases/workouts'
import {
  listWorkoutFormats,
  logWorkoutFormat,
  saveWorkoutFormat,
  showWorkoutFormat,
} from '@murphai/vault-usecases/workouts'
import {
  addWorkoutRecord,
  deleteWorkoutRecord,
  editWorkoutRecord,
} from '@murphai/vault-usecases/workouts'
import {
  importWorkoutCsv,
  inspectWorkoutCsvImport,
} from '@murphai/vault-usecases/workouts'
import {
  addWorkoutMeasurementRecord,
  setWorkoutUnitPreferences,
  showWorkoutUnitPreferences,
} from '@murphai/vault-usecases/workouts'
import {
  createDirectEntityDeleteCommandDefinition,
  createDirectEventBackedEntityEditCommandDefinition,
} from './record-mutation-command-helpers.js'
import {
  commonDateRangeOptionDescriptions,
  commonListLimitOptionSchema,
} from './command-factory-primitives.js'

const eventSourceSchema = z.enum(['manual', 'import', 'device', 'derived'])

export function registerWorkoutCommands(
  cli: Cli.Cli,
  _services: VaultServices,
) {
  const workout = Cli.create('workout', {
    description:
      'Workout façade commands over core activity-session writes, body-measurement writes, workout-format docs, CSV import, and saved unit preferences.',
  })

  workout.command('add', {
    description:
      'Record one workout either from a freeform note or from a structured JSON payload.',
    args: z.object({
      text: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe(
          'Optional freeform workout text such as "Went for a 30-minute run." Omit it when using --input.',
        ),
    }),
    examples: [
      {
        description: 'Capture a run directly from one note.',
        args: {
          text: 'Went for a 30-minute run around the neighborhood.',
        },
        options: {
          vault: './vault',
        },
      },
      {
        description: 'Capture a structured workout payload from disk.',
        args: {},
        options: {
          input: '@workout.json',
          vault: './vault',
        },
      },
    ],
    hint:
      'Use freeform text for lightweight logging, or omit the positional text and pass --input @workout.json to store a rich nested workout payload with exercises, sets, notes, grouping, and source metadata.',
    options: withBaseOptions({
      input: inputFileOptionSchema
        .optional()
        .describe('Optional structured workout payload in @file.json form or - for stdin.'),
      duration: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe(
          'Optional duration override in minutes when the note or structured payload is missing or ambiguous.',
        ),
      type: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe(
          'Optional workout type override such as "run" or "strength training".',
        ),
      distanceKm: z
        .number()
        .positive()
        .max(1_000)
        .optional()
        .describe('Optional workout distance override in kilometers.'),
      occurredAt: isoTimestampSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form.'),
      source: eventSourceSchema
        .optional()
        .describe(
          'Optional event source (`manual`, `import`, `device`, or `derived`).',
        ),
      media: z
        .array(pathSchema)
        .optional()
        .describe('Optional workout photo or video file paths to copy into raw/workouts/** and attach to the workout event.'),
    }),
    output: workoutAddResultSchema,
    async run({ args, options }) {
      return addWorkoutRecord({
        vault: options.vault,
        text: typeof args.text === 'string' ? args.text : undefined,
        inputFile:
          typeof options.input === 'string'
            ? normalizeInputFileOption(options.input)
            : undefined,
        durationMinutes: options.duration,
        activityType:
          typeof options.type === 'string' ? options.type : undefined,
        distanceKm:
          typeof options.distanceKm === 'number'
            ? options.distanceKm
            : undefined,
        occurredAt:
          typeof options.occurredAt === 'string'
            ? options.occurredAt
            : undefined,
        source: typeof options.source === 'string' ? options.source : undefined,
        mediaPaths: Array.isArray(options.media)
          ? options.media.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
      })
    },
  })

  workout.command('show', {
    description: 'Show one workout session by canonical event id.',
    args: z.object({
      id: workoutLookupSchema,
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return showWorkoutRecord(options.vault, args.id)
    },
  })

  workout.command('list', {
    description: 'List workout sessions with optional date bounds.',
    args: z.object({}),
    options: withBaseOptions({
      from: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional()
        .describe(commonDateRangeOptionDescriptions.from),
      to: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/u)
        .optional()
        .describe(commonDateRangeOptionDescriptions.to),
      limit: commonListLimitOptionSchema,
    }),
    output: listResultSchema,
    async run({ options }) {
      return listWorkoutRecords({
        vault: options.vault,
        from: typeof options.from === 'string' ? options.from : undefined,
        to: typeof options.to === 'string' ? options.to : undefined,
        limit: typeof options.limit === 'number' ? options.limit : undefined,
      })
    },
  })

  workout.command('manifest', {
    description: 'Show the immutable raw import manifest for an imported workout event.',
    args: z.object({
      id: workoutLookupSchema,
    }),
    options: withBaseOptions(),
    output: workoutImportManifestResultSchema,
    async run({ args, options }) {
      return showWorkoutManifest(options.vault, args.id)
    },
  })

  workout.command('edit', createDirectEventBackedEntityEditCommandDefinition({
    arg: {
      name: 'id',
      schema: workoutLookupSchema,
    },
    description:
      'Edit one workout session by merging a partial JSON patch or one or more path assignments into the saved activity event.',
    run(input) {
      return editWorkoutRecord({
        vault: input.vault,
        lookup: input.lookup,
        inputFile: input.inputFile,
        set: input.set,
        clear: input.clear,
        dayKeyPolicy: input.dayKeyPolicy,
      })
    },
  }))

  workout.command('delete', createDirectEntityDeleteCommandDefinition({
    arg: {
      name: 'id',
      schema: workoutLookupSchema,
    },
    description: 'Delete one workout activity_session event.',
    run(input) {
      return deleteWorkoutRecord({
        vault: input.vault,
        lookup: input.lookup,
      })
    },
  }))

  const measurement = Cli.create('measurement', {
    description:
      'Body-measurement capture routed through the core body_measurement write seam with optional progress photos under raw/measurements/**.',
  })

  measurement.command('add', {
    description:
      'Record one body-measurement check-in either from a structured JSON payload or a single typed measurement.',
    args: z.object({}),
    options: withBaseOptions({
      input: inputFileOptionSchema
        .optional()
        .describe('Optional structured body-measurement payload in @file.json form or - for stdin.'),
      type: z
        .enum([
          'weight',
          'body_fat_pct',
          'waist',
          'neck',
          'shoulders',
          'chest',
          'biceps',
          'forearms',
          'abdomen',
          'hips',
          'thighs',
          'calves',
        ])
        .optional()
        .describe('Single measurement type to record when --input is not provided.'),
      value: z
        .number()
        .nonnegative()
        .optional()
        .describe('Single measurement numeric value when --input is not provided.'),
      unit: z
        .enum(['lb', 'kg', 'percent', 'cm', 'in'])
        .optional()
        .describe('Optional measurement unit. When omitted, Murph falls back to saved workout unit preferences where possible.'),
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
      occurredAt: isoTimestampSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form.'),
      source: eventSourceSchema
        .optional()
        .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
      media: z
        .array(pathSchema)
        .optional()
        .describe('Optional progress photo or video file paths to copy into raw/measurements/** and attach to the measurement event.'),
    }),
    output: workoutMeasurementAddResultSchema,
    async run({ options }) {
      return addWorkoutMeasurementRecord({
        vault: options.vault,
        inputFile:
          typeof options.input === 'string'
            ? normalizeInputFileOption(options.input)
            : undefined,
        type: typeof options.type === 'string' ? options.type : undefined,
        value: typeof options.value === 'number' ? options.value : undefined,
        unit: typeof options.unit === 'string' ? options.unit : undefined,
        note: typeof options.note === 'string' ? options.note : undefined,
        title: typeof options.title === 'string' ? options.title : undefined,
        occurredAt:
          typeof options.occurredAt === 'string'
            ? options.occurredAt
            : undefined,
        source: typeof options.source === 'string' ? options.source : undefined,
        mediaPaths: Array.isArray(options.media)
          ? options.media.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
      })
    },
  })

  measurement.command('show', {
    description: 'Show one body-measurement event by canonical event id.',
    args: z.object({
      id: workoutLookupSchema,
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return showWorkoutMeasurementRecord(options.vault, args.id)
    },
  })

  measurement.command('list', {
    description: 'List body-measurement events with optional date bounds.',
    args: z.object({}),
    options: withBaseOptions({
      from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
      to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/u).optional(),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: listResultSchema,
    async run({ options }) {
      return listWorkoutMeasurementRecords({
        vault: options.vault,
        from: typeof options.from === 'string' ? options.from : undefined,
        to: typeof options.to === 'string' ? options.to : undefined,
        limit: typeof options.limit === 'number' ? options.limit : undefined,
      })
    },
  })

  measurement.command('manifest', {
    description: 'Show the immutable raw import manifest for an imported body-measurement event.',
    args: z.object({
      id: workoutLookupSchema,
    }),
    options: withBaseOptions(),
    output: workoutImportManifestResultSchema,
    async run({ args, options }) {
      return showWorkoutMeasurementManifest(options.vault, args.id)
    },
  })

  const units = Cli.create('units', {
    description:
      'Canonical weight and body-measurement unit preferences used by measurement capture flows.',
  })

  units.command('show', {
    description: 'Show the saved workout unit preferences from the canonical preferences singleton.',
    args: z.object({}),
    options: withBaseOptions(),
    output: workoutUnitPreferencesResultSchema,
    async run({ options }) {
      return showWorkoutUnitPreferences(options.vault)
    },
  })

  units.command('set', {
    description: 'Set one or more workout unit preferences on the canonical preferences singleton.',
    args: z.object({}),
    options: withBaseOptions({
      weight: z.enum(['lb', 'kg']).optional(),
      bodyMeasurement: z
        .enum(['cm', 'in'])
        .optional()
        .describe('Preferred circumference/body-measurement unit.'),
      recordedAt: isoTimestampSchema
        .optional()
        .describe('Optional preferences update timestamp override in ISO 8601 form.'),
    }),
    output: workoutUnitPreferencesResultSchema,
    async run({ options }) {
      return setWorkoutUnitPreferences({
        vault: options.vault,
        weight: typeof options.weight === 'string' ? options.weight : undefined,
        bodyMeasurement:
          typeof options.bodyMeasurement === 'string'
            ? options.bodyMeasurement
            : undefined,
        recordedAt:
          typeof options.recordedAt === 'string'
            ? options.recordedAt
            : undefined,
      })
    },
  })

  const importGroup = Cli.create('import', {
    description:
      'Inspect and import Strong/Hevy-style workout CSV exports into immutable raw batches plus canonical workout events.',
  })

  importGroup.command('inspect', {
    description: 'Inspect one workout CSV file without writing anything.',
    args: z.object({
      file: pathSchema.describe('Path to the workout CSV export to inspect.'),
    }),
    options: withBaseOptions({
      source: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe('Optional source hint such as strong or hevy.'),
      delimiter: z
        .string()
        .min(1)
        .max(1)
        .optional()
        .describe('Optional single-character CSV delimiter override.'),
    }),
    output: workoutImportInspectResultSchema,
    async run({ args, options }) {
      return inspectWorkoutCsvImport({
        vault: options.vault,
        file: args.file,
        source: typeof options.source === 'string' ? options.source : undefined,
        delimiter: typeof options.delimiter === 'string' ? options.delimiter : undefined,
      })
    },
  })

  importGroup.command('csv', {
    description: 'Copy one workout CSV export into raw/workouts/** and optionally map it into activity_session events.',
    args: z.object({
      file: pathSchema.describe('Path to the workout CSV export to import.'),
    }),
    options: withBaseOptions({
      source: z
        .string()
        .min(1)
        .max(80)
        .optional()
        .describe('Optional source hint such as strong or hevy.'),
      delimiter: z
        .string()
        .min(1)
        .max(1)
        .optional()
        .describe('Optional single-character CSV delimiter override.'),
      storeRawOnly: z
        .boolean()
        .optional()
        .describe('Store the raw CSV + manifest without creating workout events.'),
    }),
    output: workoutImportCsvResultSchema,
    async run({ args, options }) {
      return importWorkoutCsv({
        vault: options.vault,
        file: args.file,
        source: typeof options.source === 'string' ? options.source : undefined,
        delimiter: typeof options.delimiter === 'string' ? options.delimiter : undefined,
        storeRawOnly: options.storeRawOnly === true,
      })
    },
  })

  const format = Cli.create('format', {
    description:
      'Saved workout-format defaults that store structured routine templates in bank/workout-formats.',
  })

  format.command('save', {
    description:
      'Save or update one reusable workout format from a name plus freeform text, or from a structured JSON payload.',
    args: z.object({
      name: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Saved workout format name such as "Push Day A".'),
      text: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Saved workout text.'),
    }),
    examples: [
      {
        description: 'Save one reusable strength workout format from freeform text.',
        args: {
          name: 'Push Day A',
          text: '20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.',
        },
        options: {
          vault: './vault',
        },
      },
      {
        description: 'Save a structured routine template from disk.',
        args: {},
        options: {
          input: '@routine.json',
          vault: './vault',
        },
      },
    ],
    hint:
      'Saved workout formats now support a structured template payload for routine exercises, planned sets, grouping, and persistent notes. Freeform text still works and is converted into a simple template when possible.',
    options: withBaseOptions({
      input: inputFileOptionSchema
        .optional()
        .describe('Optional structured workout format payload in @file.json form or - for stdin.'),
      duration: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe(
          'Optional default duration override in minutes when the saved note or payload is missing or ambiguous.',
        ),
      type: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe(
          'Optional default workout type override such as "run" or "strength training".',
        ),
      distanceKm: z
        .number()
        .positive()
        .max(1_000)
        .optional()
        .describe('Optional default workout distance override in kilometers.'),
    }),
    output: workoutFormatSaveResultSchema,
    async run({ args, options }) {
      const inputFile =
        typeof options.input === 'string'
          ? normalizeInputFileOption(options.input)
          : undefined
      const name = typeof args.name === 'string' ? args.name : undefined
      const text = typeof args.text === 'string' ? args.text : undefined

      if (!inputFile) {
        if (!name) {
          throw new VaultCliError(
            'contract_invalid',
            'Workout format name is required when --input is not provided.',
          )
        }

        if (!text) {
          throw new VaultCliError(
            'contract_invalid',
            'Workout format text is required when --input is not provided.',
          )
        }
      }

      return saveWorkoutFormat({
        vault: options.vault,
        name,
        text,
        inputFile,
        durationMinutes: options.duration,
        activityType:
          typeof options.type === 'string' ? options.type : undefined,
        distanceKm:
          typeof options.distanceKm === 'number'
            ? options.distanceKm
            : undefined,
      })
    },
  })

  format.command('show', {
    description: 'Show one saved workout format by name, slug, or id.',
    args: z.object({
      name: z
        .string()
        .min(1)
        .max(160)
        .describe('Saved workout format name, slug, or id.'),
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return showWorkoutFormat(options.vault, args.name)
    },
  })

  format.command('list', {
    description: 'List saved workout formats.',
    args: z.object({}),
    options: withBaseOptions({
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: workoutFormatListResultSchema,
    async run({ options }) {
      return listWorkoutFormats({
        vault: options.vault,
        limit: options.limit,
      })
    },
  })

  format.command('log', {
    description:
      'Log one dated workout from a saved workout format through the canonical activity_session write path.',
    args: z.object({
      name: z
        .string()
        .min(1)
        .max(160)
        .describe('Saved workout format name, slug, or id.'),
    }),
    examples: [
      {
        description: 'Log one saved workout format for today.',
        args: {
          name: 'Push Day A',
        },
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'Structured routine templates log directly into the rich workout session payload. Older thin formats still fall back to their saved freeform text.',
    options: withBaseOptions({
      duration: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe('Optional duration override in minutes.'),
      type: z
        .string()
        .min(1)
        .max(120)
        .optional()
        .describe(
          'Optional workout type override such as "run" or "strength training".',
        ),
      distanceKm: z
        .number()
        .positive()
        .max(1_000)
        .optional()
        .describe('Optional workout distance override in kilometers.'),
      occurredAt: isoTimestampSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form.'),
      source: eventSourceSchema
        .optional()
        .describe(
          'Optional event source (`manual`, `import`, `device`, or `derived`).',
        ),
      media: z
        .array(pathSchema)
        .optional()
        .describe('Optional workout photo or video file paths to copy into raw/workouts/** and attach to the workout event.'),
    }),
    output: workoutAddResultSchema,
    async run({ args, options }) {
      return logWorkoutFormat({
        vault: options.vault,
        name: args.name,
        durationMinutes: options.duration,
        activityType:
          typeof options.type === 'string' ? options.type : undefined,
        distanceKm:
          typeof options.distanceKm === 'number'
            ? options.distanceKm
            : undefined,
        occurredAt:
          typeof options.occurredAt === 'string'
            ? options.occurredAt
            : undefined,
        source: typeof options.source === 'string' ? options.source : undefined,
        mediaPaths: Array.isArray(options.media)
          ? options.media.filter((entry): entry is string => typeof entry === 'string')
          : undefined,
      })
    },
  })

  workout.command(measurement)
  workout.command(units)
  workout.command(importGroup)
  workout.command(format)
  cli.command(workout)
}
