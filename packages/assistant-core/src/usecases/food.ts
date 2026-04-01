import { foodUpsertPayloadSchema, ID_PREFIXES, isContractId, type JsonObject } from '@murph/contracts'
import { z } from 'incur'

import {
  addAssistantCronJob,
  listAssistantCronJobs,
} from '../assistant/cron.js'
import { loadRuntimeModule } from '../runtime-import.js'
import { VaultCliError } from '../vault-cli-errors.js'
import {
  buildDailyFoodCronExpression,
  buildDailyFoodCronJobName,
  buildDailyFoodCronPrompt,
  buildDailyFoodSchedule,
  dailyFoodTimeSchema,
  slugifyFoodLookup,
} from './food-autolog.js'
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

interface FoodAutoLogDailyReadModel {
  time: string
}

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
  aliases?: string[]
  ingredients?: string[]
  tags?: string[]
  note?: string
  attachedProtocolIds?: string[]
  autoLogDaily?: FoodAutoLogDailyReadModel | null
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
    aliases?: string[]
    ingredients?: string[]
    tags?: string[]
    note?: string
    attachedProtocolIds?: string[]
    autoLogDaily?: FoodAutoLogDailyReadModel | null
  }): Promise<{
    created: boolean
    record: {
      foodId: string
      relativePath: string
    }
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

export type FoodPayload = z.infer<typeof foodUpsertPayloadSchema>

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
    attachedProtocolIds: ['prot_01JEXAMPLEATTACHED1', 'prot_01JEXAMPLEATTACHED2'],
  } satisfies FoodPayload
}

export function parseFoodPayload(value: unknown) {
  const result = foodUpsertPayloadSchema.safeParse(value)

  if (!result.success) {
    throw new VaultCliError('contract_invalid', 'Food payload is invalid.', {
      errors: result.error.flatten(),
    })
  }

  return result.data
}

export async function upsertFoodRecord(input: {
  vault: string
  payload: FoodPayload
  clearedFields?: ReadonlySet<string>
  allowSlugRename?: boolean
}) {
  const core = await loadFoodCoreRuntime()

  try {
    const result = await core.upsertFood(
      buildFoodCoreInput({
        vault: input.vault,
        payload: input.payload,
        clearedFields: input.clearedFields,
        allowSlugRename: input.allowSlugRename,
      }),
    )

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
    kind: 'food',
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
    const result = await core.upsertFood({
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
      aliases: mergeFoodAliases(existing.aliases, existing.title, title),
      ingredients: existing.ingredients,
      tags: existing.tags,
      note: existing.note,
      attachedProtocolIds: existing.attachedProtocolIds,
      autoLogDaily: existing.autoLogDaily ?? undefined,
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

  let savedFoodId: string | null = null
  let existingFood: FoodReadModel | null = null
  let existingDailyJobs: Awaited<ReturnType<typeof listAssistantCronJobs>> = []

  try {
    const vault = await core.loadVault({
      vaultRoot: input.vault,
    })
    const timeZone = vault.metadata.timezone ?? 'UTC'
    const desiredExpression = buildDailyFoodCronExpression(time)
    existingFood = await findFoodForDailyAdd(core, {
      vault: input.vault,
      title,
      slug,
    })
    const existingJobs = await listAssistantCronJobs(input.vault)
    const existingFoodId = existingFood?.foodId
    existingDailyJobs = existingFoodId
      ? existingJobs.filter((job) => job.foodAutoLog?.foodId === existingFoodId)
      : []

    if (existingDailyJobs.length > 1) {
      throw new VaultCliError(
        'conflict',
        `Food "${existingFood?.title ?? title}" already has multiple recurring auto-log jobs. Remove the extras before changing it.`,
      )
    }

    const existingJob = existingDailyJobs[0] ?? null
    if (existingFood?.autoLogDaily && existingFood.autoLogDaily.time !== time) {
      throw new VaultCliError(
        'conflict',
        `Food "${existingFood.title}" already auto-logs daily at ${existingFood.autoLogDaily.time}. Remove or change the existing recurring food before setting a new time.`,
      )
    }

    if (
      existingJob &&
      !isDailyFoodScheduleMatch(existingJob.schedule, {
        desiredExpression,
        time,
        timeZone,
      })
    ) {
      throw new VaultCliError(
        'conflict',
        `Food "${existingFood?.title ?? title}" already has a recurring auto-log job with a different schedule. Remove or change the existing recurring food before setting a new time.`,
      )
    }

    const result = await core.upsertFood({
      vaultRoot: input.vault,
      foodId: existingFood?.foodId,
      slug: existingFood?.slug ?? slug,
      title,
      note,
      autoLogDaily: {
        time,
      },
    })
    savedFoodId = result.record.foodId
    const food = await core.readFood({
      vaultRoot: input.vault,
      foodId: result.record.foodId,
    })

    const job =
      existingJob ??
      (await addAssistantCronJob({
        vault: input.vault,
        name: buildDailyFoodCronJobName(food.slug),
        prompt: buildDailyFoodCronPrompt(food.title),
        schedule: buildDailyFoodSchedule(time, timeZone),
        foodAutoLog: {
          foodId: food.foodId,
        },
      }))

    return {
      vault: input.vault,
      foodId: food.foodId,
      lookupId: food.foodId,
      path: food.relativePath,
      created: result.created,
      time,
      jobId: job.jobId,
      jobName: job.name,
      nextRunAt: job.state.nextRunAt,
    }
  } catch (error) {
    if (savedFoodId && !existingFood?.autoLogDaily && existingDailyJobs.length === 0) {
      try {
        await core.upsertFood({
          vaultRoot: input.vault,
          foodId: savedFoodId,
          slug: existingFood?.slug ?? slug,
          title,
          autoLogDaily: null,
        })
      } catch {
        // Best-effort cleanup only when cron creation fails after saving a new daily rule.
      }
    }

    throw toVaultCliError(error, {
      ASSISTANT_CRON_INVALID_INPUT: {
        code: 'contract_invalid',
      },
      ASSISTANT_CRON_INVALID_SCHEDULE: {
        code: 'contract_invalid',
      },
      ASSISTANT_CRON_JOB_EXISTS: {
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
  aliases?: string[]
  ingredients?: string[]
  tags?: string[]
  note?: string
  attachedProtocolIds?: string[]
  autoLogDaily?: FoodAutoLogDailyReadModel | null
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
    aliases: clearedFields.has('aliases') ? [] : input.payload.aliases,
    ingredients: clearedFields.has('ingredients') ? [] : input.payload.ingredients,
    tags: clearedFields.has('tags') ? [] : input.payload.tags,
    note: clearedFields.has('note') ? '' : input.payload.note,
    attachedProtocolIds: clearedFields.has('attachedProtocolIds')
      ? []
      : input.payload.attachedProtocolIds,
    autoLogDaily: clearedFields.has('autoLogDaily') ? null : input.payload.autoLogDaily,
  }) as FoodCoreUpsertInput
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
  return loadRuntimeModule<FoodCoreRuntime>('@murph/core')
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

function isDailyFoodScheduleMatch(
  schedule: {
    kind: string
    expression?: string
    localTime?: string
    timeZone?: string
  },
  input: {
    desiredExpression: string
    time: string
    timeZone: string
  },
) {
  if (schedule.kind === 'dailyLocal') {
    return schedule.localTime === input.time && schedule.timeZone === input.timeZone
  }

  return schedule.kind === 'cron' && schedule.expression === input.desiredExpression
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
