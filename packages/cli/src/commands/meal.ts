import { Cli, z } from 'incur'
import {
  emptyArgsSchema,
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import {
  isoTimestampSchema,
  mealAddResultSchema,
  pathSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

export function registerMealCommands(cli: Cli.Cli, services: VaultCliServices) {
  const meal = Cli.create('meal', {
    description: 'Meal capture commands routed through the core write API.',
  })

  meal.command(
    'add',
    {
      description: 'Record a meal event using media references plus optional notes.',
      args: emptyArgsSchema,
      options: withBaseOptions({
        photo: pathSchema.describe('Required meal photo path.'),
        audio: pathSchema
          .optional()
          .describe('Optional audio note path.'),
        note: z.string().min(1).optional().describe('Optional freeform note.'),
        occurredAt: isoTimestampSchema
          .optional()
          .describe('Optional occurrence timestamp in ISO 8601 form.'),
      }),
      output: mealAddResultSchema,
      async run({ options }) {
        return services.core.addMeal({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          photo: options.photo,
          audio: options.audio,
          note: options.note,
          occurredAt: options.occurredAt,
        })
      },
    },
  )

  cli.command(meal)
}
