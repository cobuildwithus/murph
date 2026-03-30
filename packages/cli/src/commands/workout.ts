import { Cli, z } from 'incur'
import { withBaseOptions } from '../command-helpers.js'
import {
  isoTimestampSchema,
  showResultSchema,
  workoutAddResultSchema,
  workoutFormatListResultSchema,
  workoutFormatSaveResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import {
  listWorkoutFormats,
  logWorkoutFormat,
  saveWorkoutFormat,
  showWorkoutFormat,
} from '../usecases/workout-format.js'
import {
  addWorkoutRecord,
  deleteWorkoutRecord,
  editWorkoutRecord,
} from '../usecases/workout.js'
import {
  createDirectEntityDeleteCommandDefinition,
  createDirectEventBackedEntityEditCommandDefinition,
} from './record-mutation-command-helpers.js'

const eventSourceSchema = z.enum(['manual', 'import', 'device', 'derived'])

export function registerWorkoutCommands(
  cli: Cli.Cli,
  _services: VaultCliServices,
) {
  const workout = Cli.create('workout', {
    description:
      'Quick workout capture commands routed through canonical activity-session events.',
  })

  workout.command('add', {
    description:
      'Record one workout from a freeform note with lightweight structured inference.',
    args: z.object({
      text: z
        .string()
        .min(1)
        .max(4000)
        .describe(
          'Freeform workout text such as "Went for a 30-minute run."',
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
        description:
          'Capture strength-session exercise details from one note.',
        args: {
          text: '20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.',
        },
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'The freeform note is stored on the canonical activity_session event. Explicit strength notes can also capture exercise/set/load structure; pass --duration or --type when the note is ambiguous.',
    options: withBaseOptions({
      duration: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe(
          'Optional duration override in minutes when the note is missing or ambiguous.',
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
    }),
    output: workoutAddResultSchema,
    async run({ args, options }) {
      return addWorkoutRecord({
        vault: options.vault,
        text: args.text,
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
      })
    },
  })

  workout.command('edit', createDirectEventBackedEntityEditCommandDefinition({
    arg: {
      name: 'id',
      schema: z
        .string()
        .regex(/^evt_[0-9A-Za-z]+$/u, 'Expected a canonical workout event id in evt_* form.')
        .describe('Canonical workout event id such as evt_<ULID>.'),
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
      schema: z
        .string()
        .regex(/^evt_[0-9A-Za-z]+$/u, 'Expected a canonical workout event id in evt_* form.')
        .describe('Canonical workout event id such as evt_<ULID>.'),
    },
    description: 'Delete one workout activity_session event.',
    run(input) {
      return deleteWorkoutRecord({
        vault: input.vault,
        lookup: input.lookup,
      })
    },
  }))

  const format = Cli.create('format', {
    description:
      'Saved workout-format defaults that feed the same canonical workout add pipeline.',
  })

  format.command('save', {
    description:
      'Save or update one reusable workout format from a name plus workout text.',
    args: z.object({
      name: z
        .string()
        .min(1)
        .max(160)
        .describe('Saved workout format name such as "Push Day A".'),
      text: z
        .string()
        .min(1)
        .max(4000)
        .describe('Saved workout text that should later log through workout add.'),
    }),
    examples: [
      {
        description: 'Save one reusable strength workout format.',
        args: {
          name: 'Push Day A',
          text: '20 min strength training. 4 sets of 20 pushups. 4 sets of 12 incline bench with a 45 lb bar plus 10 lb plates on both sides.',
        },
        options: {
          vault: './vault',
        },
      },
    ],
    hint:
      'This stores thin reusable defaults only. Saved workout formats are validated up front by the same inference rules that power workout add so later logging stays on the canonical activity_session path.',
    options: withBaseOptions({
      duration: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe(
          'Optional default duration override in minutes when the saved note is missing or ambiguous.',
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
      return saveWorkoutFormat({
        vault: options.vault,
        name: args.name,
        text: args.text,
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
      'Log one dated workout from a saved workout format through the same canonical event path as workout add.',
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
      'This is a thin source-of-defaults layer only. The saved workout text and defaults feed the exact same activity_session write path and strength inference behavior used by workout add.',
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
      })
    },
  })

  workout.command(format)
  cli.command(workout)
}
