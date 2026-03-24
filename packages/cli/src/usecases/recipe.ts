import { RECIPE_STATUSES } from '@healthybob/contracts'
import { z } from 'incur'

import { loadJsonInputObject } from '../json-input.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '../vault-cli-errors.js'
import { buildEntityLinks } from './shared.js'
import { toVaultCliError } from './vault-usecase-helpers.js'

interface RecipeReadModel {
  recipeId: string
  slug: string
  title: string
  status: string
  relativePath: string
  markdown: string
  [key: string]: unknown
}

const RECIPE_ID_PATTERN = /^rcp_[0-9A-Za-z]+$/u

interface RecipeCoreRuntime {
  upsertRecipe(input: {
    vaultRoot: string
    recipeId?: string
    slug?: string
    title?: string
    status?: string
    summary?: string
    cuisine?: string
    dishType?: string
    source?: string
    servings?: number
    prepTimeMinutes?: number
    cookTimeMinutes?: number
    totalTimeMinutes?: number
    tags?: string[]
    ingredients?: string[]
    steps?: string[]
    relatedGoalIds?: string[]
    relatedConditionIds?: string[]
  }): Promise<{
    created: boolean
    record: {
      recipeId: string
      relativePath: string
    }
  }>
  listRecipes(vaultRoot: string): Promise<RecipeReadModel[]>
  readRecipe(input: {
    vaultRoot: string
    recipeId?: string
    slug?: string
  }): Promise<RecipeReadModel>
}

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')

const recipePayloadSchema = z
  .object({
    recipeId: z
      .string()
      .regex(/^rcp_[0-9A-Za-z]+$/u)
      .optional(),
    slug: slugSchema.optional(),
    title: z.string().min(1).max(160),
    status: z.enum(RECIPE_STATUSES).default('saved'),
    summary: z.string().min(1).max(4000).optional(),
    cuisine: z.string().min(1).max(160).optional(),
    dishType: z.string().min(1).max(160).optional(),
    source: z.string().min(1).max(240).optional(),
    servings: z.number().min(0).optional(),
    prepTimeMinutes: z.number().int().min(0).optional(),
    cookTimeMinutes: z.number().int().min(0).optional(),
    totalTimeMinutes: z.number().int().min(0).optional(),
    tags: z.array(slugSchema).optional(),
    ingredients: z.array(z.string().min(1).max(4000)).optional(),
    steps: z.array(z.string().min(1).max(4000)).optional(),
    relatedGoalIds: z.array(z.string().regex(/^goal_[0-9A-Za-z]+$/u)).optional(),
    relatedConditionIds: z.array(z.string().regex(/^cond_[0-9A-Za-z]+$/u)).optional(),
  })
  .strict()

export type RecipePayload = z.infer<typeof recipePayloadSchema>

export function scaffoldRecipePayload() {
  return {
    title: 'Sheet Pan Salmon Bowls',
    slug: 'sheet-pan-salmon-bowls',
    status: 'saved',
    summary: 'A reliable high-protein salmon bowl with roasted vegetables and rice.',
    cuisine: 'mediterranean',
    dishType: 'dinner',
    source: 'Family weeknight rotation',
    servings: 2,
    prepTimeMinutes: 15,
    cookTimeMinutes: 20,
    totalTimeMinutes: 35,
    tags: ['high-protein', 'weeknight'],
    ingredients: [
      '2 salmon fillets',
      '2 cups cooked rice',
      '2 cups broccoli florets',
      '1 tbsp olive oil',
      '1 lemon',
    ],
    steps: [
      'Heat the oven to 220C and line a sheet pan.',
      'Toss the broccoli with olive oil and roast for 10 minutes.',
      'Add the salmon, season, and roast until cooked through.',
      'Serve over rice with lemon juice and any pan juices.',
    ],
  } satisfies RecipePayload
}

export function parseRecipePayload(value: unknown) {
  const result = recipePayloadSchema.safeParse(value)

  if (!result.success) {
    throw new VaultCliError('contract_invalid', 'Recipe payload is invalid.', {
      errors: result.error.flatten(),
    })
  }

  return result.data
}

async function loadJsonInputFile(input: string, label: string) {
  return loadJsonInputObject(input, label)
}

export async function upsertRecipeRecord(input: {
  vault: string
  payload: RecipePayload
}) {
  const core = await loadRecipeCoreRuntime()

  try {
    const result = await core.upsertRecipe({
      vaultRoot: input.vault,
      recipeId: input.payload.recipeId,
      slug: input.payload.slug,
      title: input.payload.title,
      status: input.payload.status,
      summary: input.payload.summary,
      cuisine: input.payload.cuisine,
      dishType: input.payload.dishType,
      source: input.payload.source,
      servings: input.payload.servings,
      prepTimeMinutes: input.payload.prepTimeMinutes,
      cookTimeMinutes: input.payload.cookTimeMinutes,
      totalTimeMinutes: input.payload.totalTimeMinutes,
      tags: input.payload.tags,
      ingredients: input.payload.ingredients,
      steps: input.payload.steps,
      relatedGoalIds: input.payload.relatedGoalIds,
      relatedConditionIds: input.payload.relatedConditionIds,
    })

    return {
      vault: input.vault,
      recipeId: result.record.recipeId,
      lookupId: result.record.recipeId,
      path: result.record.relativePath,
      created: result.created,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_INVALID_INPUT: {
        code: 'contract_invalid',
      },
      VAULT_INVALID_RECIPE: {
        code: 'contract_invalid',
      },
      VAULT_RECIPE_CONFLICT: {
        code: 'conflict',
      },
    })
  }
}

export async function upsertRecipeRecordFromInput(input: {
  vault: string
  inputFile: string
}) {
  const payload = parseRecipePayload(
    await loadJsonInputFile(input.inputFile, 'recipe payload'),
  )

  return upsertRecipeRecord({
    vault: input.vault,
    payload,
  })
}

export async function showRecipeRecord(vault: string, lookup: string) {
  const recipe = await requireRecipeRecord(vault, lookup)
  const data = buildRecipeData(recipe)

  return {
    vault,
    entity: {
      id: recipe.recipeId,
      kind: 'recipe',
      title: recipe.title,
      occurredAt: null,
      path: recipe.relativePath,
      markdown: recipe.markdown,
      data,
      links: buildEntityLinks({
        data,
      }),
    },
  }
}

export async function listRecipeRecords(input: {
  vault: string
  status?: string
  limit: number
}) {
  const recipes = await readRecipeEntries(input.vault)
  const items = recipes
    .filter((entry) =>
      input.status ? entry.status === input.status : true,
    )
    .sort((left, right) =>
      left.title.localeCompare(right.title),
    )
    .slice(0, input.limit)
    .map((entry) => {
      const data = buildRecipeData(entry)

      return {
        id: entry.recipeId,
        kind: 'recipe',
        title: entry.title,
        occurredAt: null,
        path: entry.relativePath,
        markdown: entry.markdown,
        data,
        links: buildEntityLinks({
          data,
        }),
      }
    })

  return {
    vault: input.vault,
    filters: {
      status: input.status ?? null,
      limit: input.limit,
    },
    items,
    count: items.length,
    nextCursor: null,
  }
}

async function requireRecipeRecord(vault: string, lookup: string) {
  const normalizedLookup = lookup.trim()
  const core = await loadRecipeCoreRuntime()

  try {
    return await core.readRecipe({
      vaultRoot: vault,
      recipeId: RECIPE_ID_PATTERN.test(normalizedLookup) ? normalizedLookup : undefined,
      slug: normalizedLookup,
    })
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_RECIPE_MISSING: {
        code: 'not_found',
        message: `No recipe found for "${lookup}".`,
      },
      VAULT_INVALID_RECIPE: {
        code: 'contract_invalid',
      },
    })
  }
}

async function readRecipeEntries(vaultRoot: string) {
  const core = await loadRecipeCoreRuntime()
  try {
    return await core.listRecipes(vaultRoot)
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_INVALID_RECIPE: {
        code: 'contract_invalid',
      },
    })
  }
}

async function loadRecipeCoreRuntime(): Promise<RecipeCoreRuntime> {
  return loadRuntimeModule<RecipeCoreRuntime>('@healthybob/core')
}

function buildRecipeData(recipe: RecipeReadModel) {
  const { relativePath: _relativePath, markdown: _markdown, ...data } = recipe
  return {
    ...data,
  }
}
