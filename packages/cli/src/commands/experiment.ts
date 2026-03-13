import { EXPERIMENT_STATUSES } from '@healthybob/contracts'
import { Cli, z } from 'incur'
import {
  requestIdFromOptions,
  withBaseOptions,
} from '../command-helpers.js'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from './health-command-factory.js'
import {
  experimentCreateResultSchema,
  isoTimestampSchema,
  listItemSchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
  slugSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'

const experimentStatusSchema = z.enum(EXPERIMENT_STATUSES)

const experimentListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: experimentStatusSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

const experimentUpdateResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  experimentPath: pathSchema,
  status: experimentStatusSchema,
  updated: z.boolean(),
})

const experimentLifecycleResultSchema = experimentUpdateResultSchema.extend({
  eventId: z.string().min(1),
  ledgerFile: pathSchema,
})

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
      options: withBaseOptions({
        title: z.string().min(1).optional().describe('Optional human-readable title.'),
        hypothesis: z.string().min(1).optional().describe('Optional experiment hypothesis.'),
        startedOn: localDateSchema.optional().describe('Optional experiment start date.'),
        status: experimentStatusSchema.optional().describe('Optional experiment status.'),
      }),
      output: experimentCreateResultSchema,
      async run({ args, options }) {
        return services.core.createExperiment({
          vault: options.vault,
          requestId: requestIdFromOptions(options),
          slug: args.slug,
          title: options.title,
          hypothesis: options.hypothesis,
          startedOn: options.startedOn,
          status: options.status,
        })
      },
    },
  )

  experiment.command('show', {
    description: 'Show one experiment by canonical id or slug.',
    args: z.object({
      id: z.string().min(1).describe('Experiment id or slug to resolve.'),
    }),
    options: withBaseOptions(),
    output: showResultSchema,
    async run({ args, options }) {
      return services.query.showExperiment({
        lookup: args.id,
        vault: options.vault,
        requestId: requestIdFromOptions(options),
      })
    },
  })

  experiment.command('list', {
    description: 'List experiments through the query read model.',
    args: z.object({}),
    options: withBaseOptions({
      status: experimentStatusSchema.optional().describe('Optional experiment status filter.'),
      limit: z.number().int().positive().max(200).default(50),
    }),
    output: experimentListResultSchema,
    async run({ options }) {
      const result = await services.query.listExperiments({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        status: options.status,
        limit: options.limit,
      })
      return result as z.infer<typeof experimentListResultSchema>
    },
  })

  experiment.command('update', {
    description: 'Update one experiment frontmatter/body payload from a JSON payload file or stdin.',
    args: z.object({}),
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: experimentUpdateResultSchema,
    async run({ options }) {
      const result = await services.core.updateExperiment({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        inputFile: normalizeInputFileOption(options.input),
      })
      return result as z.infer<typeof experimentUpdateResultSchema>
    },
  })

  experiment.command('checkpoint', {
    description: 'Append one experiment checkpoint event from a JSON payload file or stdin.',
    args: z.object({}),
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: experimentLifecycleResultSchema,
    async run({ options }) {
      const result = await services.core.checkpointExperiment({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        inputFile: normalizeInputFileOption(options.input),
      })
      return result as z.infer<typeof experimentLifecycleResultSchema>
    },
  })

  experiment.command('stop', {
    description: 'Stop one experiment by id or slug and append a stop lifecycle event.',
    args: z.object({
      id: z.string().min(1).describe('Experiment id or slug to stop.'),
    }),
    options: withBaseOptions({
      occurredAt: isoTimestampSchema
        .optional()
        .describe('Optional stop timestamp in ISO 8601 form.'),
      note: z.string().min(1).optional().describe('Optional stop note.'),
    }),
    output: experimentLifecycleResultSchema,
    async run({ args, options }) {
      const result = await services.core.stopExperiment({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        occurredAt: options.occurredAt,
        note: options.note,
      })
      return result as z.infer<typeof experimentLifecycleResultSchema>
    },
  })

  cli.command(experiment)
}
