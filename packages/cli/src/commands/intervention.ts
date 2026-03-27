import { Cli, z } from 'incur'
import { withBaseOptions } from '../command-helpers.js'
import {
  interventionAddResultSchema,
  isoTimestampSchema,
} from '../vault-cli-contracts.js'
import type { VaultCliServices } from '../vault-cli-services.js'
import {
  addInterventionRecord,
  deleteInterventionRecord,
  editInterventionRecord,
} from '../usecases/intervention.js'
import {
  createDirectEntityDeleteCommandDefinition,
  createDirectEventBackedEntityEditCommandDefinition,
} from './record-mutation-command-helpers.js'

const eventSourceSchema = z.enum(['manual', 'import', 'device', 'derived'])
const protocolIdSchema = z
  .string()
  .regex(/^prot_[0-9A-Za-z]+$/u, 'Expected a canonical protocol id in prot_* form.')
const interventionLookupSchema = z
  .string()
  .regex(/^evt_[0-9A-Za-z]+$/u, 'Expected a canonical intervention event id in evt_* form.')

export function registerInterventionCommands(
  cli: Cli.Cli,
  _services: VaultCliServices,
) {
  const intervention = Cli.create('intervention', {
    description:
      'Quick intervention capture commands routed through canonical intervention-session events.',
  })

  intervention.command('add', {
    description:
      'Record one intervention session from a freeform note with lightweight structured inference.',
    args: z.object({
      text: z
        .string()
        .min(1)
        .max(4000)
        .describe(
          'Freeform intervention text such as "20 min sauna after lifting."',
        ),
    }),
    examples: [
      {
        description: 'Capture a sauna session directly from one note.',
        args: {
          text: '20 min sauna after lifting.',
        },
        options: {
          vault: './vault',
        },
      },
      {
        description: 'Capture an HBOT clinic session and link it to a protocol.',
        args: {
          text: 'HBOT session at the clinic.',
        },
        options: {
          vault: './vault',
          duration: 60,
          protocolId: 'prot_01JNV422Y2M5ZBV64ZP4N1DRB1',
        },
      },
    ],
    hint:
      'The freeform note is stored on the canonical intervention_session event. Pass --type when the note names multiple interventions and --duration when the note mentions an ambiguous duration.',
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
        .max(160)
        .optional()
        .describe(
          'Optional intervention type override such as "sauna" or "hbot".',
        ),
      protocolId: protocolIdSchema
        .optional()
        .describe(
          'Optional protocol id to relate this intervention session back to one active therapy or habit.',
        ),
      occurredAt: isoTimestampSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form.'),
      source: eventSourceSchema
        .optional()
        .describe(
          'Optional event source (`manual`, `import`, `device`, or `derived`).',
        ),
    }),
    output: interventionAddResultSchema,
    async run({ args, options }) {
      return addInterventionRecord({
        vault: options.vault,
        text: args.text,
        durationMinutes: options.duration,
        interventionType:
          typeof options.type === 'string' ? options.type : undefined,
        protocolId:
          typeof options.protocolId === 'string'
            ? options.protocolId
            : undefined,
        occurredAt:
          typeof options.occurredAt === 'string'
            ? options.occurredAt
            : undefined,
        source: typeof options.source === 'string' ? options.source : undefined,
      })
    },
  })

  intervention.command('edit', createDirectEventBackedEntityEditCommandDefinition({
    arg: {
      name: 'id',
      schema: interventionLookupSchema.describe('Canonical intervention event id such as evt_<ULID>.'),
    },
    description:
      'Edit one intervention session by merging a partial JSON patch or one or more path assignments into the saved event.',
    run(input) {
      return editInterventionRecord({
        vault: input.vault,
        lookup: input.lookup,
        inputFile: input.inputFile,
        set: input.set,
        clear: input.clear,
        dayKeyPolicy: input.dayKeyPolicy,
      })
    },
  }))

  intervention.command('delete', createDirectEntityDeleteCommandDefinition({
    arg: {
      name: 'id',
      schema: interventionLookupSchema.describe('Canonical intervention event id such as evt_<ULID>.'),
    },
    description: 'Delete one intervention_session event.',
    run(input) {
      return deleteInterventionRecord({
        vault: input.vault,
        lookup: input.lookup,
      })
    },
  }))

  cli.command(intervention)
}
