import { Cli, z } from "incur"
import { REGIMEN_STATUSES } from "@murphai/contracts"
import { requestIdFromOptions, withBaseOptions } from "@murphai/operator-config/command-helpers"
import {
  healthListResultSchema,
  healthShowResultSchema,
} from "@murphai/vault-usecases"
import {
  commonListLimitOptionSchema,
  suggestedCommandsCta,
} from "./command-factory-primitives.js"
import {
  localDateSchema,
  pathSchema,
  savedEntitySnapshotSchema,
} from "@murphai/operator-config/vault-cli-contracts"
import {
  searchSupplementLabels,
  searchSupplementLabelsBatch,
  supplementLabelBatchSearchResultSchema,
  supplementLabelSearchResultSchema,
} from "../supplement-labels.js"
import type { VaultServices } from "@murphai/vault-usecases"

const supplementSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')

const supplementStatusSchema = z.enum(REGIMEN_STATUSES)
const statusOptionSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Optional supplement status to filter by.')
const compoundStatusOptionSchema = z
  .string()
  .min(1)
  .optional()
  .describe('Optional supplement status to filter by. Defaults to active for compound rollups.')

const supplementUpsertResultSchema = z.object({
  vault: pathSchema,
  regimenId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema.optional(),
  created: z.boolean(),
  entity: savedEntitySnapshotSchema,
})

const stopResultSchema = z.object({
  vault: pathSchema,
  regimenId: z.string().min(1),
  lookupId: z.string().min(1),
  stoppedOn: localDateSchema.nullable(),
  status: z.string().min(1),
})

const compoundSourceSchema = z.object({
  supplementId: z.string().min(1),
  supplementSlug: z.string().min(1),
  supplementTitle: z.string().nullable(),
  brand: z.string().nullable(),
  manufacturer: z.string().nullable(),
  status: z.string().nullable(),
  label: z.string().nullable(),
  amount: z.number().nonnegative().nullable(),
  unit: z.string().nullable(),
  note: z.string().nullable(),
})

const compoundTotalSchema = z.object({
  unit: z.string().nullable(),
  totalAmount: z.number().nonnegative().nullable(),
  sourceCount: z.number().int().nonnegative(),
  incomplete: z.boolean(),
})

const compoundRecordSchema = z.object({
  compound: z.string().min(1),
  lookupId: z.string().min(1),
  totals: z.array(compoundTotalSchema),
  supplementCount: z.number().int().nonnegative(),
  supplementIds: z.array(z.string().min(1)),
  sources: z.array(compoundSourceSchema),
})

const compoundFiltersSchema = z.object({
  status: z.string().min(1),
  limit: commonListLimitOptionSchema.optional(),
})

const compoundShowResultSchema = z.object({
  vault: pathSchema,
  filters: compoundFiltersSchema,
  compound: compoundRecordSchema,
})

const compoundListResultSchema = z.object({
  vault: pathSchema,
  filters: compoundFiltersSchema,
  items: z.array(compoundRecordSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

function repeatedRelationOptionSchema(description: string) {
  return z.array(z.string().min(1)).optional().describe(description)
}

export function registerSupplementCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const supplement = Cli.create('supplement', {
    description: 'Supplement product commands plus a derived active-compound ledger.',
  })

  supplement.command('list', {
    args: z.object({}),
    description: 'List supplements through the health read model.',
    examples: [
      {
        description: 'List active supplements with a smaller page size.',
        options: {
          limit: 10,
          status: 'active',
          vault: './vault',
        },
      },
    ],
    hint: 'Use --status active to focus on current supplements or --limit to cap results.',
    options: withBaseOptions({
      limit: commonListLimitOptionSchema,
      status: statusOptionSchema,
    }),
    output: healthListResultSchema,
    async run(context) {
      return services.query.listSupplements({
        limit: context.options.limit ?? 50,
        requestId: requestIdFromOptions(context.options),
        status: context.options.status,
        vault: context.options.vault,
      })
    },
  })

  supplement.command('show', {
    args: z.object({
      id: z.string().min(1).describe('Canonical supplement id or slug.'),
    }),
    description: 'Show one supplement by canonical id or slug.',
    examples: [
      {
        args: {
          id: '<supplement-id>',
        },
        description: 'Show one saved supplement product.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint: 'Use the canonical supplement id or the supplement slug.',
    options: withBaseOptions({}),
    output: healthShowResultSchema,
    async run(context) {
      return services.query.showSupplement({
        id: context.args.id,
        requestId: requestIdFromOptions(context.options),
        vault: context.options.vault,
      })
    },
  })

  supplement.command('search-labels', {
    args: z.object({
      query: z
        .string()
        .min(1)
        .describe('Supplement product, brand, ingredient, DSLD id, or UPC search text.'),
    }),
    description: 'Search the hosted supplement label database from hosted assistant runtime without writing records.',
    examples: [
      {
        args: {
          query: 'creatine',
        },
        description: 'Search supplement labels by product or ingredient text.',
        options: {
          limit: 1,
        },
      },
    ],
    hint: 'Hosted assistant runtime authorizes this lookup through the Worker data API intercept.',
    options: z.object({
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('Maximum label matches to return. Defaults to 1.'),
      includeOffMarket: z
        .boolean()
        .optional()
        .describe('Include labels marked off-market.'),
    }),
    output: supplementLabelSearchResultSchema,
    async run(context) {
      return await searchSupplementLabels({
        includeOffMarket: context.options.includeOffMarket,
        limit: context.options.limit,
        q: context.args.query,
      })
    },
  })

  supplement.command('search-labels-batch', {
    args: z.object({}),
    description: 'Search multiple hosted supplement label queries from hosted assistant runtime without writing records.',
    examples: [
      {
        description: 'Search labels for several supplement names in one hosted API call.',
        options: {
          query: ['creatine', 'magnesium glycinate', 'blueprint bryan johnson'],
          limit: 1,
        },
      },
    ],
    hint: 'Repeat --query for each supplement. Hosted assistant runtime authorizes this lookup through the Worker data API intercept.',
    options: z.object({
      query: z
        .array(z.string().min(1).max(256))
        .min(1)
        .max(10)
        .describe('Supplement product, brand, or ingredient search text. Repeat --query for multiple values.'),
      limit: z
        .number()
        .int()
        .positive()
        .max(50)
        .optional()
        .describe('Maximum label matches to return per query. Defaults to 1.'),
      includeOffMarket: z
        .boolean()
        .optional()
        .describe('Include labels marked off-market.'),
    }),
    output: supplementLabelBatchSearchResultSchema,
    async run(context) {
      return await searchSupplementLabelsBatch({
        includeOffMarket: context.options.includeOffMarket,
        limit: context.options.limit,
        queries: context.options.query,
      })
    },
  })

  supplement.command('stop', {
    args: z.object({
      id: z.string().min(1).describe('Canonical supplement id to stop.'),
    }),
    description: 'Stop one supplement while preserving its canonical id.',
    examples: [
      {
        args: {
          id: '<supplement-id>',
        },
        description: 'Stop a supplement today.',
        options: {
          vault: './vault',
        },
      },
      {
        args: {
          id: '<supplement-id>',
        },
        description: 'Stop a supplement on a specific calendar day.',
        options: {
          stoppedOn: '2026-03-12',
          vault: './vault',
        },
      },
    ],
    hint: 'Use the canonical supplement id so the stop event is attached to the existing supplement regimen record.',
    options: withBaseOptions({
      stoppedOn: localDateSchema
        .optional()
        .describe('Optional calendar day when the supplement stopped. Defaults to today.'),
    }),
    output: stopResultSchema,
    async run(context) {
      const result = await services.core.stopRegimen({
        regimenId: context.args.id,
        group: 'supplement',
        stoppedOn: context.options.stoppedOn,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })

      return context.ok(result, {
        cta: suggestedCommandsCta([
          {
            command: 'supplement show',
            args: {
              id: context.args.id,
            },
            description: 'Show the stopped supplement record.',
            options: {
              vault: true,
            },
          },
          {
            command: 'supplement list',
            description: 'List stopped supplements.',
            options: {
              status: 'stopped',
              vault: true,
            },
          },
        ]),
      })
    },
  })

  supplement.command('save', {
    args: z.object({
      title: z.string().min(1).max(160).describe('Supplement product title or name.'),
    }),
    description: 'Create or update one supplement from typed command fields.',
    examples: [
      {
        args: {
          title: 'Magnesium glycinate',
        },
        description: 'Save a supplement product without a JSON payload file.',
        options: {
          amount: 200,
          compound: 'Magnesium',
          schedule: 'nightly',
          unit: 'mg',
          vault: './vault',
        },
      },
    ],
    hint: 'Supplements are saved as regimen records with kind supplement.',
    options: withBaseOptions({
      id: z
        .string()
        .min(1)
        .optional()
        .describe('Optional existing supplement regimen id to update.'),
      slug: supplementSlugSchema
        .optional()
        .describe('Optional stable lowercase kebab-case slug.'),
      status: supplementStatusSchema
        .optional()
        .describe('Optional supplement status.'),
      startedOn: localDateSchema
        .optional()
        .describe('Optional calendar day when the supplement started.'),
      stoppedOn: localDateSchema
        .optional()
        .describe('Optional calendar day when the supplement stopped.'),
      schedule: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional schedule or timing note, such as nightly or with breakfast.'),
      group: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional supplement group path for organizing records.'),
      substance: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional top-level substance or supplement label.'),
      dose: z
        .number()
        .nonnegative()
        .optional()
        .describe('Optional top-level supplement dose amount.'),
      doseUnit: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe('Optional unit for the top-level supplement dose.'),
      brand: z.string().min(1).max(160).optional().describe('Optional product brand.'),
      manufacturer: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional product manufacturer.'),
      servingSize: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional serving-size label.'),
      compound: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional primary ingredient or compound name.'),
      ingredientLabel: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional ingredient label as it appears on the product.'),
      amount: z
        .number()
        .nonnegative()
        .optional()
        .describe('Optional amount for the primary compound.'),
      unit: z
        .string()
        .min(1)
        .max(40)
        .optional()
        .describe('Optional unit for the primary compound amount.'),
      ingredientActive: z
        .boolean()
        .optional()
        .describe('Optional active flag for the primary compound ingredient.'),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional note for the primary compound. Requires --compound.'),
      relatedGoalId: repeatedRelationOptionSchema(
        'Optional related goal id. Repeat --related-goal-id for multiple values.',
      ),
      relatedConditionId: repeatedRelationOptionSchema(
        'Optional related condition id. Repeat --related-condition-id for multiple values.',
      ),
      relatedRegimenId: repeatedRelationOptionSchema(
        'Optional related regimen id. Repeat --related-regimen-id for multiple values.',
      ),
    }),
    output: supplementUpsertResultSchema,
    async run(context) {
      const saved = await services.core.saveSupplement({
        amount: context.options.amount,
        brand: context.options.brand,
        compound: context.options.compound,
        dose: context.options.dose,
        doseUnit: context.options.doseUnit,
        group: context.options.group,
        ingredientActive: context.options.ingredientActive,
        ingredientLabel: context.options.ingredientLabel,
        manufacturer: context.options.manufacturer,
        note: context.options.note,
        regimenId: context.options.id,
        relatedConditionId: context.options.relatedConditionId,
        relatedGoalId: context.options.relatedGoalId,
        relatedRegimenId: context.options.relatedRegimenId,
        requestId: requestIdFromOptions(context.options),
        schedule: context.options.schedule,
        servingSize: context.options.servingSize,
        slug: context.options.slug,
        startedOn: context.options.startedOn,
        status: context.options.status,
        stoppedOn: context.options.stoppedOn,
        substance: context.options.substance,
        title: context.args.title,
        unit: context.options.unit,
        vault: context.options.vault,
      })

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: 'supplement show',
            args: {
              id: saved.regimenId,
            },
            description: 'Show the saved supplement record.',
            options: {
              vault: true,
            },
          },
          {
            command: 'supplement list',
            description: 'List supplements.',
            options: {
              vault: true,
            },
          },
        ]),
      })
    },
  })

  const compound = Cli.create('compound', {
    description: 'Derived canonical ledger of active compounds across supplements.',
  })

  compound.command('list', {
    args: z.object({}),
    description: 'List rolled-up supplement compounds across supplements.',
    examples: [
      {
        description: 'List active compounds from current supplements.',
        options: {
          vault: './vault',
        },
      },
      {
        description: 'List stopped-supplement compounds with a smaller page size.',
        options: {
          limit: 10,
          status: 'stopped',
          vault: './vault',
        },
      },
    ],
    hint: 'The compound ledger defaults to active supplements so overlapping ingredients sum into a single canonical row.',
    options: withBaseOptions({
      limit: commonListLimitOptionSchema,
      status: compoundStatusOptionSchema,
    }),
    output: compoundListResultSchema,
    async run(context) {
      return services.query.listSupplementCompounds({
        limit: context.options.limit,
        status: context.options.status,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })
    },
  })

  compound.command('show', {
    args: z.object({
      compound: z.string().min(1),
    }),
    description: 'Show one rolled-up supplement compound by name or lookup id.',
    examples: [
      {
        args: {
          compound: 'vitamin-c',
        },
        description: 'Show one rolled-up compound by lookup id.',
        options: {
          vault: './vault',
        },
      },
      {
        args: {
          compound: 'Magnesium',
        },
        description: 'Show one rolled-up compound by display name.',
        options: {
          vault: './vault',
        },
      },
    ],
    hint: 'Lookup ids are kebab-cased compound names derived from the canonical compound field.',
    options: withBaseOptions({
      status: compoundStatusOptionSchema,
    }),
    output: compoundShowResultSchema,
    async run(context) {
      return services.query.showSupplementCompound({
        compound: context.args.compound,
        status: context.options.status,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
      })
    },
  })

  supplement.command(compound)
  cli.command(supplement)
}
