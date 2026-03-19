import { Cli, z } from 'incur'
import { withBaseOptions } from '../command-helpers.js'
import {
  isoTimestampSchema,
  workoutAddResultSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import { addWorkoutRecord } from '../usecases/workout.js'

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

  cli.command(workout)
}
