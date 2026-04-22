import {
  EXPERIMENT_STATUSES,
  experimentOutcomeSchema,
  experimentProgressSnapshotSchema,
} from '@murphai/contracts'
import { Cli, z } from 'incur'
import {
  requestIdFromOptions,
  withBaseOptions,
} from '@murphai/operator-config/command-helpers'
import {
  inputFileOptionSchema,
  normalizeInputFileOption,
} from '@murphai/vault-usecases'
import {
  experimentCreateResultSchema,
  listEntitySchema,
  localDateSchema,
  pathSchema,
  showResultSchema,
  slugSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'
import { normalizeOccurredAtOption } from './occurred-at-option.js'
import { commonListLimitOptionSchema } from './command-factory-primitives.js'

const experimentStatusSchema = z.enum(EXPERIMENT_STATUSES)
const experimentLookupArgSchema = z.object({
  id: z.string().min(1).describe('Experiment id or slug to resolve.'),
})

const experimentListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: experimentStatusSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listEntitySchema),
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

const experimentSessionLogResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  eventId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
  kind: z.literal('intervention_session'),
})

const experimentContextLogResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  eventId: z.string().min(1),
  ledgerFile: pathSchema,
  created: z.boolean(),
  kind: z.enum(['note', 'supplement_intake', 'experiment_context']),
})

const experimentProgressResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  asOf: localDateSchema,
  progress: experimentProgressSnapshotSchema,
})

const experimentOutcomeResultSchema = z.object({
  vault: pathSchema,
  experimentId: z.string().min(1),
  lookupId: z.string().min(1),
  slug: slugSchema,
  asOf: localDateSchema,
  outcome: experimentOutcomeSchema,
  outcomePath: pathSchema.nullable().optional(),
  updatedExperiment: z.boolean().optional(),
})

export function registerExperimentCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const experiment = Cli.create('experiment', {
    description: 'Experiment bank commands routed through the core write and query APIs.',
  })

  experiment.command('create', {
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
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        slug: String(args.slug ?? ''),
        title: typeof options.title === 'string' ? options.title : undefined,
        hypothesis: typeof options.hypothesis === 'string' ? options.hypothesis : undefined,
        startedOn: typeof options.startedOn === 'string' ? options.startedOn : undefined,
        status: typeof options.status === 'string' ? options.status : undefined,
      })
    },
  })

  experiment.command('show', {
    description: 'Show one experiment by canonical id or slug.',
    args: experimentLookupArgSchema,
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
      limit: commonListLimitOptionSchema,
      status: experimentStatusSchema.optional().describe('Optional experiment status filter.'),
    }),
    output: experimentListResultSchema,
    async run({ options }) {
      return services.query.listExperiments({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        status: options.status,
        limit: options.limit,
      })
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
      return services.core.updateExperiment({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        inputFile: normalizeInputFileOption(String(options.input ?? '')),
      })
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
      return services.core.checkpointExperiment({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        inputFile: normalizeInputFileOption(String(options.input ?? '')),
      })
    },
  })

  experiment.command('stop', {
    description: 'Stop one experiment by id or slug and append a stop lifecycle event.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      occurredAt: z
        .string()
        .min(1)
        .optional()
        .describe('Optional stop timestamp in ISO 8601 form or YYYY-MM-DD form.'),
      note: z.string().min(1).optional().describe('Optional stop note.'),
    }),
    output: experimentLifecycleResultSchema,
    async run({ args, options }) {
      return services.core.stopExperiment({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string' ? options.occurredAt : undefined,
        }),
        note: typeof options.note === 'string' ? options.note : undefined,
      })
    },
  })

  experiment.command('progress', {
    description: 'Read the deterministic progress summary for one experiment.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      asOf: localDateSchema.optional().describe('Optional analysis date in YYYY-MM-DD form.'),
    }),
    output: experimentProgressResultSchema,
    async run({ args, options }) {
      return services.query.showExperimentProgress({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        asOf: options.asOf,
      })
    },
  })

  const session = Cli.create('session', {
    description: 'Experiment session logging commands.',
  })

  session.command('log', {
    description: 'Log one structured intervention session for an experiment from a JSON payload file or stdin.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: experimentSessionLogResultSchema,
    async run({ args, options }) {
      return services.core.logExperimentSession({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        inputFile: normalizeInputFileOption(String(options.input ?? '')),
      })
    },
  })

  const context = Cli.create('context', {
    description: 'Experiment context and confounder logging commands.',
  })

  context.command('log', {
    description: 'Log one experiment-linked context record from a JSON payload file or stdin.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: experimentContextLogResultSchema,
    async run({ args, options }) {
      return services.core.logExperimentContext({
        vault: String(options.vault ?? ''),
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        inputFile: normalizeInputFileOption(String(options.input ?? '')),
      })
    },
  })

  const outcome = Cli.create('outcome', {
    description: 'Experiment outcome analysis commands.',
  })

  outcome.command('analyze', {
    description: 'Run the deterministic final analysis for one experiment.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      asOf: localDateSchema.optional().describe('Optional analysis date in YYYY-MM-DD form.'),
    }),
    output: experimentOutcomeResultSchema,
    async run({ args, options }) {
      return services.query.analyzeExperimentOutcome({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        asOf: options.asOf,
      })
    },
  })

  outcome.command('write', {
    description: 'Run the deterministic final analysis for one experiment and persist the outcome record.',
    args: experimentLookupArgSchema,
    options: withBaseOptions({
      asOf: localDateSchema.optional().describe('Optional analysis date in YYYY-MM-DD form.'),
    }),
    output: experimentOutcomeResultSchema,
    async run({ args, options }) {
      return services.core.writeExperimentOutcome({
        vault: options.vault,
        requestId: requestIdFromOptions(options),
        lookup: args.id,
        asOf: options.asOf,
      })
    },
  })

  experiment.command(session)
  experiment.command(context)
  experiment.command(outcome)

  cli.command(experiment)
}
