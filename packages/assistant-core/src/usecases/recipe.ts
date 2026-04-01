import { RECIPE_STATUSES, ID_PREFIXES, isContractId, type JsonObject } from '@murphai/contracts'
import { z } from 'incur'

import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  asListEnvelope,
  buildEntityLinks,
  loadJsonInputFile,
  preparePatchedUpsertPayload,
} from './shared.js'
import {
  compactObject,
  toVaultCliError,
} from './vault-usecase-helpers.js'

interface RecipeReadModel {
  recipeId: string
  slug: string
  title: string
  status: string
  schemaVersion?: string
  docType?: string
  relativePath: string
  markdown: string
}

interface RecipeCoreRuntime {
  upsertRecipe(input: {
    vaultRoot: string
    recipeId?: string
    allowSlugRename?: boolean
    slug?: string
    title?: string
    status?: string
    summary?: string
    cuisine?: string
    dishType?: string
    source?: string
    servings?: number | null
    prepTimeMinutes?: number | null
    cookTimeMinutes?: number | null
    totalTimeMinutes?: number | null
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
  deleteRecipe(input: {
    vaultRoot: string
    recipeId?: string
    slug?: string
  }): Promise<{
    recipeId: string
    relativePath: string
    deleted: true
  }>
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

export async function upsertRecipeRecord(input: {
  vault: string
  payload: RecipePayload
  clearedFields?: ReadonlySet<string>
  allowSlugRename?: boolean
}) {
  const core = await loadRecipeCoreRuntime()

  try {
    const result = await core.upsertRecipe(
      buildRecipeCoreInput({
        vault: input.vault,
        payload: input.payload,
        clearedFields: input.clearedFields,
        allowSlugRename: input.allowSlugRename,
      }),
    )

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

export async function editRecipeRecord(input: {
  vault: string
  lookup: string
  inputFile?: string
  set?: string[]
  clear?: string[]
}) {
  const recipe = await requireRecipeRecord(input.vault, input.lookup)
  const patched = await preparePatchedUpsertPayload({
    record: buildRecipePayload(recipe),
    entityIdField: 'recipeId',
    entityId: recipe.recipeId,
    inputFile: input.inputFile,
    set: input.set,
    clear: input.clear,
    patchLabel: 'recipe payload',
    parsePayload: parseRecipePayload,
  })

  await upsertRecipeRecord({
    vault: input.vault,
    payload: patched.payload,
    clearedFields: patched.clearedFields,
    allowSlugRename: patched.allowSlugRename,
  })

  return showRecipeRecord(input.vault, recipe.recipeId)
}

export async function deleteRecipeRecord(input: {
  vault: string
  lookup: string
}) {
  const recipe = await requireRecipeRecord(input.vault, input.lookup)
  const normalizedLookup = input.lookup.trim()
  const core = await loadRecipeCoreRuntime()

  try {
    await core.deleteRecipe({
      vaultRoot: input.vault,
      recipeId: isContractId(normalizedLookup, ID_PREFIXES.recipe)
        ? normalizedLookup
        : recipe.recipeId,
      slug: normalizedLookup,
    })
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_RECIPE_MISSING: {
        code: 'not_found',
        message: `No recipe found for "${input.lookup}".`,
      },
      VAULT_INVALID_RECIPE: {
        code: 'contract_invalid',
      },
    })
  }

  return {
    vault: input.vault,
    entityId: recipe.recipeId,
    lookupId: recipe.recipeId,
    kind: 'recipe',
    deleted: true as const,
    retainedPaths: [],
  }
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

  return asListEnvelope(input.vault, {
    status: input.status ?? null,
    limit: input.limit,
  }, items)
}

async function requireRecipeRecord(vault: string, lookup: string) {
  const normalizedLookup = lookup.trim()
  const core = await loadRecipeCoreRuntime()

  try {
    return await core.readRecipe({
      vaultRoot: vault,
      recipeId: isContractId(normalizedLookup, ID_PREFIXES.recipe) ? normalizedLookup : undefined,
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

interface RecipeCoreUpsertInput {
  vaultRoot: string
  recipeId?: string
  slug?: string
  title?: string
  status?: string
  summary?: string
  cuisine?: string
  dishType?: string
  source?: string
  servings?: number | null
  prepTimeMinutes?: number | null
  cookTimeMinutes?: number | null
  totalTimeMinutes?: number | null
  tags?: string[]
  ingredients?: string[]
  steps?: string[]
  relatedGoalIds?: string[]
  relatedConditionIds?: string[]
}

function buildRecipeCoreInput(input: {
  vault: string
  payload: RecipePayload
  clearedFields?: ReadonlySet<string>
  allowSlugRename?: boolean
}): RecipeCoreUpsertInput {
  const clearedFields = input.clearedFields ?? new Set<string>()
  const resetTotalTimeMinutes =
    !clearedFields.has('totalTimeMinutes') &&
    (clearedFields.has('prepTimeMinutes') || clearedFields.has('cookTimeMinutes'))

  return compactObject({
    vaultRoot: input.vault,
    recipeId: input.payload.recipeId,
    allowSlugRename: input.allowSlugRename === true ? true : undefined,
    slug: clearedFields.has('slug') ? undefined : input.payload.slug,
    title: input.payload.title,
    status: clearedFields.has('status') ? 'saved' : input.payload.status,
    summary: clearedFields.has('summary') ? '' : input.payload.summary,
    cuisine: clearedFields.has('cuisine') ? '' : input.payload.cuisine,
    dishType: clearedFields.has('dishType') ? '' : input.payload.dishType,
    source: clearedFields.has('source') ? '' : input.payload.source,
    servings: clearedFields.has('servings') ? null : input.payload.servings,
    prepTimeMinutes: clearedFields.has('prepTimeMinutes')
      ? null
      : input.payload.prepTimeMinutes,
    cookTimeMinutes: clearedFields.has('cookTimeMinutes')
      ? null
      : input.payload.cookTimeMinutes,
    totalTimeMinutes:
      clearedFields.has('totalTimeMinutes') || resetTotalTimeMinutes
        ? null
        : input.payload.totalTimeMinutes,
    tags: clearedFields.has('tags') ? [] : input.payload.tags,
    ingredients: clearedFields.has('ingredients') ? [] : input.payload.ingredients,
    steps: clearedFields.has('steps') ? [] : input.payload.steps,
    relatedGoalIds: clearedFields.has('relatedGoalIds')
      ? []
      : input.payload.relatedGoalIds,
    relatedConditionIds: clearedFields.has('relatedConditionIds')
      ? []
      : input.payload.relatedConditionIds,
  }) as RecipeCoreUpsertInput
}

function buildRecipePayload(recipe: RecipeReadModel): RecipePayload {
  const {
    schemaVersion: _schemaVersion,
    docType: _docType,
    relativePath: _relativePath,
    markdown: _markdown,
    ...payload
  } = recipe

  return structuredClone(payload) as RecipePayload
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
  return loadRuntimeModule<RecipeCoreRuntime>('@murphai/core')
}

function buildRecipeData(recipe: RecipeReadModel): JsonObject {
  const { relativePath: _relativePath, markdown: _markdown, ...data } = recipe
  return structuredClone(data) as JsonObject
}
