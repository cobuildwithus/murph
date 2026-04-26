import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'

import {
  FOOD_STATUSES,
  NUTRITION_CONFIDENCE_LEVELS,
  NUTRITION_PROVENANCE_SOURCES,
  foodUpsertPayloadSchema,
  type FoodUpsertPayload,
} from '@murphai/contracts'
import { Cli, z } from 'incur'

import { requestIdFromOptions, withBaseOptions } from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  isoTimestampSchema,
  listItemSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  normalizeRepeatableFlagOption,
  type VaultServices,
} from '@murphai/vault-usecases'
import { dailyFoodTimeSchema } from '@murphai/vault-usecases/records'
import { createRegistryDocEntityGroup } from './entity-command-groups.js'
import {
  createDirectEntityDeleteCommandDefinition,
  createDirectEntityEditCommandDefinition,
} from './record-mutation-command-helpers.js'

const foodStatusSchema = z.enum(FOOD_STATUSES)
const nutritionProvenanceSourceSchema = z.enum(NUTRITION_PROVENANCE_SOURCES)
const nutritionConfidenceLevelSchema = z.enum(NUTRITION_CONFIDENCE_LEVELS)
const foodSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')
const foodIdSchema = z
  .string()
  .regex(/^food_[A-Za-z0-9_-]+$/u, 'Expected a food_* id.')
const regimenIdSchema = z
  .string()
  .regex(/^reg_[A-Za-z0-9_-]+$/u, 'Expected a reg_* id.')

const foodScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('food'),
  payload: z.record(z.string(), z.unknown()),
})

const foodUpsertResultSchema = z.object({
  vault: pathSchema,
  foodId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
})

const foodScheduleResultSchema = z.object({
  vault: pathSchema,
  foodId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
  time: dailyFoodTimeSchema,
  jobId: z.string().min(1),
  jobName: z.string().min(1),
  nextRunAt: isoTimestampSchema.nullable(),
})

const foodListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: foodStatusSchema.nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

function repeatedTextOptionSchema(description: string, max = 160) {
  return z.array(z.string().min(1).max(max)).optional().describe(description)
}

function nonnegativeNumberOptionSchema(description: string) {
  return z.number().nonnegative().optional().describe(description)
}

export interface FoodSavePayloadInput {
  alias?: string[]
  attachedRegimenId?: string[]
  autoLogDailyTime?: string
  brand?: string
  calories?: number
  carbsGrams?: number
  fatGrams?: number
  fiberGrams?: number
  foodId?: string
  ingredient?: string[]
  kind?: string
  linkRelatedRegimenId?: string[]
  location?: string
  note?: string
  nutritionConfidence?: z.infer<typeof nutritionConfidenceLevelSchema>
  nutritionSource?: z.infer<typeof nutritionProvenanceSourceSchema>
  nutritionSourceDetail?: string
  proteinGrams?: number
  serving?: string
  slug?: string
  status?: z.infer<typeof foodStatusSchema>
  summary?: string
  tag?: string[]
  title: string
  vendor?: string
}

interface FoodSaveCommandOptions {
  alias?: string[]
  attachedRegimenId?: string[]
  autoLogDailyTime?: string
  brand?: string
  calories?: number
  carbsGrams?: number
  fatGrams?: number
  fiberGrams?: number
  id?: string
  ingredient?: string[]
  kind?: string
  linkRelatedRegimenId?: string[]
  location?: string
  note?: string
  nutritionConfidence?: z.infer<typeof nutritionConfidenceLevelSchema>
  nutritionSource?: z.infer<typeof nutritionProvenanceSourceSchema>
  nutritionSourceDetail?: string
  proteinGrams?: number
  requestId?: string
  serving?: string
  slug?: string
  status?: z.infer<typeof foodStatusSchema>
  summary?: string
  tag?: string[]
  vault: string
  vendor?: string
}

function buildFoodNutrition(input: FoodSavePayloadInput): FoodUpsertPayload['nutrition'] {
  const perServing = {
    calories: input.calories,
    proteinGrams: input.proteinGrams,
    carbsGrams: input.carbsGrams,
    fatGrams: input.fatGrams,
    fiberGrams: input.fiberGrams,
  }
  const hasPerServing = Object.values(perServing).some((value) => value !== undefined)
  const hasProvenance =
    input.nutritionSource !== undefined ||
    input.nutritionConfidence !== undefined ||
    input.nutritionSourceDetail !== undefined

  if (!hasPerServing && !hasProvenance) {
    return undefined
  }

  if (input.nutritionSource === undefined && hasProvenance) {
    throw new VaultCliError(
      'invalid_option',
      '--nutrition-source is required when nutrition provenance options are provided.',
    )
  }

  return {
    ...(hasPerServing ? { perServing } : {}),
    ...(input.nutritionSource
      ? {
        provenance: {
          source: input.nutritionSource,
          confidence: input.nutritionConfidence,
          sourceDetail: input.nutritionSourceDetail,
        },
      }
      : {}),
  }
}

export function buildFoodSavePayload(input: FoodSavePayloadInput): FoodUpsertPayload {
  const attachedRegimenIds = normalizeRepeatableFlagOption(
    input.attachedRegimenId,
    'attached-regimen-id',
  )
  const linkRelatedRegimenIds = normalizeRepeatableFlagOption(
    input.linkRelatedRegimenId,
    'link-related-regimen-id',
  )
  const relationRegimenIds = [
    ...new Set([
      ...(attachedRegimenIds ?? []),
      ...(linkRelatedRegimenIds ?? []),
    ]),
  ]
  const payload: FoodUpsertPayload = {
    title: input.title,
    status: input.status ?? 'active',
  }
  const nutrition = buildFoodNutrition(input)

  if (input.foodId !== undefined) payload.foodId = input.foodId
  if (input.slug !== undefined) payload.slug = input.slug
  if (input.summary !== undefined) payload.summary = input.summary
  if (input.kind !== undefined) payload.kind = input.kind
  if (input.brand !== undefined) payload.brand = input.brand
  if (input.vendor !== undefined) payload.vendor = input.vendor
  if (input.location !== undefined) payload.location = input.location
  if (input.serving !== undefined) payload.serving = input.serving
  if (nutrition !== undefined) payload.nutrition = nutrition
  if (input.note !== undefined) payload.note = input.note
  if (input.autoLogDailyTime !== undefined) {
    payload.autoLogDaily = {
      time: input.autoLogDailyTime,
    }
  }
  const aliases = normalizeRepeatableFlagOption(input.alias, 'alias')
  if (aliases !== undefined) payload.aliases = aliases
  const ingredients = normalizeRepeatableFlagOption(input.ingredient, 'ingredient')
  if (ingredients !== undefined) payload.ingredients = ingredients
  const tags = normalizeRepeatableFlagOption(input.tag, 'tag')
  if (tags !== undefined) payload.tags = tags
  if (relationRegimenIds.length > 0) payload.attachedRegimenIds = relationRegimenIds
  if (linkRelatedRegimenIds !== undefined) {
    payload.links = linkRelatedRegimenIds.map((targetId) => ({
      type: 'related_regimen',
      targetId,
    }))
  }

  const parsed = foodUpsertPayloadSchema.safeParse(payload)
  if (!parsed.success) {
    throw new VaultCliError('contract_invalid', 'Food save options are invalid.', {
      errors: parsed.error.flatten(),
    })
  }

  return parsed.data
}

async function writeFoodSavePayloadFile(payload: FoodUpsertPayload) {
  const directory = await mkdtemp(path.join(tmpdir(), 'murph-food-save-'))
  const payloadPath = path.join(directory, 'payload.json')
  await writeFile(payloadPath, `${JSON.stringify(payload)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })

  return {
    directory,
    inputFile: `@${payloadPath}`,
  }
}

function createFoodSaveCommandConfig(services: VaultServices) {
  return {
    args: z.object({
      title: z.string().min(1).max(160).describe('Food title or name.'),
    }),
    description: 'Create or update one food from typed command fields.',
    examples: [
      {
        args: {
          title: 'Regular Acai Bowl',
        },
        description: 'Save a remembered food without a JSON payload file.',
        options: {
          alias: ['usual acai bowl'],
          autoLogDailyTime: '08:00',
          calories: 540,
          serving: '1 bowl',
          vault: './vault',
        },
      },
    ],
    hint: 'Use food upsert only when importing an advanced JSON payload from @file.json or stdin.',
    options: withBaseOptions({
      id: foodIdSchema.optional().describe('Optional existing food id to update.'),
      slug: foodSlugSchema
        .optional()
        .describe('Optional stable lowercase kebab-case slug.'),
      status: foodStatusSchema.optional().describe('Optional food status.'),
      summary: z.string().min(1).max(4000).optional().describe('Optional short summary.'),
      kind: z.string().min(1).max(160).optional().describe('Optional food kind.'),
      brand: z.string().min(1).max(160).optional().describe('Optional product brand.'),
      vendor: z.string().min(1).max(160).optional().describe('Optional vendor or restaurant.'),
      location: z.string().min(1).max(160).optional().describe('Optional vendor location.'),
      serving: z.string().min(1).max(160).optional().describe('Optional serving label.'),
      calories: nonnegativeNumberOptionSchema('Optional calories per serving.'),
      proteinGrams: nonnegativeNumberOptionSchema('Optional protein grams per serving.'),
      carbsGrams: nonnegativeNumberOptionSchema('Optional carbohydrate grams per serving.'),
      fatGrams: nonnegativeNumberOptionSchema('Optional fat grams per serving.'),
      fiberGrams: nonnegativeNumberOptionSchema('Optional fiber grams per serving.'),
      nutritionSource: nutritionProvenanceSourceSchema
        .optional()
        .describe('Optional nutrition provenance source.'),
      nutritionConfidence: nutritionConfidenceLevelSchema
        .optional()
        .describe('Optional nutrition provenance confidence. Requires --nutrition-source.'),
      nutritionSourceDetail: z
        .string()
        .min(1)
        .max(240)
        .optional()
        .describe('Optional nutrition provenance detail. Requires --nutrition-source.'),
      alias: repeatedTextOptionSchema(
        'Optional alias. Repeat --alias for multiple values.',
      ),
      ingredient: repeatedTextOptionSchema(
        'Optional ingredient. Repeat --ingredient for multiple values.',
        4000,
      ),
      tag: repeatedTextOptionSchema(
        'Optional lowercase tag slug. Repeat --tag for multiple values.',
      ),
      note: z.string().min(1).max(4000).optional().describe('Optional food note.'),
      autoLogDailyTime: dailyFoodTimeSchema
        .optional()
        .describe('Optional daily local time in HH:MM form for recurring auto-log meal creation.'),
      attachedRegimenId: z
        .array(regimenIdSchema)
        .optional()
        .describe('Optional attached regimen id. Repeat --attached-regimen-id for multiple values.'),
      linkRelatedRegimenId: z
        .array(regimenIdSchema)
        .optional()
        .describe('Optional related regimen link target id. Repeat --link-related-regimen-id for multiple links.'),
    }),
    output: foodUpsertResultSchema,
    async run(context: {
      args: {
        title: string
      }
      options: FoodSaveCommandOptions
    }) {
      const payload = buildFoodSavePayload({
        alias: context.options.alias,
        attachedRegimenId: context.options.attachedRegimenId,
        autoLogDailyTime: context.options.autoLogDailyTime,
        brand: context.options.brand,
        calories: context.options.calories,
        carbsGrams: context.options.carbsGrams,
        fatGrams: context.options.fatGrams,
        fiberGrams: context.options.fiberGrams,
        foodId: context.options.id,
        ingredient: context.options.ingredient,
        kind: context.options.kind,
        linkRelatedRegimenId: context.options.linkRelatedRegimenId,
        location: context.options.location,
        note: context.options.note,
        nutritionConfidence: context.options.nutritionConfidence,
        nutritionSource: context.options.nutritionSource,
        nutritionSourceDetail: context.options.nutritionSourceDetail,
        proteinGrams: context.options.proteinGrams,
        serving: context.options.serving,
        slug: context.options.slug,
        status: context.options.status,
        summary: context.options.summary,
        tag: context.options.tag,
        title: context.args.title,
        vendor: context.options.vendor,
      })
      const { directory, inputFile } = await writeFoodSavePayloadFile(payload)

      try {
        return await services.core.upsertFood({
          vault: context.options.vault,
          requestId: requestIdFromOptions(context.options),
          inputFile,
        })
      } finally {
        await rm(directory, {
          force: true,
          recursive: true,
        })
      }
    },
  }
}

function createFoodRenameCommandConfig(services: VaultServices) {
  return {
    args: z.object({
      lookup: z.string().min(1).describe('Food id or slug to rename.'),
    }),
    description: 'Rename one remembered food while preserving its canonical id.',
    hint: 'The previous food title is kept as an alias automatically so older operator language still resolves in the saved record.',
    options: withBaseOptions({
      title: z.string().min(1).max(160).describe('New remembered food title.'),
      slug: foodSlugSchema
        .optional()
        .describe('Optional stable slug override for the renamed food record.'),
    }),
    output: foodUpsertResultSchema,
    async run(context: {
      args: {
        lookup: string
      }
      options: {
        vault: string
        requestId?: string
        title: string
        slug?: string
      }
    }) {
      return services.core.renameFood({
        lookup: context.args.lookup,
        title: context.options.title,
        slug: context.options.slug,
        requestId: requestIdFromOptions(context.options),
        vault: context.options.vault,
      })
    },
  }
}

function createFoodScheduleCommandConfig(services: VaultServices) {
  return {
    args: z.object({
      title: z.string().min(1).max(160).describe('Remembered food title.'),
    }),
    description: 'Schedule one remembered food for daily auto-log meal creation.',
    hint: 'This schedules recurring meal logging for a remembered food. The daily log fires while `vault-cli assistant run` is active for the same vault.',
    options: withBaseOptions({
      time: dailyFoodTimeSchema.describe('Daily local time in 24-hour HH:MM form.'),
      note: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional remembered food note that will be used in the auto-logged meal entry.'),
      slug: foodSlugSchema
        .optional()
        .describe('Optional stable slug override for the remembered food record.'),
    }),
    output: foodScheduleResultSchema,
    async run(context: {
      args: {
        title: string
      }
      options: {
        vault: string
        requestId?: string
        time: string
        note?: string
        slug?: string
      }
    }) {
      return services.core.addDailyFood({
        title: context.args.title,
        time: context.options.time,
        note: context.options.note,
        slug: context.options.slug,
        requestId: requestIdFromOptions(context.options),
        vault: context.options.vault,
      })
    },
  }
}

function createFoodUnscheduleCommandConfig(services: VaultServices) {
  return {
    args: z.object({
      id: z.string().min(1).describe('Food id or slug to unschedule.'),
    }),
    description: 'Unschedule one remembered food from daily auto-log meal creation.',
    hint: 'This clears the recurring auto-log setting and removes the scheduled assistant job while keeping the food record.',
    options: withBaseOptions({}),
    output: showResultSchema,
    async run(context: {
      args: {
        id: string
      }
      options: {
        vault: string
        requestId?: string
      }
    }) {
      return services.core.editFood({
        vault: context.options.vault,
        requestId: requestIdFromOptions(context.options),
        lookup: context.args.id,
        clear: ['autoLogDaily'],
      })
    },
  }
}

export function registerFoodCommands(cli: Cli.Cli, services: VaultServices) {
  const food = createRegistryDocEntityGroup({
    commandName: 'food',
    description: 'Food registry commands for bank/foods Markdown records.',
    scaffold: {
      name: 'scaffold',
      args: z.object({}),
      description: 'Emit an advanced food JSON payload template for `food upsert`.',
      hint: 'Prefer `food save` for typed create/update. Use this scaffold for bulk import or advanced JSON fallback payloads.',
      output: foodScaffoldResultSchema,
      async run({ options, requestId }) {
        return services.core.scaffoldFood({
          vault: String(options.vault ?? ''),
          requestId,
        })
      },
    },
    upsert: {
      description: 'Import or bulk upsert one food Markdown record from a JSON payload file or stdin.',
      hint: 'Prefer `food save` for canonical typed create/update. Keep `food upsert --input` for bulk import and advanced JSON fallback payloads.',
      output: foodUpsertResultSchema,
      async run(input) {
        return services.core.upsertFood({
          vault: input.vault,
          requestId: input.requestId,
          inputFile: input.input,
        })
      },
    },
    show: {
      description: 'Show one food by canonical id or slug.',
      argName: 'id',
      argSchema: z.string().min(1).describe('Food id or slug to show.'),
      output: showResultSchema,
      async run(input) {
        return services.query.showFood({
          lookup: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    list: {
      description: 'List food records with an optional status filter.',
      output: foodListResultSchema,
      statusOption: foodStatusSchema.optional(),
      async run(input) {
        return services.query.listFoods({
          vault: input.vault,
          requestId: input.requestId,
          status: input.status,
          limit: input.limit ?? 50,
        })
      },
    },
  })

  food.command('save', createFoodSaveCommandConfig(services))
  food.command('rename', createFoodRenameCommandConfig(services))
  food.command('schedule', createFoodScheduleCommandConfig(services))
  food.command('unschedule', createFoodUnscheduleCommandConfig(services))

  food.command('edit', createDirectEntityEditCommandDefinition({
    arg: {
      name: 'id',
      schema: z.string().min(1).describe('Food id or slug to edit.'),
    },
    description:
      'Edit one food by merging a partial JSON patch or one or more path assignments into the saved record.',
    run(input) {
      return services.core.editFood({
        vault: input.vault,
        requestId: input.requestId,
        lookup: input.lookup,
        inputFile: input.inputFile,
        set: input.set,
        clear: input.clear,
      })
    },
  }))

  food.command('delete', createDirectEntityDeleteCommandDefinition({
    arg: {
      name: 'id',
      schema: z.string().min(1).describe('Food id or slug to delete.'),
    },
    description: 'Delete one remembered food Markdown record.',
    run(input) {
      return services.core.deleteFood({
        vault: input.vault,
        requestId: input.requestId,
        lookup: input.lookup,
      })
    },
  }))
  cli.command(food)
}
