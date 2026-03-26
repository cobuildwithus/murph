import { FOOD_STATUSES } from '@healthybob/contracts'
import { z } from 'incur'

import { loadJsonInputObject } from '../json-input.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '../vault-cli-errors.js'
import { buildEntityLinks } from './shared.js'
import { toVaultCliError } from './vault-usecase-helpers.js'

interface FoodReadModel {
  foodId: string
  slug: string
  title: string
  status: string
  relativePath: string
  markdown: string
  [key: string]: unknown
}

const FOOD_ID_PATTERN = /^food_[0-9A-Za-z]+$/u

interface FoodCoreRuntime {
  upsertFood(input: {
    vaultRoot: string
    foodId?: string
    slug?: string
    title?: string
    status?: string
    summary?: string
    kind?: string
    brand?: string
    vendor?: string
    location?: string
    serving?: string
    aliases?: string[]
    ingredients?: string[]
    tags?: string[]
    note?: string
  }): Promise<{
    created: boolean
    record: {
      foodId: string
      relativePath: string
    }
  }>
  listFoods(vaultRoot: string): Promise<FoodReadModel[]>
  readFood(input: {
    vaultRoot: string
    foodId?: string
    slug?: string
  }): Promise<FoodReadModel>
}

const slugSchema = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/u, 'Expected a lowercase kebab-case slug.')

const foodPayloadSchema = z
  .object({
    foodId: z
      .string()
      .regex(/^food_[0-9A-Za-z]+$/u)
      .optional(),
    slug: slugSchema.optional(),
    title: z.string().min(1).max(160),
    status: z.enum(FOOD_STATUSES).default('active'),
    summary: z.string().min(1).max(4000).optional(),
    kind: z.string().min(1).max(160).optional(),
    brand: z.string().min(1).max(160).optional(),
    vendor: z.string().min(1).max(160).optional(),
    location: z.string().min(1).max(160).optional(),
    serving: z.string().min(1).max(160).optional(),
    aliases: z.array(z.string().min(1).max(160)).optional(),
    ingredients: z.array(z.string().min(1).max(4000)).optional(),
    tags: z.array(slugSchema).optional(),
    note: z.string().min(1).max(4000).optional(),
  })
  .strict()

export type FoodPayload = z.infer<typeof foodPayloadSchema>

export function scaffoldFoodPayload() {
  return {
    title: 'Regular Acai Bowl',
    slug: 'regular-acai-bowl',
    status: 'active',
    summary: 'The usual acai bowl order from the neighborhood spot with repeat toppings.',
    kind: 'acai bowl',
    vendor: 'Neighborhood Acai Bar',
    location: 'Brooklyn, NY',
    serving: '1 bowl',
    aliases: ['regular acai bowl', 'usual acai bowl'],
    ingredients: ['acai base', 'banana', 'strawberries', 'granola', 'almond butter'],
    tags: ['breakfast', 'favorite'],
    note: 'Typical order includes extra granola and no honey.',
  } satisfies FoodPayload
}

export function parseFoodPayload(value: unknown) {
  const result = foodPayloadSchema.safeParse(value)

  if (!result.success) {
    throw new VaultCliError('contract_invalid', 'Food payload is invalid.', {
      errors: result.error.flatten(),
    })
  }

  return result.data
}

async function loadJsonInputFile(input: string, label: string) {
  return loadJsonInputObject(input, label)
}

export async function upsertFoodRecord(input: {
  vault: string
  payload: FoodPayload
}) {
  const core = await loadFoodCoreRuntime()

  try {
    const result = await core.upsertFood({
      vaultRoot: input.vault,
      foodId: input.payload.foodId,
      slug: input.payload.slug,
      title: input.payload.title,
      status: input.payload.status,
      summary: input.payload.summary,
      kind: input.payload.kind,
      brand: input.payload.brand,
      vendor: input.payload.vendor,
      location: input.payload.location,
      serving: input.payload.serving,
      aliases: input.payload.aliases,
      ingredients: input.payload.ingredients,
      tags: input.payload.tags,
      note: input.payload.note,
    })

    return {
      vault: input.vault,
      foodId: result.record.foodId,
      lookupId: result.record.foodId,
      path: result.record.relativePath,
      created: result.created,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_INVALID_INPUT: {
        code: 'contract_invalid',
      },
      VAULT_INVALID_FOOD: {
        code: 'contract_invalid',
      },
      VAULT_FOOD_CONFLICT: {
        code: 'conflict',
      },
    })
  }
}

export async function upsertFoodRecordFromInput(input: {
  vault: string
  inputFile: string
}) {
  const payload = parseFoodPayload(
    await loadJsonInputFile(input.inputFile, 'food payload'),
  )

  return upsertFoodRecord({
    vault: input.vault,
    payload,
  })
}

export async function showFoodRecord(vault: string, lookup: string) {
  const food = await requireFoodRecord(vault, lookup)
  const data = buildFoodData(food)

  return {
    vault,
    entity: {
      id: food.foodId,
      kind: 'food',
      title: food.title,
      occurredAt: null,
      path: food.relativePath,
      markdown: food.markdown,
      data,
      links: buildEntityLinks({
        data,
      }),
    },
  }
}

export async function listFoodRecords(input: {
  vault: string
  status?: string
  limit: number
}) {
  const foods = await readFoodEntries(input.vault)
  const items = foods
    .filter((entry) =>
      input.status ? entry.status === input.status : true,
    )
    .sort((left, right) =>
      left.title.localeCompare(right.title),
    )
    .slice(0, input.limit)
    .map((entry) => {
      const data = buildFoodData(entry)

      return {
        id: entry.foodId,
        kind: 'food',
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

async function requireFoodRecord(vault: string, lookup: string) {
  const normalizedLookup = lookup.trim()
  const core = await loadFoodCoreRuntime()

  try {
    return await core.readFood({
      vaultRoot: vault,
      foodId: FOOD_ID_PATTERN.test(normalizedLookup) ? normalizedLookup : undefined,
      slug: normalizedLookup,
    })
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_FOOD_MISSING: {
        code: 'not_found',
        message: `No food found for "${lookup}".`,
      },
      VAULT_INVALID_FOOD: {
        code: 'contract_invalid',
      },
    })
  }
}

async function readFoodEntries(vaultRoot: string) {
  const core = await loadFoodCoreRuntime()
  try {
    return await core.listFoods(vaultRoot)
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_INVALID_FOOD: {
        code: 'contract_invalid',
      },
    })
  }
}

async function loadFoodCoreRuntime(): Promise<FoodCoreRuntime> {
  return loadRuntimeModule<FoodCoreRuntime>('@healthybob/core')
}

function buildFoodData(food: FoodReadModel) {
  const { relativePath: _relativePath, markdown: _markdown, ...data } = food
  return {
    ...data,
  }
}
