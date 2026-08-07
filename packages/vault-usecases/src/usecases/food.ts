import {
  foodUpsertPayloadSchema,
  ID_PREFIXES,
  isContractId,
  type FoodUpsertPayload,
  type FoodNutrition,
  type JsonObject,
} from '@murphai/contracts'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '@murphai/operator-config/vault-cli-errors'
import {
  dailyFoodTimeSchema,
  slugifyFoodLookup,
} from './food-autolog.js'
import {
  asListEnvelope,
  buildEntityLinks,
  loadJsonInputFile,
  preparePatchedUpsertPayload,
  toListEntity,
} from './shared.js'
import {
  compactObject,
  toVaultCliError,
} from './vault-usecase-helpers.js'

interface FoodReadModel {
  foodId: string
  slug: string
  title: string
  status: string
  schemaVersion?: string
  docType?: string
  summary?: string
  kind?: string
  brand?: string
  vendor?: string
  location?: string
  serving?: string
  nutrition?: FoodNutrition | null
  aliases?: string[]
  ingredients?: string[]
  tags?: string[]
  note?: string
  attachedRegimenIds?: string[]
  links?: FoodUpsertPayload['links']
  relativePath: string
  markdown: string
}

interface FoodCoreRuntime {
  loadVault(input: {
    vaultRoot: string
  }): Promise<{
    metadata: {
      timezone?: string | null
    }
  }>
  upsertFood(input: {
    vaultRoot: string
    foodId?: string
    slug?: string
    allowSlugRename?: boolean
    title?: string
    status?: string
    summary?: string
    kind?: string
    brand?: string
    vendor?: string
    location?: string
    serving?: string
    nutrition?: FoodNutrition | null
    aliases?: string[]
    ingredients?: string[]
    tags?: string[]
    note?: string
    attachedRegimenIds?: string[]
    links?: FoodUpsertPayload['links']
  }): Promise<{
    created: boolean
    record: {
      foodId: string
      relativePath: string
    }
  }>
  upsertDailyFoodScheduledLog(input: {
    vaultRoot: string
    foodId: string
    localTime: string
  }): Promise<{
    created: boolean
    record: {
      scheduledLogId: string
      title: string
      slug: string
      relativePath: string
    }
  }>
  archiveDailyFoodScheduledLog(input: {
    vaultRoot: string
    foodId: string
  }): Promise<{
    archived: Array<{
      scheduledLogId: string
      title: string
      slug: string
      relativePath: string
    }>
  }>
  listFoods(vaultRoot: string): Promise<FoodReadModel[]>
  deleteFood(input: {
    vaultRoot: string
    foodId?: string
    slug?: string
  }): Promise<{
    foodId: string
    relativePath: string
    deleted: true
  }>
  readFood(input: {
    vaultRoot: string
    foodId?: string
    slug?: string
  }): Promise<FoodReadModel>
}

export type FoodPayload = Omit<FoodUpsertPayload, 'status'> & {
  status?: FoodUpsertPayload['status']
}

export function scaffoldFoodPayload() {
  return parseFoodPayload({
    title: 'Regular Acai Bowl',
    slug: 'regular-acai-bowl',
    status: 'active',
    summary: 'The usual acai bowl order from the neighborhood spot with repeat toppings.',
    kind: 'acai bowl',
    vendor: 'Neighborhood Acai Bar',
    location: 'Brooklyn, NY',
    serving: '1 bowl',
    nutrition: {
      perServing: {
        calories: 540,
        proteinGrams: 11,
        carbsGrams: 68,
        fatGrams: 24,
        fiberGrams: 11,
      },
      provenance: {
        source: 'estimated',
        confidence: 'medium',
        sourceDetail: 'Neighborhood menu plus standard granola serving.',
      },
    },
    aliases: ['regular acai bowl', 'usual acai bowl'],
    ingredients: ['acai base', 'banana', 'strawberries', 'granola', 'almond butter'],
    tags: ['breakfast', 'favorite'],
    note: 'Typical order includes extra granola and no honey.',
    attachedRegimenIds: ['reg_01234567890123456789012345', 'reg_01234567890123456789012346'],
  })
}

export function parseFoodPayload(value: unknown): FoodPayload {
  const statusProvided =
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    Object.hasOwn(value, 'status')
  const result = foodUpsertPayloadSchema.safeParse(value)

  if (!result.success) {
    throw new VaultCliError('contract_invalid', 'Food payload is invalid.', {
      errors: result.error.flatten(),
    })
  }

  if (statusProvided) {
    return result.data
  }

  const payload: FoodPayload = { ...result.data }
  delete payload.status
  return payload
}

export async function upsertFoodRecord(input: {
  vault: string
  payload: FoodPayload
  clearedFields?: ReadonlySet<string>
  allowSlugRename?: boolean
}) {
  const core = await loadFoodCoreRuntime()

  try {
    const persisted = await persistFoodRecord({
      core,
      vault: input.vault,
      payload: buildFoodCoreInput({
        vault: input.vault,
        payload: input.payload,
        clearedFields: input.clearedFields,
        allowSlugRename: input.allowSlugRename,
      }),
    })

    return {
      vault: input.vault,
      foodId: persisted.food.foodId,
      lookupId: persisted.food.foodId,
      path: persisted.food.relativePath,
      created: persisted.created,
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

export async function editFoodRecord(input: {
  vault: string
  lookup: string
  inputFile?: string
  set?: string[]
  clear?: string[]
}) {
  const food = await requireFoodRecord(input.vault, input.lookup)
  const patched = await preparePatchedUpsertPayload({
    record: buildFoodPayload(food),
    entityIdField: 'foodId',
    entityId: food.foodId,
    inputFile: input.inputFile,
    set: input.set,
    clear: input.clear,
    patchLabel: 'food payload',
    parsePayload: parseFoodPayload,
  })

  await upsertFoodRecord({
    vault: input.vault,
    payload: patched.payload,
    clearedFields: patched.clearedFields,
    allowSlugRename: patched.allowSlugRename,
  })

  return showFoodRecord(input.vault, food.foodId)
}

export async function deleteFoodRecord(input: {
  vault: string
  lookup: string
}) {
  const food = await requireFoodRecord(input.vault, input.lookup)
  const normalizedLookup = input.lookup.trim()
  const core = await loadFoodCoreRuntime()

  try {
    await core.deleteFood({
      vaultRoot: input.vault,
      foodId: isContractId(normalizedLookup, ID_PREFIXES.food)
        ? normalizedLookup
        : food.foodId,
      slug: normalizedLookup,
    })
    await core.archiveDailyFoodScheduledLog({
      vaultRoot: input.vault,
      foodId: food.foodId,
    })
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_FOOD_MISSING: {
        code: 'not_found',
        message: `No food found for "${input.lookup}".`,
      },
      VAULT_INVALID_FOOD: {
        code: 'contract_invalid',
      },
    })
  }

  return {
    vault: input.vault,
    entityId: food.foodId,
    lookupId: food.foodId,
    kind: 'food' as const,
    deleted: true as const,
    retainedPaths: [],
  }
}

export async function renameFoodRecord(input: {
  vault: string
  lookup: string
  title: string
  slug?: string
}) {
  const core = await loadFoodCoreRuntime()
  const existing = await requireFoodRecord(input.vault, input.lookup)
  const title = input.title.trim()
  const slugInput = typeof input.slug === 'string' ? input.slug.trim() || undefined : undefined

  if (!title) {
    throw new VaultCliError('contract_invalid', 'title must be a non-empty string.')
  }

  const slug = slugInput ?? slugifyFoodLookup(title)

  try {
    const persisted = await persistFoodRecord({
      core,
      vault: input.vault,
      payload: {
        vaultRoot: input.vault,
        foodId: existing.foodId,
        slug,
        allowSlugRename: true,
        title,
        status: existing.status,
        summary: existing.summary,
        kind: existing.kind,
        brand: existing.brand,
        vendor: existing.vendor,
        location: existing.location,
        serving: existing.serving,
        nutrition: existing.nutrition,
        aliases: mergeFoodAliases(existing.aliases, existing.title, title),
        ingredients: existing.ingredients,
        tags: existing.tags,
        note: existing.note,
        attachedRegimenIds: existing.attachedRegimenIds,
        links: existing.links,
      },
    })

    return {
      vault: input.vault,
      foodId: persisted.food.foodId,
      lookupId: persisted.food.foodId,
      path: persisted.food.relativePath,
      created: persisted.created,
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

export async function addDailyFoodRecord(input: {
  vault: string
  title: string
  time: string
  note?: string
  slug?: string
}) {
  const core = await loadFoodCoreRuntime()
  const title = input.title.trim()
  const time = dailyFoodTimeSchema.parse(input.time)
  const note = typeof input.note === 'string' ? input.note.trim() || undefined : undefined
  const slug = typeof input.slug === 'string' ? input.slug.trim() || undefined : undefined

  if (!title) {
    throw new VaultCliError('contract_invalid', 'title must be a non-empty string.')
  }

  try {
    const existingFood = await findFoodForDailyAdd(core, {
      vault: input.vault,
      title,
      slug,
    })
    const persisted = await persistFoodRecord({
      core,
      vault: input.vault,
      payload: {
        vaultRoot: input.vault,
        foodId: existingFood?.foodId,
        slug: existingFood?.slug ?? slug,
        title,
        note,
      },
    })
    const scheduledLog = await core.upsertDailyFoodScheduledLog({
      vaultRoot: input.vault,
      foodId: persisted.food.foodId,
      localTime: time,
    })

    return {
      vault: input.vault,
      foodId: persisted.food.foodId,
      lookupId: persisted.food.foodId,
      path: persisted.food.relativePath,
      created: persisted.created,
      time,
      jobId: scheduledLog.record.scheduledLogId,
      jobName: scheduledLog.record.title,
      nextRunAt: null,
    }
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_INVALID_SCHEDULED_LOG: {
        code: 'contract_invalid',
      },
      VAULT_SCHEDULED_LOG_CONFLICT: {
        code: 'conflict',
      },
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

export async function unscheduleDailyFoodRecord(input: {
  vault: string
  lookup: string
}) {
  const food = await requireFoodRecord(input.vault, input.lookup)
  const core = await loadFoodCoreRuntime()

  try {
    await core.archiveDailyFoodScheduledLog({
      vaultRoot: input.vault,
      foodId: food.foodId,
    })
  } catch (error) {
    throw toVaultCliError(error, {
      VAULT_INVALID_SCHEDULED_LOG: {
        code: 'contract_invalid',
      },
    })
  }

  return showFoodRecord(input.vault, food.foodId)
}

async function persistFoodRecord(input: {
  core: FoodCoreRuntime
  payload: FoodCoreUpsertInput
  vault: string
}) {
  const result = await input.core.upsertFood(input.payload)
  const food = await input.core.readFood({
    vaultRoot: input.vault,
    foodId: result.record.foodId,
  })

  return {
    created: result.created,
    food,
  }
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

      return toListEntity({
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
      })
    })

  return asListEnvelope(input.vault, {
    status: input.status ?? null,
    limit: input.limit,
  }, items)
}

async function requireFoodRecord(vault: string, lookup: string) {
  const normalizedLookup = lookup.trim()
  const core = await loadFoodCoreRuntime()

  try {
    return await core.readFood({
      vaultRoot: vault,
      foodId: isContractId(normalizedLookup, ID_PREFIXES.food) ? normalizedLookup : undefined,
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

interface FoodCoreUpsertInput {
  vaultRoot: string
  foodId?: string
  slug?: string
  allowSlugRename?: boolean
  title?: string
  status?: string
  summary?: string
  kind?: string
  brand?: string
  vendor?: string
  location?: string
  serving?: string
  nutrition?: FoodNutrition | null
  aliases?: string[]
  ingredients?: string[]
  tags?: string[]
  note?: string
  attachedRegimenIds?: string[]
  links?: FoodUpsertPayload['links']
}

function buildFoodCoreInput(input: {
  vault: string
  payload: FoodPayload
  clearedFields?: ReadonlySet<string>
  allowSlugRename?: boolean
}): FoodCoreUpsertInput {
  const clearedFields = input.clearedFields ?? new Set<string>()

  return compactObject({
    vaultRoot: input.vault,
    foodId: input.payload.foodId,
    allowSlugRename: input.allowSlugRename === true ? true : undefined,
    slug: clearedFields.has('slug') ? undefined : input.payload.slug,
    title: input.payload.title,
    status: clearedFields.has('status') ? 'active' : input.payload.status,
    summary: clearedFields.has('summary') ? '' : input.payload.summary,
    kind: clearedFields.has('kind') ? '' : input.payload.kind,
    brand: clearedFields.has('brand') ? '' : input.payload.brand,
    vendor: clearedFields.has('vendor') ? '' : input.payload.vendor,
    location: clearedFields.has('location') ? '' : input.payload.location,
    serving: clearedFields.has('serving') ? '' : input.payload.serving,
    nutrition: clearedFields.has('nutrition') ? null : input.payload.nutrition,
    aliases: clearedFields.has('aliases') ? [] : input.payload.aliases,
    ingredients: clearedFields.has('ingredients') ? [] : input.payload.ingredients,
    tags: clearedFields.has('tags') ? [] : input.payload.tags,
    note: clearedFields.has('note') ? '' : input.payload.note,
    attachedRegimenIds: clearedFields.has('attachedRegimenIds')
      ? []
      : input.payload.attachedRegimenIds,
    links: buildFoodCoreLinks(input.payload, clearedFields),
  }) as FoodCoreUpsertInput
}

function buildFoodCoreLinks(
  payload: FoodPayload,
  clearedFields: ReadonlySet<string>,
): FoodUpsertPayload['links'] | undefined {
  if (clearedFields.has('links')) {
    return []
  }

  const explicitLinks = (payload.links ?? []).filter((link) =>
    !(clearedFields.has('attachedRegimenIds') && link.type === 'related_regimen')
  )
  const attachedRegimenIds = clearedFields.has('attachedRegimenIds')
    ? []
    : payload.attachedRegimenIds ?? []

  if (explicitLinks.length === 0 && attachedRegimenIds.length === 0) {
    return undefined
  }

  return uniqueFoodLinks([
    ...explicitLinks,
    ...attachedRegimenIds.map((targetId) => ({
      type: 'related_regimen' as const,
      targetId,
    })),
  ])
}

function uniqueFoodLinks(
  links: NonNullable<FoodUpsertPayload['links']>,
): FoodUpsertPayload['links'] {
  const seen = new Set<string>()
  return links.filter((link) => {
    const key = `${link.type}:${link.targetId}`
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

function buildFoodPayload(food: FoodReadModel): FoodPayload {
  const {
    schemaVersion: _schemaVersion,
    docType: _docType,
    relativePath: _relativePath,
    markdown: _markdown,
    ...payload
  } = food

  return structuredClone(payload) as FoodPayload
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
  return loadRuntimeModule<FoodCoreRuntime>('@murphai/core')
}

async function findFoodForDailyAdd(
  core: FoodCoreRuntime,
  input: {
    vault: string
    title: string
    slug?: string
  },
) {
  const candidateSlug = input.slug ?? slugifyFoodLookup(input.title)

  if (candidateSlug) {
    try {
      return await core.readFood({
        vaultRoot: input.vault,
        slug: candidateSlug,
      })
    } catch (error) {
      const vaultErrorCode =
        error && typeof error === 'object' && 'code' in error
          ? String((error as { code?: unknown }).code ?? '')
          : ''

      if (vaultErrorCode !== 'VAULT_FOOD_MISSING') {
        throw error
      }
    }
  }

  const foods = await core.listFoods(input.vault)
  return foods.find((food) => food.title === input.title) ?? null
}

function mergeFoodAliases(
  aliases: string[] | undefined,
  previousTitle: string,
  nextTitle: string,
) {
  const seen = new Set<string>()
  const merged: string[] = []
  const append = (value: string | undefined) => {
    const trimmed = value?.trim()

    if (!trimmed || trimmed === nextTitle || seen.has(trimmed)) {
      return
    }

    seen.add(trimmed)
    merged.push(trimmed)
  }

  aliases?.forEach(append)

  if (previousTitle !== nextTitle) {
    append(previousTitle)
  }

  return merged.length > 0 ? merged : undefined
}

function buildFoodData(food: FoodReadModel): JsonObject {
  const { relativePath: _relativePath, markdown: _markdown, ...data } = food
  return structuredClone(data) as JsonObject
}
