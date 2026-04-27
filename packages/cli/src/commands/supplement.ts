import { Cli, z } from "incur"
import { REGIMEN_STATUSES } from "@murphai/contracts"
import {
  upsertRegimen,
} from "@murphai/core"
import { VaultCliError } from "@murphai/operator-config/vault-cli-errors"
import { requestIdFromOptions, withBaseOptions } from "@murphai/operator-config/command-helpers"
import {
  createHealthScaffoldResultSchema,
  healthListResultSchema,
  healthShowResultSchema,
  inputFileOptionSchema,
  normalizeInputFileOption,
  normalizeRepeatableFlagOption,
} from "@murphai/vault-usecases"
import {
  createRegistryDocEntityGroup,
} from "./entity-command-groups.js"
import {
  commonListLimitOptionSchema,
  suggestedCommandsCta,
} from "./command-factory-primitives.js"
import { localDateSchema, pathSchema } from "@murphai/operator-config/vault-cli-contracts"
import type { VaultServices } from "@murphai/vault-usecases"

const supplementSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')
type RegimenUpsertInput = Parameters<typeof upsertRegimen>[0]
type SupplementIngredientRecord = NonNullable<RegimenUpsertInput["ingredients"]>[number]

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

function buildSupplementIngredient(options: {
  amount?: number
  compound?: string
  ingredientActive?: boolean
  ingredientLabel?: string
  note?: string
  unit?: string
}): SupplementIngredientRecord[] | undefined {
  if (!options.compound) {
    if (
      options.amount !== undefined ||
      options.ingredientActive !== undefined ||
      options.ingredientLabel !== undefined ||
      options.note !== undefined ||
      options.unit !== undefined
    ) {
      throw new VaultCliError(
        'invalid_option',
        '--compound is required when ingredient fields are provided.',
      )
    }

    return undefined
  }

  return [
    {
      compound: options.compound,
      label: options.ingredientLabel,
      amount: options.amount,
      unit: options.unit,
      active: options.ingredientActive,
      note: options.note,
    },
  ]
}

function normalizeComparableText(value: string | undefined): string | undefined {
  const normalized = value?.trim().toLowerCase()
  return normalized && normalized.length > 0 ? normalized : undefined
}

function namesCouldReferToSameDose(input: {
  compound?: string
  substance?: string
}): boolean {
  const substance = normalizeComparableText(input.substance)
  const compound = normalizeComparableText(input.compound)

  return substance === undefined || compound === undefined || substance === compound
}

function validateSupplementSaveInput(input: {
  amount?: number
  compound?: string
  dose?: number
  doseUnit?: string
  substance?: string
  unit?: string
}) {
  if (input.doseUnit !== undefined && input.dose === undefined) {
    throw new VaultCliError('invalid_option', '--dose-unit requires --dose.')
  }

  if (
    input.dose !== undefined &&
    input.amount !== undefined &&
    input.dose === input.amount &&
    input.doseUnit !== undefined &&
    input.unit !== undefined &&
    normalizeComparableText(input.doseUnit) !== normalizeComparableText(input.unit) &&
    namesCouldReferToSameDose(input)
  ) {
    throw new VaultCliError(
      'invalid_option',
      '--dose-unit and --unit describe the same numeric dose but use different units. Use --dose-unit for the top-level dose and --unit for the ingredient amount.',
    )
  }
}

function buildSupplementSaveInput(input: {
  amount?: number
  brand?: string
  compound?: string
  dose?: number
  doseUnit?: string
  group?: string
  ingredientActive?: boolean
  ingredientLabel?: string
  manufacturer?: string
  note?: string
  regimenId?: string
  relatedConditionId?: string[]
  relatedGoalId?: string[]
  relatedRegimenId?: string[]
  schedule?: string
  servingSize?: string
  slug?: string
  startedOn?: string
  status?: z.infer<typeof supplementStatusSchema>
  stoppedOn?: string
  substance?: string
  title: string
  unit?: string
  vault: string
}): RegimenUpsertInput {
  validateSupplementSaveInput(input)

  return {
    vaultRoot: input.vault,
    regimenId: input.regimenId,
    slug: input.slug,
    allowSlugRename: input.regimenId !== undefined && input.slug !== undefined,
    title: input.title,
    kind: 'supplement',
    status: input.status,
    startedOn: input.startedOn,
    stoppedOn: input.stoppedOn,
    substance: input.substance,
    dose: input.dose,
    unit: input.doseUnit,
    schedule: input.schedule,
    brand: input.brand,
    manufacturer: input.manufacturer,
    servingSize: input.servingSize,
    ingredients: buildSupplementIngredient(input),
    relatedGoalIds: normalizeRepeatableFlagOption(input.relatedGoalId, 'related-goal-id'),
    relatedConditionIds: normalizeRepeatableFlagOption(
      input.relatedConditionId,
      'related-condition-id',
    ),
    relatedRegimenIds: normalizeRepeatableFlagOption(
      input.relatedRegimenId,
      'related-regimen-id',
    ),
    group: input.group ?? 'supplement',
  }
}

function toSupplementUpsertResult(
  vault: string,
  result: Awaited<ReturnType<typeof upsertRegimen>>,
) {
  const regimenId = String(result.record.entity.regimenId)

  return {
    vault,
    regimenId,
    lookupId: regimenId,
    path: result.record.document.relativePath,
    created: Boolean(result.created),
  }
}

export function registerSupplementCommands(
  cli: Cli.Cli,
  services: VaultServices,
) {
  const supplement = createRegistryDocEntityGroup({
    commandName: 'supplement',
    description: 'Supplement product commands plus a derived active-compound ledger.',
    scaffold: {
      name: 'scaffold',
      args: z.object({}),
      description: 'Emit a payload template for one supplement product.',
      examples: [
        {
          description: 'Print a template supplement payload.',
          options: {
            vault: './vault',
          },
        },
      ],
      hint: 'The supplement payload supports product metadata plus an ingredients array for compound rollups.',
      output: createHealthScaffoldResultSchema('supplement'),
      async run({ options, requestId }) {
        return services.core.scaffoldSupplement({
          vault: options.vault,
          requestId,
        })
      },
    },
    importJson: {
      description: 'Upsert one supplement from a JSON payload file or stdin.',
      examples: [
        {
          description: 'Upsert one supplement product from a JSON payload file.',
          options: {
            input: '@supplement.json',
            vault: './vault',
          },
        },
      ],
      hint: '--input accepts @file.json or - so the CLI can load a supplement payload with product metadata and ingredients.',
      output: supplementUpsertResultSchema,
      async run(input) {
        return services.core.upsertSupplement(input)
      },
    },
    show: {
      argName: 'id',
      argSchema: z.string().min(1),
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
      output: healthShowResultSchema,
      async run(input) {
        return services.query.showSupplement(input)
      },
    },
    list: {
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
      output: healthListResultSchema,
      statusOption: statusOptionSchema,
      async run(input) {
        return services.query.listSupplements({
          ...input,
          limit: input.limit ?? 50,
        })
      },
    },
  })

  supplement.command('import-json', {
    args: z.object({}),
    description: 'Import one supplement from an explicit JSON payload file or stdin.',
    examples: [
      {
        description: 'Import one supplement product from a JSON payload file.',
        options: {
          input: '@supplement.json',
          vault: './vault',
        },
      },
    ],
    hint: '--input accepts @file.json or - so the CLI can load a supplement payload with product metadata and ingredients.',
    options: withBaseOptions({
      input: inputFileOptionSchema,
    }),
    output: supplementUpsertResultSchema,
    async run(context) {
      const result = await services.core.upsertSupplement({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        input: normalizeInputFileOption(context.options.input),
      })

      return context.ok(result, {
        cta: suggestedCommandsCta([
          {
            command: 'supplement show',
            args: {
              id: result.regimenId,
            },
            description: 'Show the imported supplement record.',
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
    hint: 'Use the canonical supplement id so the stop event is attached to the existing supplement record.',
    options: withBaseOptions({
      stoppedOn: localDateSchema
        .optional()
        .describe('Optional calendar day when the supplement stopped. Defaults to today.'),
    }),
    output: stopResultSchema,
    async run(context) {
      const result = await services.core.stopSupplement({
        regimenId: context.args.id,
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
    hint: 'Use supplement import-json only when importing an advanced JSON payload from @file.json or stdin.',
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
      const result = await upsertRegimen(
        buildSupplementSaveInput({
          regimenId: context.options.id,
          title: context.args.title,
          slug: context.options.slug,
          status: context.options.status,
          startedOn: context.options.startedOn,
          stoppedOn: context.options.stoppedOn,
          schedule: context.options.schedule,
          group: context.options.group,
          substance: context.options.substance,
          dose: context.options.dose,
          doseUnit: context.options.doseUnit,
          brand: context.options.brand,
          manufacturer: context.options.manufacturer,
          servingSize: context.options.servingSize,
          compound: context.options.compound,
          ingredientActive: context.options.ingredientActive,
          ingredientLabel: context.options.ingredientLabel,
          amount: context.options.amount,
          unit: context.options.unit,
          note: context.options.note,
          relatedGoalId: context.options.relatedGoalId,
          relatedConditionId: context.options.relatedConditionId,
          relatedRegimenId: context.options.relatedRegimenId,
          vault: context.options.vault,
        }),
      )
      const saved = toSupplementUpsertResult(context.options.vault, result)

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

  supplement.command('rename', {
    args: z.object({
      lookup: z.string().min(1).describe('Supplement id or slug to rename.'),
    }),
    description: 'Rename one supplement product while preserving its canonical id.',
    examples: [
      {
        args: {
          lookup: '<supplement-id>',
        },
        description: 'Rename a supplement and let the slug move with the new title.',
        options: {
          title: 'Morning Protein Drink',
          vault: './vault',
        },
      },
    ],
    hint: 'Use the canonical supplement id or current slug; the CLI reuses the existing supplement record instead of creating a new one.',
    options: withBaseOptions({
      title: z.string().min(1).max(160).describe('New supplement title.'),
      slug: supplementSlugSchema
        .optional()
        .describe('Optional stable slug override for the renamed supplement record.'),
    }),
    output: supplementUpsertResultSchema,
    async run(context) {
      return services.core.renameSupplement({
        lookup: context.args.lookup,
        title: context.options.title,
        slug: context.options.slug,
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
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
