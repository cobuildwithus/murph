import { readFile, readdir } from 'node:fs/promises'
import path from 'node:path'

import {
  RECIPE_STATUSES,
  recipeFrontmatterSchema,
  type RecipeFrontmatter,
} from '@healthybob/contracts'
import { z } from 'incur'

import { loadJsonInputObject } from '../json-input.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '../vault-cli-errors.js'
import { buildEntityLinks } from './shared.js'
import {
  resolveVaultRelativePath,
  toVaultCliError,
} from './vault-usecase-helpers.js'

interface RecipeCoreRuntime {
  parseFrontmatterDocument(markdown: string): {
    attributes: Record<string, unknown>
    body: string
  }
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
  const data = {
    ...recipe.attributes,
  }

  return {
    vault,
    entity: {
      id: recipe.attributes.recipeId,
      kind: 'recipe',
      title: recipe.attributes.title,
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
      input.status ? entry.attributes.status === input.status : true,
    )
    .sort((left, right) =>
      left.attributes.title.localeCompare(right.attributes.title),
    )
    .slice(0, input.limit)
    .map((entry) => {
      const data = {
        ...entry.attributes,
      }

      return {
        id: entry.attributes.recipeId,
        kind: 'recipe',
        title: entry.attributes.title,
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
  const entries = await readRecipeEntries(vault)
  const normalizedLookup = lookup.trim()
  const entry = entries.find(
    (candidate) =>
      candidate.attributes.recipeId === normalizedLookup ||
      candidate.attributes.slug === normalizedLookup,
  )

  if (!entry) {
    throw new VaultCliError('not_found', `No recipe found for "${lookup}".`)
  }

  return entry
}

async function readRecipeEntries(vaultRoot: string) {
  const core = await loadRecipeCoreRuntime()
  const recipesRoot = await resolveVaultRelativePath(vaultRoot, 'bank/recipes')
  const files = await safeReadMarkdownFiles(recipesRoot)
  const entries: Array<{
    relativePath: string
    markdown: string
    body: string
    attributes: RecipeFrontmatter
  }> = []

  for (const fileName of files) {
    const relativePath = path.posix.join('bank/recipes', fileName)
    const markdown = await readFile(
      await resolveVaultRelativePath(vaultRoot, relativePath),
      'utf8',
    )
    const document = core.parseFrontmatterDocument(markdown)
    entries.push({
      relativePath,
      markdown,
      body: document.body,
      attributes: validateRecipeFrontmatter(document.attributes),
    })
  }

  return entries
}

function validateRecipeFrontmatter(value: unknown) {
  const result = recipeFrontmatterSchema.safeParse(value)

  if (!result.success) {
    throw new VaultCliError('contract_invalid', 'Recipe frontmatter is invalid.', {
      errors: result.error.flatten(),
    })
  }

  return result.data
}

async function safeReadMarkdownFiles(directory: string) {
  try {
    const entries = await readdir(directory, { withFileTypes: true })
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right))
  } catch (error) {
    if (isMissingPathError(error)) {
      return []
    }

    throw error
  }
}

async function loadRecipeCoreRuntime(): Promise<RecipeCoreRuntime> {
  return loadRuntimeModule<RecipeCoreRuntime>('@healthybob/core')
}

function isMissingPathError(error: unknown): error is NodeJS.ErrnoException {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  )
}
