import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '../command-helpers.js'
import {
  experimentCreateResultSchema,
  slugSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

export function registerExperimentCommands(
  cli: Cli.Cli,
  services: VaultCliServices,
) {
  const experiment = Cli.create('experiment', {
    description: 'Experiment bank commands routed through the core write API.',
  })

  experiment.command(
    'create',
    {
      description: 'Create a baseline experiment document.',
      args: z.object({
        slug: slugSchema,
      }),
      options: withBaseOptions(),
      output: experimentCreateResultSchema,
      async run({ args, options }) {
        return services.core.createExperiment({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          slug: args.slug,
        })
      },
    },
  )

  cli.command(experiment)
}
