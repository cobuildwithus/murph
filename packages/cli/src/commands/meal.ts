import { Cli, z } from 'incur'
import {
  type EventSource,
  type MealNutrition,
  eventSourceSchema,
  mealNutritionSchema,
} from '@murphai/contracts'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
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
} from '@murphai/vault-usecases'
import {
  deleteMealRecord,
  editMealRecord,
  listMealRecords,
  mealLookupSchema,
  rawImportManifestResultSchema,
  showMealManifest,
  showMealRecord,
} from '@murphai/vault-usecases/records'
import type { VaultServices } from '@murphai/vault-usecases'
import { loadImportersRuntimeModule } from '@murphai/vault-usecases/runtime'
import { registerArtifactBackedEntityGroup } from './entity-command-groups.js'
import {
  createEntityDeleteCommandConfig,
  createEventBackedEntityEditCommandConfig,
} from './record-mutation-command-helpers.js'
import { normalizeOccurredAtOption } from './occurred-at-option.js'

const mealIngredientsSchema = z
  .array(z.string().trim().min(1).max(4000))
  .max(100)
  .optional()

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
      Object.keys(nutrition.provenance ?? {}).length > 0,
  )
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
    'Meal capture requires --photo, --audio, --note, or a structured --input payload with ingredients and/or nutrition.',
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

export function registerMealCommands(cli: Cli.Cli, services: VaultServices) {
  registerArtifactBackedEntityGroup(cli, {
    commandName: 'meal',
    description: 'Meal capture commands routed through the core write API.',
    primaryAction: {
      name: 'add',
      description:
        'Record one meal from simple media/text flags or a structured JSON payload.',
      examples: [
        {
          description: 'Capture a simple meal note with one optional photo.',
          args: {},
          options: {
            note: 'Eggs, toast, and coffee.',
            photo: './breakfast.jpg',
            vault: './vault',
          },
        },
        {
          description: 'Store a structured meal payload from disk.',
          args: {},
          options: {
            input: '@meal.json',
            vault: './vault',
          },
        },
      ],
      hint:
        'Keep using --photo, --audio, and --note for lightweight logs, or pass --input @meal.json when you need source, ingredients, and nutrition in one payload. Explicit flags override payload fields.',
      args: z.object({}),
      options: {
        input: inputFileOptionSchema
          .optional()
          .describe('Optional structured meal payload in @file.json form or - for stdin.'),
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
      },
      output: mealAddResultSchema,
      async run({ options }) {
        const payload =
          typeof options.input === 'string'
            ? await loadStructuredMealPayload(options.input)
            : undefined
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
        const ingredients = payload?.ingredients
        const nutrition = payload?.nutrition

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
      output: listResultSchema,
      async run(input) {
        return listMealRecords({
          vault: input.vault,
          from: input.from,
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
      createEventBackedEntityEditCommandConfig({
        arg: {
          name: 'id',
          schema: mealLookupSchema,
        },
        description:
          'Edit one meal by merging a partial JSON patch or one or more path assignments into the saved event.',
        run(input) {
          return editMealRecord({
            vault: input.vault,
            lookup: input.lookup,
            inputFile: input.inputFile,
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
