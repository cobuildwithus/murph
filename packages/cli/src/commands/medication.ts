import { Cli, z } from 'incur'
import { requestIdFromOptions, withBaseOptions } from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  localDateSchema,
  pathSchema,
  savedEntitySnapshotSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import type { VaultServices } from '@murphai/vault-usecases'

import { suggestedCommandsCta } from './command-factory-primitives.js'

const medicationSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')
const medicationHistoryDefaultGroup = 'medication/history'
const medicationHistoryCollisionScanLimit = 1000

export const medicationHistoryResultSchema = z.object({
  vault: pathSchema,
  regimenId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
  entity: savedEntitySnapshotSchema,
})

function repeatedRelationOptionSchema(description: string) {
  return z.array(z.string().min(1)).optional().describe(description)
}

function createCommonMedicationOptions() {
  return {
    id: z
      .string()
      .min(1)
      .optional()
      .describe('Optional existing medication regimen id to update.'),
    slug: medicationSlugSchema
      .optional()
      .describe('Optional stable lowercase kebab-case slug.'),
    stoppedOn: localDateSchema
      .optional()
      .describe('Optional calendar day when the medication stopped.'),
    schedule: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe('Optional schedule or timing note.'),
    substance: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe('Optional active substance or medication label.'),
    dose: z
      .number()
      .nonnegative()
      .optional()
      .describe('Optional numeric dose.'),
    unit: z
      .string()
      .min(1)
      .max(40)
      .optional()
      .describe('Optional unit for the dose.'),
    group: z
      .string()
      .min(1)
      .max(160)
      .optional()
      .describe('Optional medication group path for organizing records.'),
    note: z
      .string()
      .min(1)
      .max(4000)
      .optional()
      .describe('Optional note for record provenance, uncertainty, or context.'),
    relatedGoalId: repeatedRelationOptionSchema(
      'Optional related goal id. Repeat --related-goal-id for multiple values.',
    ),
    relatedConditionId: repeatedRelationOptionSchema(
      'Optional related condition id. Repeat --related-condition-id for multiple values.',
    ),
    relatedRegimenId: repeatedRelationOptionSchema(
      'Optional related regimen id. Repeat --related-regimen-id for multiple values.',
    ),
  }
}

function medicationHistoryDefaultSlug(input: {
  title: string
  startedOn: string
  stoppedOn?: string
}): string {
  const suffix = input.stoppedOn
    ? `${input.startedOn}-${input.stoppedOn}`
    : input.startedOn
  const titleSlug = input.title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'medication-course'
  const maxTitleLength = Math.max(1, 160 - suffix.length - 1)
  const titlePrefix = titleSlug.slice(0, maxTitleLength).replace(/-+$/u, '') || 'medication-course'

  return `${titlePrefix}-${suffix}`
}

function medicationHistorySlug(input: {
  explicitSlug?: string
  title: string
  startedOn: string
  stoppedOn?: string
}): string | undefined {
  if (input.explicitSlug) {
    return input.explicitSlug
  }

  return medicationHistoryDefaultSlug(input)
}

async function assertGeneratedMedicationHistorySlugIsUnused(
  services: VaultServices,
  input: {
    group: string
    requestId: string | null
    slug: string
    vault: string
  },
) {
  const expectedPath = `bank/regimens/${input.group}/${input.slug}.md`
  const regimens = await services.query.listRegimens({
    limit: medicationHistoryCollisionScanLimit,
    requestId: input.requestId,
    vault: input.vault,
  })
  const existing = regimens.items.find((item) => {
    const dataGroup = typeof item.data.group === 'string' ? item.data.group : undefined
    return (
      item.path === expectedPath ||
      (dataGroup === input.group && item.path?.endsWith(`/${input.slug}.md`))
    )
  })

  if (existing) {
    throw new VaultCliError(
      'VAULT_REGIMEN_CONFLICT',
      `Medication history course already exists at ${expectedPath}. Use --id or --slug for an intentional update, or choose a distinct --slug for a separate course.`,
    )
  }
}

export function registerMedicationCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const medication = Cli.create('medication', {
    description: 'Medication commands backed by the private regimen registry.',
  })

  const history = Cli.create('history', {
    description: 'Historical medication courses copied from records.',
  })

  history.command('add', {
    args: z.object({
      title: z.string().min(1).max(160).describe('Medication course title or name.'),
    }),
    description: 'Save an old medication course as a completed regimen record.',
    examples: [
      {
        args: {
          title: 'Antibiotic course',
        },
        description: 'Save a past medication course from a record.',
        options: {
          dose: 875,
          note: 'Copied from imported record; exact schedule not stated.',
          schedule: 'twice daily',
          startedOn: '2019-04-10',
          stoppedOn: '2019-04-20',
          substance: 'amoxicillin',
          unit: 'mg',
          vault: './vault',
        },
      },
    ],
    hint: 'This writes a completed medication regimen, not a point-in-time intake event.',
    options: withBaseOptions({
      ...createCommonMedicationOptions(),
      startedOn: localDateSchema.describe('Calendar day when the historical medication course started.'),
    }),
    output: medicationHistoryResultSchema,
    async run(context) {
      const group = context.options.group ?? medicationHistoryDefaultGroup
      const requestId = requestIdFromOptions(context.options)
      const slug = medicationHistorySlug({
        explicitSlug: context.options.slug,
        startedOn: context.options.startedOn,
        stoppedOn: context.options.stoppedOn,
        title: context.args.title,
      })
      if (!context.options.id && !context.options.slug && slug) {
        await assertGeneratedMedicationHistorySlugIsUnused(services, {
          group,
          requestId,
          slug,
          vault: context.options.vault,
        })
      }

      const saved = await services.core.saveRegimen({
        dose: context.options.dose,
        group,
        kind: 'medication',
        note: context.options.note,
        regimenId: context.options.id,
        relatedConditionId: context.options.relatedConditionId,
        relatedGoalId: context.options.relatedGoalId,
        relatedRegimenId: context.options.relatedRegimenId,
        requestId,
        schedule: context.options.schedule,
        slug,
        startedOn: context.options.startedOn,
        status: 'completed',
        stoppedOn: context.options.stoppedOn,
        substance: context.options.substance,
        title: context.args.title,
        unit: context.options.unit,
        vault: context.options.vault,
      })

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: 'regimen show',
            args: {
              id: saved.regimenId,
            },
            description: 'Show the saved historical medication course.',
            options: {
              vault: true,
            },
          },
          {
            command: 'regimen list',
            description: 'List completed regimen records.',
            options: {
              status: 'completed',
              vault: true,
            },
          },
        ]),
      })
    },
  })

  medication.command(history)
  cli.command(medication)
}
