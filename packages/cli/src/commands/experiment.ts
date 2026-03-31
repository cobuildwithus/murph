import { EXPERIMENT_STATUSES } from '@murph/contracts'
import { Cli, z } from 'incur'
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
} from '@murph/assistant-core/vault-cli-contracts'
import type { VaultServices } from '@murph/assistant-core/vault-services'
import { registerLifecycleEntityGroup } from './health-command-factory.js'

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
  services: VaultServices,
) {
  registerLifecycleEntityGroup(cli, {
    commandName: 'experiment',
    description: 'Experiment bank commands routed through the core write API.',
    create: {
      name: 'create',
      description: 'Create a baseline experiment document.',
      args: z.object({
        slug: slugSchema,
      }),
      options: {
        title: z.string().min(1).optional().describe('Optional human-readable title.'),
        hypothesis: z.string().min(1).optional().describe('Optional experiment hypothesis.'),
        startedOn: localDateSchema.optional().describe('Optional experiment start date.'),
        status: experimentStatusSchema.optional().describe('Optional experiment status.'),
      },
      output: experimentCreateResultSchema,
      async run({ args, options, requestId }) {
        return services.core.createExperiment({
          vault: String(options.vault ?? ''),
          requestId,
          slug: String(args.slug ?? ''),
          title: typeof options.title === 'string' ? options.title : undefined,
          hypothesis: typeof options.hypothesis === 'string' ? options.hypothesis : undefined,
          startedOn: typeof options.startedOn === 'string' ? options.startedOn : undefined,
          status: typeof options.status === 'string' ? options.status : undefined,
        })
      },
    },
    show: {
      description: 'Show one experiment by canonical id or slug.',
      argName: 'id',
      argSchema: z.string().min(1).describe('Experiment id or slug to resolve.'),
      output: showResultSchema,
      async run(input) {
        return services.query.showExperiment({
          lookup: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    list: {
      description: 'List experiments through the query read model.',
      statusOption: experimentStatusSchema.optional().describe('Optional experiment status filter.'),
      output: experimentListResultSchema,
      async run(input) {
        return services.query.listExperiments({
          vault: input.vault,
          requestId: input.requestId,
          status: input.status,
          limit: input.limit ?? 50,
        })
      },
    },
    update: {
      name: 'update',
      args: z.object({}),
      description: 'Update one experiment frontmatter/body payload from a JSON payload file or stdin.',
      options: {
        input: inputFileOptionSchema,
      },
      output: experimentUpdateResultSchema,
      async run({ options, requestId }) {
        return services.core.updateExperiment({
          vault: String(options.vault ?? ''),
          requestId,
          inputFile: normalizeInputFileOption(String(options.input ?? '')),
        })
      },
    },
    checkpoint: {
      name: 'checkpoint',
      args: z.object({}),
      description: 'Append one experiment checkpoint event from a JSON payload file or stdin.',
      options: {
        input: inputFileOptionSchema,
      },
      output: experimentLifecycleResultSchema,
      async run({ options, requestId }) {
        return services.core.checkpointExperiment({
          vault: String(options.vault ?? ''),
          requestId,
          inputFile: normalizeInputFileOption(String(options.input ?? '')),
        })
      },
    },
    stop: {
      description: 'Stop one experiment by id or slug and append a stop lifecycle event.',
      argName: 'id',
      argSchema: z.string().min(1).describe('Experiment id or slug to stop.'),
      options: {
        occurredAt: isoTimestampSchema
          .optional()
          .describe('Optional stop timestamp in ISO 8601 form.'),
        note: z.string().min(1).optional().describe('Optional stop note.'),
      },
      output: experimentLifecycleResultSchema,
      async run(input) {
        return services.core.stopExperiment({
          vault: input.vault,
          requestId: input.requestId,
          lookup: input.id,
          occurredAt:
            typeof input.occurredAt === 'string' ? input.occurredAt : undefined,
          note: typeof input.note === 'string' ? input.note : undefined,
        })
      },
    },
  })
}
