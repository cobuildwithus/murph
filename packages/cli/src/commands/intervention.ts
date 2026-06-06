import { Cli, z } from 'incur'
import { eventSourceSchema } from '@murphai/contracts'
import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import {
  interventionAddResultSchema,
  occurredAtOptionSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'
import {
  addInterventionRecord,
  deleteInterventionRecord,
  editInterventionRecord,
} from '@murphai/vault-usecases/records'
import {
  appendTypedClear,
  appendTypedSet,
  createDirectEntityDeleteCommandDefinition,
  createDirectEventBackedEntityEditCommandDefinition,
  emptyToUndefined,
  numberOption,
  stringOption,
} from './record-mutation-command-helpers.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'
const regimenIdSchema = z
  .string()
  .regex(/^reg_[0-9A-Za-z]+$/u, 'Expected a canonical regimen id in reg_* form.')
const interventionLookupSchema = z
  .string()
  .regex(/^evt_[0-9A-Za-z]+$/u, 'Expected a canonical intervention event id in evt_* form.')
const experimentLookupSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)

export function registerInterventionCommands(
  cli: Cli.Cli,
  _services: VaultServices,
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
          text: "'20 min sauna after lifting.'",
        },
        options: {
          vault: './vault',
        },
      },
      {
        description: 'Capture an HBOT clinic session and link it to a regimen.',
        args: {
          text: "'HBOT session at the clinic.'",
        },
        options: {
          vault: './vault',
          duration: 60,
          regimenId: 'reg_01JNV422Y2M5ZBV64ZP4N1DRB1',
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
      regimenId: regimenIdSchema
        .optional()
        .describe(
          'Optional regimen id to relate this intervention session back to one active therapy or habit.',
        ),
      experiment: experimentLookupSchema
        .optional()
        .describe(
          'Optional experiment slug or id to link explicitly. Omit for automatic single-match linking.',
        ),
      skipExperimentLink: z
        .boolean()
        .optional()
        .describe('Disable automatic experiment linking for this capture.'),
      allowOutOfWindow: z
        .boolean()
        .optional()
        .describe('Allow an explicit --experiment link outside the intervention window.'),
      occurredAt: occurredAtOptionSchema
        .optional()
        .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
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
        regimenId:
          typeof options.regimenId === 'string'
            ? options.regimenId
            : undefined,
        experiment:
          typeof options.experiment === 'string' ? options.experiment : undefined,
        noExperiment: options.skipExperimentLink === true,
        allowOutOfWindow: options.allowOutOfWindow === true,
        occurredAt: await normalizeOccurredAtOption({
          vault: options.vault,
          occurredAt:
            typeof options.occurredAt === 'string'
              ? options.occurredAt
              : undefined,
        }),
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
      'Edit one intervention session from typed fields.',
    options: {
      type: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Replace the intervention type.'),
      duration: z
        .number()
        .int()
        .positive()
        .max(24 * 60)
        .optional()
        .describe('Replace the duration in minutes.'),
      regimenId: regimenIdSchema
        .optional()
        .describe('Replace the related regimen id.'),
      clearDuration: z.boolean().optional().describe('Clear the saved duration.'),
      clearRegimenId: z.boolean().optional().describe('Clear the saved regimen id and related links.'),
    },
    buildPatch(options) {
      const set: string[] = []
      const clear: string[] = []
      appendTypedSet(set, 'interventionType', stringOption(options.type))
      appendTypedSet(set, 'durationMinutes', numberOption(options.duration))
      appendTypedSet(set, 'regimenId', stringOption(options.regimenId))
      appendTypedClear(clear, 'durationMinutes', options.clearDuration === true)
      appendTypedClear(clear, 'regimenId', options.clearRegimenId === true)
      return {
        set: emptyToUndefined(set),
        clear: emptyToUndefined(clear),
      }
    },
    run(input) {
      return editInterventionRecord({
        vault: input.vault,
        lookup: input.lookup,
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
