import { RECIPE_STATUSES } from '@murphai/contracts'
import { upsertRecipe } from '@murphai/core'
import { Cli, z } from 'incur'

import { withBaseOptions } from '@murphai/operator-config/command-helpers'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  listItemSchema,
  pathSchema,
  showResultSchema,
} from '@murphai/operator-config/vault-cli-contracts'
import {
  normalizeRepeatableFlagOption,
  type VaultServices,
} from '@murphai/vault-usecases'
import {
  deleteRecipeRecord,
  editRecipeRecord,
} from '@murphai/vault-usecases/records'
import { suggestedCommandsCta } from './command-factory-primitives.js'
import { createRegistryDocEntityGroup } from './entity-command-groups.js'
import {
  createEntityDeleteCommandConfig,
  createEntityEditCommandConfig,
} from './record-mutation-command-helpers.js'

const recipeIdSchema = z
  .string()
  .regex(/^rcp_[0-9A-Za-z]+$/u, 'Expected a recipe id such as rcp_01JNV422Y2M5ZBV64ZP4N1DRB1.')
const recipeSlugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')
const recipeStatusSchema = z.enum(RECIPE_STATUSES)
const goalIdSchema = z
  .string()
  .regex(/^goal_[0-9A-Za-z]+$/u, 'Expected a goal id such as goal_01JNV422Y2M5ZBV64ZP4N1DRB1.')
const conditionIdSchema = z
  .string()
  .regex(/^cond_[0-9A-Za-z]+$/u, 'Expected a condition id such as cond_01JNV422Y2M5ZBV64ZP4N1DRB1.')

type RecipeUpsertInput = Parameters<typeof upsertRecipe>[0]
type RecipeLink = NonNullable<RecipeUpsertInput['links']>[number]

const recipeScaffoldResultSchema = z.object({
  vault: pathSchema,
  noun: z.literal('recipe'),
  payload: z.record(z.string(), z.unknown()),
})

const recipeUpsertResultSchema = z.object({
  vault: pathSchema,
  recipeId: z.string().min(1),
  lookupId: z.string().min(1),
  path: pathSchema,
  created: z.boolean(),
})

const recipeListResultSchema = z.object({
  vault: pathSchema,
  filters: z.object({
    status: z.string().nullable(),
    limit: z.number().int().positive().max(200),
  }),
  items: z.array(listItemSchema),
  count: z.number().int().nonnegative(),
  nextCursor: z.string().min(1).nullable(),
})

function repeatedRecipeOptionSchema(description: string) {
  return z.array(z.string().min(1)).optional().describe(description)
}

function parseRecipeLinkOption(entry: string): RecipeLink {
  const [type, targetId, extra] = entry.split(':')

  if (extra !== undefined || !type || !targetId) {
    throw new VaultCliError(
      'invalid_option',
      '--link values must use type:targetId, such as supports_goal:goal_...',
    )
  }

  if (type === 'supports_goal') {
    const parsed = goalIdSchema.safeParse(targetId)
    if (!parsed.success) {
      throw new VaultCliError(
        'invalid_option',
        '--link supports_goal requires a goal_ target id.',
      )
    }

    return {
      type,
      targetId: parsed.data,
    }
  }

  if (type === 'addresses_condition') {
    const parsed = conditionIdSchema.safeParse(targetId)
    if (!parsed.success) {
      throw new VaultCliError(
        'invalid_option',
        '--link addresses_condition requires a cond_ target id.',
      )
    }

    return {
      type,
      targetId: parsed.data,
    }
  }

  throw new VaultCliError(
    'invalid_option',
    '--link type must be supports_goal or addresses_condition.',
  )
}

function normalizeRecipeLinksOption(value: string[] | undefined): RecipeLink[] | undefined {
  const entries = normalizeRepeatableFlagOption(value, 'link')

  return entries?.map(parseRecipeLinkOption)
}

function buildRecipeSaveInput(input: {
  cookTimeMinutes?: number
  cuisine?: string
  dishType?: string
  ingredient?: string[]
  link?: string[]
  prepTimeMinutes?: number
  recipeId?: string
  relatedConditionId?: string[]
  relatedGoalId?: string[]
  servings?: number
  slug?: string
  source?: string
  status?: z.infer<typeof recipeStatusSchema>
  step?: string[]
  summary?: string
  tag?: string[]
  title: string
  totalTimeMinutes?: number
  vault: string
}): RecipeUpsertInput {
  return {
    vaultRoot: input.vault,
    recipeId: input.recipeId,
    allowSlugRename: input.recipeId !== undefined && input.slug !== undefined,
    slug: input.slug,
    title: input.title,
    status: input.status,
    summary: input.summary,
    cuisine: input.cuisine,
    dishType: input.dishType,
    source: input.source,
    servings: input.servings,
    prepTimeMinutes: input.prepTimeMinutes,
    cookTimeMinutes: input.cookTimeMinutes,
    totalTimeMinutes: input.totalTimeMinutes,
    tags: normalizeRepeatableFlagOption(input.tag, 'tag'),
    ingredients: normalizeRepeatableFlagOption(input.ingredient, 'ingredient'),
    steps: normalizeRepeatableFlagOption(input.step, 'step'),
    relatedGoalIds: normalizeRepeatableFlagOption(
      input.relatedGoalId,
      'related-goal-id',
    ),
    relatedConditionIds: normalizeRepeatableFlagOption(
      input.relatedConditionId,
      'related-condition-id',
    ),
    links: normalizeRecipeLinksOption(input.link),
  }
}

function toRecipeUpsertResult(
  vault: string,
  result: Awaited<ReturnType<typeof upsertRecipe>>,
) {
  return {
    vault,
    recipeId: result.record.recipeId,
    lookupId: result.record.recipeId,
    path: result.record.relativePath,
    created: result.created,
  }
}

export function registerRecipeCommands(cli: Cli.Cli, services: VaultServices) {
  const recipe = createRegistryDocEntityGroup({
    commandName: 'recipe',
    description: 'Recipe registry commands for bank/recipes Markdown records.',
    scaffold: {
      name: 'scaffold',
      args: z.object({}),
      description: 'Emit a recipe payload template for `recipe import-json`.',
      output: recipeScaffoldResultSchema,
      async run({ options, requestId }) {
        return services.core.scaffoldRecipe({
          vault: String(options.vault ?? ''),
          requestId,
        })
      },
    },
    importJson: {
      description: 'Import or bulk update one recipe from an explicit JSON payload file or stdin.',
      hint: 'Use recipe save for the canonical typed command path. Keep --input for advanced JSON import, bulk, or migration flows.',
      output: recipeUpsertResultSchema,
      async run(input) {
        return services.core.upsertRecipe({
          vault: input.vault,
          requestId: input.requestId,
          inputFile: input.input,
        })
      },
    },
    show: {
      description: 'Show one recipe by canonical id or slug.',
      argName: 'id',
      argSchema: z.string().min(1).describe('Recipe id or slug to show.'),
      output: showResultSchema,
      async run(input) {
        return services.query.showRecipe({
          lookup: input.id,
          vault: input.vault,
          requestId: input.requestId,
        })
      },
    },
    list: {
      description: 'List recipe records with an optional status filter.',
      output: recipeListResultSchema,
      statusOption: recipeStatusSchema.optional(),
      async run(input) {
        return services.query.listRecipes({
          vault: input.vault,
          requestId: input.requestId,
          status: input.status,
          limit: input.limit ?? 50,
        })
      },
    },
    additionalCommands: [
      createEntityEditCommandConfig({
        arg: {
          name: 'id',
          schema: z.string().min(1).describe('Recipe id or slug to edit.'),
        },
        description:
          'Edit one recipe by merging a partial JSON patch or one or more path assignments into the saved record.',
        run(input) {
          return editRecipeRecord({
            vault: input.vault,
            lookup: input.lookup,
            inputFile: input.inputFile,
            set: input.set,
            clear: input.clear,
          })
        },
      }),
      createEntityDeleteCommandConfig({
        arg: {
          name: 'id',
          schema: z.string().min(1).describe('Recipe id or slug to delete.'),
        },
        description: 'Delete one recipe Markdown record.',
        run(input) {
          return deleteRecipeRecord({
            vault: input.vault,
            lookup: input.lookup,
          })
        },
      }),
    ],
  })

  recipe.command('save', {
    args: z.object({
      title: z.string().min(1).max(160).describe('Recipe title or name.'),
    }),
    description: 'Create or update one recipe from typed command fields.',
    examples: [
      {
        args: {
          title: 'Sheet Pan Salmon Bowls',
        },
        description: 'Save a recipe without a JSON payload file.',
        options: {
          ingredient: ['2 salmon fillets'],
          step: ['Roast until cooked through.'],
          tag: ['weeknight'],
          vault: './vault',
        },
      },
    ],
    hint: 'Use recipe import-json only when importing an advanced JSON payload from @file.json or stdin.',
    options: withBaseOptions({
      id: recipeIdSchema
        .optional()
        .describe('Optional existing recipe id to update.'),
      slug: recipeSlugSchema
        .optional()
        .describe('Optional stable lowercase kebab-case slug.'),
      status: recipeStatusSchema
        .optional()
        .describe('Optional recipe status.'),
      summary: z
        .string()
        .min(1)
        .max(4000)
        .optional()
        .describe('Optional recipe summary.'),
      cuisine: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional cuisine label.'),
      dishType: z
        .string()
        .min(1)
        .max(160)
        .optional()
        .describe('Optional dish type, such as dinner or snack.'),
      source: z
        .string()
        .min(1)
        .max(240)
        .optional()
        .describe('Optional source label or citation.'),
      servings: z
        .number()
        .nonnegative()
        .optional()
        .describe('Optional serving count.'),
      prepTimeMinutes: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Optional prep time in minutes.'),
      cookTimeMinutes: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Optional cook time in minutes.'),
      totalTimeMinutes: z
        .number()
        .int()
        .nonnegative()
        .optional()
        .describe('Optional total time in minutes.'),
      tag: repeatedRecipeOptionSchema(
        'Optional recipe tag. Repeat --tag for multiple values.',
      ),
      ingredient: repeatedRecipeOptionSchema(
        'Optional ingredient line. Repeat --ingredient for multiple values.',
      ),
      step: repeatedRecipeOptionSchema(
        'Optional preparation step. Repeat --step for multiple values.',
      ),
      relatedGoalId: z.array(goalIdSchema).optional().describe(
        'Optional related goal id. Repeat --related-goal-id for multiple values.',
      ),
      relatedConditionId: z.array(conditionIdSchema).optional().describe(
        'Optional related condition id. Repeat --related-condition-id for multiple values.',
      ),
      link: repeatedRecipeOptionSchema(
        'Optional relation link in type:targetId form. Repeat --link for multiple values. Supported types: supports_goal, addresses_condition.',
      ),
    }),
    output: recipeUpsertResultSchema,
    async run(context) {
      const result = await upsertRecipe(
        buildRecipeSaveInput({
          recipeId: context.options.id,
          slug: context.options.slug,
          title: context.args.title,
          status: context.options.status,
          summary: context.options.summary,
          cuisine: context.options.cuisine,
          dishType: context.options.dishType,
          source: context.options.source,
          servings: context.options.servings,
          prepTimeMinutes: context.options.prepTimeMinutes,
          cookTimeMinutes: context.options.cookTimeMinutes,
          totalTimeMinutes: context.options.totalTimeMinutes,
          tag: context.options.tag,
          ingredient: context.options.ingredient,
          step: context.options.step,
          relatedGoalId: context.options.relatedGoalId,
          relatedConditionId: context.options.relatedConditionId,
          link: context.options.link,
          vault: context.options.vault,
        }),
      )
      const saved = toRecipeUpsertResult(context.options.vault, result)

      return context.ok(saved, {
        cta: suggestedCommandsCta([
          {
            command: 'recipe show',
            args: {
              id: saved.recipeId,
            },
            description: 'Show the saved recipe record.',
            options: {
              vault: true,
            },
          },
          {
            command: 'recipe list',
            description: 'List recipes.',
            options: {
              vault: true,
            },
          },
        ]),
      })
    },
  })

  cli.command(recipe)
}
