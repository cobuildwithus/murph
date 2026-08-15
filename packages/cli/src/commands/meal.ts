import { Cli, z } from 'incur'
import {
  MEAL_MICRONUTRIENT_KEYS,
  NUTRITION_CONFIDENCE_LEVELS,
  NUTRITION_PROVENANCE_SOURCES,
  type EventSource,
  type MealNutrition,
  eventSourceSchema,
  mealNutritionSchema,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  isoTimestampSchema,
  localDateSchema,
  occurredAtOptionSchema,
  listResultSchema,
  mealAddResultSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  inputFileOptionSchema,
  loadJsonInputObject,
  normalizeRepeatableFlagOption,
} from '@murphai/vault-usecases'
import {
  deleteMealRecord,
  editMealRecord,
  listAutomaticMealPhotoCloseoutWorkRecords,
  listMealRecords,
  mealLookupSchema,
  rawImportManifestResultSchema,
  removeAutomaticMealPhotoRecord,
  showMealManifest,
  showMealRecord,
} from '@murphai/vault-usecases/records'
import type { VaultServices } from '@murphai/vault-usecases'
import { loadImportersRuntimeModule } from '@murphai/vault-usecases/runtime'
import { registerArtifactBackedEntityGroup } from './entity-command-groups.js'
import {
  appendTypedClear,
  appendTypedSet,
  createEntityDeleteCommandConfig,
  createEventBackedEntityEditCommandConfig,
  emptyToUndefined,
} from './record-mutation-command-helpers.js'
import { commonListLimitOptionSchema } from './command-factory-primitives.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'

const mealIngredientsSchema = z
  .array(z.string().trim().min(1).max(4000))
  .max(100)
  .optional()
const nutritionProvenanceSourceSchema = z.enum(NUTRITION_PROVENANCE_SOURCES)
const nutritionConfidenceLevelSchema = z.enum(NUTRITION_CONFIDENCE_LEVELS)

type MealNutritionProvenanceSource = z.infer<typeof nutritionProvenanceSourceSchema>
type MealNutritionConfidenceLevel = z.infer<typeof nutritionConfidenceLevelSchema>

interface MealAddTypedNutritionOptions {
  nutritionCalories?: number
  nutritionProteinGrams?: number
  nutritionCarbsGrams?: number
  nutritionFatGrams?: number
  nutritionFiberGrams?: number
  nutritionSource?: MealNutritionProvenanceSource
  nutritionConfidence?: MealNutritionConfidenceLevel
  nutritionSourceDetail?: string
}

const mealInputPayloadSchema = z
  .object({
    photo: pathSchema.optional(),
    photoPath: pathSchema.optional(),
    audio: pathSchema.optional(),
    audioPath: pathSchema.optional(),
    note: z.string().trim().min(1).optional(),
    occurredAt: occurredAtOptionSchema.optional(),
    source: eventSourceSchema.optional(),
    ingredients: mealIngredientsSchema,
    nutrition: mealNutritionSchema.optional(),
  })
  .passthrough()

type StructuredMealPayload = {
  photo?: string
  audio?: string
  note?: string
  occurredAt?: string
  source?: EventSource
  ingredients?: string[]
  nutrition?: MealNutrition
}

const mealInputPayloadShapeDescription = [
  'Structured payload object keys:',
  '`photo` or `photoPath` for an optional meal photo path;',
  '`audio` or `audioPath` for an optional audio note path;',
  '`note`, `occurredAt`, and `source` for the saved event fields;',
  '`ingredients` as a string array;',
  '`nutrition` as `{ totals?: { calories?, proteinGrams?, carbsGrams?, fatGrams?, fiberGrams?, waterGrams? }, micros?: { <supported bounded nutrient keys> }, provenance?: { source, confidence?, sourceDetail? } }`.',
].join(' ')

function formatSchemaIssues(
  issues: readonly { path: PropertyKey[]; message: string }[],
): string {
  return issues
    .map((issue) => {
      const path = issue.path.length > 0 ? issue.path.join('.') : 'value'
      return `${path}: ${issue.message}`
    })
    .join('; ')
}

function hasMeaningfulMealNutrition(nutrition: MealNutrition | undefined): boolean {
  if (!nutrition) {
    return false
  }

  return Boolean(
    Object.keys(nutrition.totals ?? {}).length > 0 ||
      Object.keys(nutrition.micros ?? {}).length > 0 ||
      Object.keys(nutrition.provenance ?? {}).length > 0,
  )
}

function stringArrayOption(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }

  if (!value.every((entry): entry is string => typeof entry === 'string')) {
    return undefined
  }

  return value
}

function numberOption(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined
}

function stringOption(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function nutritionSourceOption(
  value: unknown,
): MealNutritionProvenanceSource | undefined {
  return typeof value === 'string'
    ? nutritionProvenanceSourceSchema.parse(value)
    : undefined
}

function nutritionConfidenceOption(
  value: unknown,
): MealNutritionConfidenceLevel | undefined {
  return typeof value === 'string'
    ? nutritionConfidenceLevelSchema.parse(value)
    : undefined
}

function buildMealNutritionFromOptions(
  payloadNutrition: MealNutrition | undefined,
  options: MealAddTypedNutritionOptions,
): MealNutrition | undefined {
  const totals: NonNullable<MealNutrition['totals']> = {
    ...(payloadNutrition?.totals ?? {}),
  }
  if (options.nutritionCalories !== undefined) {
    totals.calories = options.nutritionCalories
  }
  if (options.nutritionProteinGrams !== undefined) {
    totals.proteinGrams = options.nutritionProteinGrams
  }
  if (options.nutritionCarbsGrams !== undefined) {
    totals.carbsGrams = options.nutritionCarbsGrams
  }
  if (options.nutritionFatGrams !== undefined) {
    totals.fatGrams = options.nutritionFatGrams
  }
  if (options.nutritionFiberGrams !== undefined) {
    totals.fiberGrams = options.nutritionFiberGrams
  }

  const provenanceSource =
    options.nutritionSource ?? payloadNutrition?.provenance?.source
  const provenanceConfidence =
    options.nutritionConfidence ?? payloadNutrition?.provenance?.confidence
  const provenanceSourceDetail =
    options.nutritionSourceDetail ?? payloadNutrition?.provenance?.sourceDetail
  const typedProvenanceProvided =
    options.nutritionSource !== undefined ||
    options.nutritionConfidence !== undefined ||
    options.nutritionSourceDetail !== undefined
  const hasTotals = Object.values(totals).some((value) => value !== undefined)
  const hasProvenance =
    provenanceSource !== undefined ||
    provenanceConfidence !== undefined ||
    provenanceSourceDetail !== undefined

  if (typedProvenanceProvided && provenanceSource === undefined) {
    throw new VaultCliError(
      'invalid_option',
      '--nutrition-source is required when nutrition provenance options are provided.',
    )
  }

  if (!hasTotals && !hasProvenance) {
    return payloadNutrition
  }

  const nutrition: MealNutrition = {
    ...(payloadNutrition?.micros
      ? { micros: payloadNutrition.micros }
      : {}),
  }
  if (hasTotals) {
    nutrition.totals = totals
  }
  if (hasProvenance && provenanceSource !== undefined) {
    nutrition.provenance = {
      source: provenanceSource,
      ...(provenanceConfidence !== undefined
        ? { confidence: provenanceConfidence }
        : {}),
      ...(provenanceSourceDetail !== undefined
        ? { sourceDetail: provenanceSourceDetail }
        : {}),
    }
  }

  return mealNutritionSchema.parse(nutrition)
}

async function loadStructuredMealPayload(inputFile: string): Promise<StructuredMealPayload> {
  const payload = await loadJsonInputObject(inputFile, 'meal payload')
  const parsed = mealInputPayloadSchema.safeParse(payload)

  if (!parsed.success) {
    throw new VaultCliError(
      'invalid_payload',
      `Meal payload is not valid. ${formatSchemaIssues(parsed.error.issues)}`,
    )
  }

  return {
    photo: parsed.data.photo ?? parsed.data.photoPath,
    audio: parsed.data.audio ?? parsed.data.audioPath,
    note: parsed.data.note,
    occurredAt: parsed.data.occurredAt,
    source: parsed.data.source,
    ingredients: parsed.data.ingredients,
    nutrition: parsed.data.nutrition,
  }
}

function assertMealAddHasContent(input: {
  photo?: string
  audio?: string
  note?: string
  ingredients?: string[]
  nutrition?: MealNutrition
}) {
  if (
    input.photo ||
    input.audio ||
    input.note ||
    (input.ingredients?.length ?? 0) > 0 ||
    hasMeaningfulMealNutrition(input.nutrition)
  ) {
    return
  }

  throw new VaultCliError(
    'invalid_option',
    'Meal capture requires --photo, --audio, --note, --ingredient, nutrition options, or meal import-json --input @meal.json with ingredients and/or nutrition.',
  )
}

const mealNutritionMetricSchema = z.object({
  total: z.number().nonnegative().nullable(),
  mealCount: z.number().int().nonnegative(),
})

const mealNutritionTotalsSchema = z.object({
  calories: mealNutritionMetricSchema,
  proteinGrams: mealNutritionMetricSchema,
  carbsGrams: mealNutritionMetricSchema,
  fatGrams: mealNutritionMetricSchema,
  fiberGrams: mealNutritionMetricSchema,
})

const mealNutritionDaySchema = z.object({
  date: localDateSchema,
  mealCount: z.number().int().nonnegative(),
  totals: mealNutritionTotalsSchema,
})

const mealNutritionTotalsResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
  }),
  mealCount: z.number().int().nonnegative(),
  totals: mealNutritionTotalsSchema,
  days: z.array(mealNutritionDaySchema),
})

const mealNutrientSchema = z.object({
  key: z.enum(['waterGrams', ...MEAL_MICRONUTRIENT_KEYS]),
  label: z.string().min(1),
  category: z.enum(['water', 'mineral', 'trace_element', 'vitamin']),
  unit: z.enum(['g', 'mg', 'mcg']),
  total: z.number().nonnegative().nullable(),
  contributingMealCount: z.number().int().nonnegative(),
})

const mealNutrientDaySchema = z.object({
  date: localDateSchema,
  mealCount: z.number().int().nonnegative(),
  nutrients: z.array(mealNutrientSchema),
})

const mealNutrientTotalsResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    from: localDateSchema.nullable(),
    to: localDateSchema.nullable(),
  }),
  mealCount: z.number().int().nonnegative(),
  nutrients: z.array(mealNutrientSchema),
  days: z.array(mealNutrientDaySchema),
})

const mealAddTypedOptionShape = {
  photo: pathSchema
    .optional()
    .describe('Optional meal photo path.'),
  audio: pathSchema
    .optional()
    .describe('Optional audio note path.'),
  note: z
    .string()
    .trim()
    .min(1)
    .optional()
    .describe('Optional freeform meal description when no media is available.'),
  occurredAt: occurredAtOptionSchema
    .optional()
    .describe('Optional occurrence timestamp in ISO 8601 form or YYYY-MM-DD form.'),
  source: eventSourceSchema
    .optional()
    .describe('Optional event source (`manual`, `import`, `device`, or `derived`).'),
  ingredient: mealIngredientsSchema
    .describe('Optional repeatable meal ingredient. Repeat --ingredient for each item; shell-quote values with spaces, for example --ingredient \'rolled oats\'. Do not comma-delimit multiple ingredients.'),
  nutritionCalories: z
    .number()
    .nonnegative()
    .optional()
    .describe('Optional meal calorie total.'),
  nutritionProteinGrams: z
    .number()
    .nonnegative()
    .optional()
    .describe('Optional meal protein grams.'),
  nutritionCarbsGrams: z
    .number()
    .nonnegative()
    .optional()
    .describe('Optional meal carbohydrate grams.'),
  nutritionFatGrams: z
    .number()
    .nonnegative()
    .optional()
    .describe('Optional meal fat grams.'),
  nutritionFiberGrams: z
    .number()
    .nonnegative()
    .optional()
    .describe('Optional meal fiber grams.'),
  nutritionSource: nutritionProvenanceSourceSchema
    .optional()
    .describe('Optional meal nutrition provenance source.'),
  nutritionConfidence: nutritionConfidenceLevelSchema
    .optional()
    .describe('Optional meal nutrition provenance confidence. Requires --nutrition-source.'),
  nutritionSourceDetail: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .optional()
    .describe('Optional meal nutrition provenance detail. Requires --nutrition-source.'),
}

async function runMealAdd(
  options: Record<string, unknown> & { vault: string },
  inputFile?: string,
) {
  const payload = inputFile ? await loadStructuredMealPayload(inputFile) : undefined
  const vaultRoot = String(options.vault ?? '')
  const photoPath =
    typeof options.photo === 'string' ? options.photo : payload?.photo
  const audioPath =
    typeof options.audio === 'string' ? options.audio : payload?.audio
  const note =
    typeof options.note === 'string' ? options.note : payload?.note
  const occurredAtInput =
    typeof options.occurredAt === 'string'
      ? options.occurredAt
      : payload?.occurredAt
  const source =
    typeof options.source === 'string'
      ? eventSourceSchema.parse(options.source)
      : payload?.source
  const typedIngredients = normalizeRepeatableFlagOption(
    stringArrayOption(options.ingredient),
    'ingredient',
  )
  const ingredients = typedIngredients ?? payload?.ingredients
  const nutrition = buildMealNutritionFromOptions(payload?.nutrition, {
    nutritionCalories: numberOption(options.nutritionCalories),
    nutritionProteinGrams: numberOption(options.nutritionProteinGrams),
    nutritionCarbsGrams: numberOption(options.nutritionCarbsGrams),
    nutritionFatGrams: numberOption(options.nutritionFatGrams),
    nutritionFiberGrams: numberOption(options.nutritionFiberGrams),
    nutritionSource: nutritionSourceOption(options.nutritionSource),
    nutritionConfidence: nutritionConfidenceOption(
      options.nutritionConfidence,
    ),
    nutritionSourceDetail: stringOption(options.nutritionSourceDetail),
  })

  assertMealAddHasContent({
    photo: photoPath,
    audio: audioPath,
    note,
    ingredients,
    nutrition,
  })

  const importers = (await loadImportersRuntimeModule()).createImporters()
  const mealInput = {
    vaultRoot,
    ...(photoPath ? { photoPath } : {}),
    ...(audioPath ? { audioPath } : {}),
    ...(note ? { note } : {}),
    ...(source ? { source } : {}),
    ...(ingredients ? { ingredients } : {}),
    ...(nutrition ? { nutrition } : {}),
    ...(occurredAtInput
      ? {
          occurredAt: await normalizeOccurredAtOption({
            vault: vaultRoot,
            occurredAt: occurredAtInput,
          }),
        }
      : {}),
  }
  const result = await importers.addMeal(mealInput)

  return {
    vault: vaultRoot,
    mealId: result.mealId,
    eventId: result.event.id,
    lookupId: result.mealId,
    occurredAt: result.event.occurredAt ?? null,
    photoPath: result.photo?.relativePath ?? null,
    audioPath: result.audio?.relativePath ?? null,
    manifestFile: result.manifestPath,
    note: result.event.note ?? note ?? null,
    source: result.event.source ?? null,
    ingredients: result.event.ingredients ?? null,
    nutrition: result.event.nutrition ?? null,
  }
}

export function registerMealCommands(cli: Cli.Cli, services: VaultServices) {
  registerArtifactBackedEntityGroup(cli, {
    commandName: 'meal',
    description: 'Meal capture commands routed through the core write API.',
    primaryAction: {
      name: 'add',
      description:
        'Record one meal from typed media, ingredient, nutrition, and text fields.',
      examples: [
        {
          description: 'Capture a simple meal note with one optional photo.',
          args: {},
          options: {
            note: "'Eggs, toast, and coffee.'",
            photo: './breakfast.jpg',
            vault: './vault',
          },
        },
        {
          description: 'Capture a meal with a typed ingredient and nutrition.',
          args: {},
          options: {
            ingredient: ["'rolled oats'"],
            nutritionCalories: 390,
            nutritionProteinGrams: 15,
            nutritionCarbsGrams: 56,
            nutritionFatGrams: 11,
            nutritionFiberGrams: 12,
            nutritionSource: 'estimated',
            vault: './vault',
          },
        },
      ],
      hint:
        'Keep using typed flags for ordinary single-meal logs. Use meal import-json --input @meal.json or meal import-json --input - when importing a structured payload; explicit flags override payload fields.',
      args: z.object({}),
      options: mealAddTypedOptionShape,
      output: mealAddResultSchema,
      async run({ options }) {
        return runMealAdd(options)
      },
    },
    show: {
      description: 'Show one meal by meal id.',
      argName: 'id',
      argSchema: mealLookupSchema,
      output: showResultSchema,
      async run(input) {
        return showMealRecord(input.vault, input.id)
      },
    },
    list: {
      description: 'List meal events with optional date bounds.',
      limitOption: commonListLimitOptionSchema,
      output: listResultSchema,
      async run(input) {
        return listMealRecords({
          vault: input.vault,
          from: input.from,
          limit: input.limit,
          to: input.to,
        })
      },
    },
    manifest: {
      description: 'Show the immutable raw import manifest for a meal.',
      argName: 'id',
      argSchema: mealLookupSchema,
      output: rawImportManifestResultSchema,
      async run(input) {
        return showMealManifest(input.vault, input.id)
      },
    },
    additionalCommands: [
      {
        name: 'closeout-work',
        args: z.object({}),
        description:
          'List same-occurrence retries, then the oldest automatic-capture meals that still retain photos.',
        hint:
          'Use this bounded oldest-first queue for automatic meal closeout; remove each returned photo with meal remove-photo after enrichment.',
        options: {
          limit: commonListLimitOptionSchema,
          occurrenceAt: isoTimestampSchema
            .describe('Scheduled occurrence instant used to include same-occurrence removal revisions.'),
          to: localDateSchema
            .optional()
            .describe('Optional inclusive latest capture date in YYYY-MM-DD form.'),
        },
        output: listResultSchema,
        async run({ options }) {
          return listAutomaticMealPhotoCloseoutWorkRecords({
            limit: typeof options.limit === 'number'
              ? options.limit
              : undefined,
            occurrenceAt: String(options.occurrenceAt),
            to: typeof options.to === 'string' ? options.to : undefined,
            vault: String(options.vault ?? ''),
          })
        },
      },
      {
        name: 'import-json',
        args: z.object({}),
        description:
          'Import one meal from a structured JSON payload file or stdin.',
        examples: [
          {
            description: 'Import a meal payload with nested nutrition provenance from disk.',
            args: {},
            options: {
              input: '@meal.json',
              vault: './vault',
            },
          },
        ],
        hint:
          `--input accepts @file.json or - for stdin. ${mealInputPayloadShapeDescription} Explicit flags remain available on this escape hatch to override payload fields during migration/import.`,
        options: {
          input: inputFileOptionSchema.describe(
            `Structured meal payload in @file.json form or - for stdin. ${mealInputPayloadShapeDescription}`,
          ),
          ...mealAddTypedOptionShape,
        },
        output: mealAddResultSchema,
        async run({ options }) {
          return runMealAdd(
            options,
            typeof options.input === 'string' ? options.input : undefined,
          )
        },
      },
      {
        name: 'totals',
        args: z.object({}),
        description:
          'Show calorie and macro totals from meal nutrition over an optional date range.',
        hint:
          'Use `meal totals --from YYYY-MM-DD --to YYYY-MM-DD` when you need practical calories/protein/carbs/fat/fiber totals without a broader reporting layer.',
        options: {
          from: localDateSchema
            .optional()
            .describe('Optional inclusive lower date bound in YYYY-MM-DD form.'),
          to: localDateSchema
            .optional()
            .describe('Optional inclusive upper date bound in YYYY-MM-DD form.'),
        },
        output: mealNutritionTotalsResultSchema,
        async run({ options, requestId }) {
          return services.query.showMealNutritionTotals({
            vault: String(options.vault ?? ''),
            requestId: typeof requestId === 'string' ? requestId : null,
            from: typeof options.from === 'string' ? options.from : undefined,
            to: typeof options.to === 'string' ? options.to : undefined,
          })
        },
      },
      {
        name: 'nutrients',
        args: z.object({}),
        description:
          'Show water, vitamin, and mineral totals from meal nutrition over an optional date range.',
        hint:
          'Use `meal nutrients --from YYYY-MM-DD --to YYYY-MM-DD` for connected or saved meal nutrients. A null total means unavailable, and contributingMealCount smaller than mealCount means the nutrient is present on only part of the meal set. This read does not include source-app daily targets, percentages, or deficiency conclusions.',
        options: {
          from: localDateSchema
            .optional()
            .describe('Optional inclusive lower date bound in YYYY-MM-DD form.'),
          to: localDateSchema
            .optional()
            .describe('Optional inclusive upper date bound in YYYY-MM-DD form.'),
        },
        output: mealNutrientTotalsResultSchema,
        async run({ options, requestId }) {
          return services.query.showMealNutrientTotals({
            vault: String(options.vault ?? ''),
            requestId: typeof requestId === 'string' ? requestId : null,
            from: typeof options.from === 'string' ? options.from : undefined,
            to: typeof options.to === 'string' ? options.to : undefined,
          })
        },
      },
      {
        name: 'remove-photo',
        args: z.object({
          id: mealLookupSchema.describe('Automatic-capture meal id (`meal_*`).'),
        }),
        description:
          'Remove retained image bytes from one automatic-capture meal while preserving the meal record and structured nutrition.',
        hint:
          'Use only after inspecting the automatic meal photo and saving any supported ingredients or nutrition. The operation is idempotent and rejects ordinary meal photos.',
        options: {},
        output: showResultSchema,
        async run({ args, options }) {
          return removeAutomaticMealPhotoRecord({
            vault: String(options.vault ?? ''),
            lookup: String(args.id ?? ''),
          })
        },
      },
      createEventBackedEntityEditCommandConfig({
        arg: {
          name: 'id',
          schema: mealLookupSchema,
        },
        description:
          'Edit one meal event from typed fields.',
        options: {
          ingredient: mealIngredientsSchema
            .describe('Replace saved ingredients. Repeat --ingredient for each item.'),
          nutritionCalories: z.number().nonnegative().optional().describe('Replace meal calorie total.'),
          nutritionProteinGrams: z.number().nonnegative().optional().describe('Replace meal protein grams.'),
          nutritionCarbsGrams: z.number().nonnegative().optional().describe('Replace meal carbohydrate grams.'),
          nutritionFatGrams: z.number().nonnegative().optional().describe('Replace meal fat grams.'),
          nutritionFiberGrams: z.number().nonnegative().optional().describe('Replace meal fiber grams.'),
          nutritionSource: nutritionProvenanceSourceSchema.optional().describe('Replace meal nutrition provenance source.'),
          nutritionConfidence: nutritionConfidenceLevelSchema.optional().describe('Replace meal nutrition provenance confidence.'),
          nutritionSourceDetail: z.string().trim().min(1).max(240).optional().describe('Replace meal nutrition provenance detail.'),
          clearIngredients: z.boolean().optional().describe('Clear saved ingredients.'),
          clearNutrition: z.boolean().optional().describe('Clear saved nutrition totals and provenance.'),
        },
        buildPatch(options) {
          const set: string[] = []
          const clear: string[] = []
          appendTypedSet(set, 'ingredients', stringArrayOption(options.ingredient))
          appendTypedSet(set, 'nutrition.totals.calories', numberOption(options.nutritionCalories))
          appendTypedSet(set, 'nutrition.totals.proteinGrams', numberOption(options.nutritionProteinGrams))
          appendTypedSet(set, 'nutrition.totals.carbsGrams', numberOption(options.nutritionCarbsGrams))
          appendTypedSet(set, 'nutrition.totals.fatGrams', numberOption(options.nutritionFatGrams))
          appendTypedSet(set, 'nutrition.totals.fiberGrams', numberOption(options.nutritionFiberGrams))
          appendTypedSet(set, 'nutrition.provenance.source', nutritionSourceOption(options.nutritionSource))
          appendTypedSet(set, 'nutrition.provenance.confidence', nutritionConfidenceOption(options.nutritionConfidence))
          appendTypedSet(set, 'nutrition.provenance.sourceDetail', stringOption(options.nutritionSourceDetail))
          appendTypedClear(clear, 'ingredients', options.clearIngredients === true)
          appendTypedClear(clear, 'nutrition', options.clearNutrition === true)
          return {
            set: emptyToUndefined(set),
            clear: emptyToUndefined(clear),
          }
        },
        run(input) {
          return editMealRecord({
            vault: input.vault,
            lookup: input.lookup,
            set: input.set,
            clear: input.clear,
            dayKeyPolicy: input.dayKeyPolicy,
          })
        },
      }),
      createEntityDeleteCommandConfig({
        arg: {
          name: 'id',
          schema: mealLookupSchema,
        },
        description:
          'Delete one meal event while retaining any immutable raw artifacts and manifest files.',
        run(input) {
          return deleteMealRecord({
            vault: input.vault,
            lookup: input.lookup,
          })
        },
      }),
    ],
  })
}
