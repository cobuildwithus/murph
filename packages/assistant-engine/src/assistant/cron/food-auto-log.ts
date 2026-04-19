import type { FoodNutrition, MealNutrition } from '@murphai/contracts'
import type { AssistantCronSchedule } from '@murphai/operator-config/assistant-cli-contracts'
import { loadRuntimeModule } from '@murphai/vault-usecases/runtime'
import {
  buildDailyFoodCronJobId,
  buildDailyFoodSchedule,
  renderAutoLoggedFoodMealNote,
} from '@murphai/vault-usecases/records'
import { loadImporterRuntime } from '@murphai/vault-usecases/runtime'

interface FoodAutoLogRecord {
  foodId: string
  attachedProtocolIds?: string[]
  aliases?: string[]
  slug?: string
  brand?: string
  kind?: string
  location?: string
  status?: string
  title: string
  autoLogDaily?: {
    time: string
  } | null
  summary?: string
  tags?: string[]
  vendor?: string
  serving?: string
  ingredients?: string[]
  note?: string
  nutrition?: FoodNutrition | null
}

interface FoodAutoLogCoreRuntime {
  listFoods(vaultRoot: string): Promise<FoodAutoLogRecord[]>
  readFood(input: {
    vaultRoot: string
    foodId?: string
    slug?: string
  }): Promise<FoodAutoLogRecord>
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
    attachedProtocolIds?: string[]
    autoLogDaily?: {
      time: string
    } | null
  }): Promise<unknown>
}

export interface CanonicalFoodAssistantCronJobRecord {
  kind: 'foodAutoLog'
  foodId: string
  jobId: string
  schedule: Extract<AssistantCronSchedule, { kind: 'dailyLocal' }>
  slug: string
  timeZone: string
  title: string
}

export async function listCanonicalFoodAutoLogRecords(
  vault: string,
  timeZone: string,
): Promise<CanonicalFoodAssistantCronJobRecord[]> {
  const core = await loadFoodAutoLogCoreRuntime()
  if (typeof core.listFoods !== 'function') {
    return []
  }

  const foods = await core.listFoods(vault)

  return foods.flatMap((food) => {
    const localTime = normalizeNullableString(food.autoLogDaily?.time)
    const slug = normalizeNullableString(food.slug)
    if (!localTime || !slug) {
      return []
    }

    return [{
      kind: 'foodAutoLog',
      foodId: food.foodId,
      jobId: buildDailyFoodCronJobId(food.foodId),
      schedule: buildDailyFoodSchedule(localTime) as Extract<
        AssistantCronSchedule,
        { kind: 'dailyLocal' }
      >,
      slug,
      timeZone,
      title: food.title,
    }]
  })
}

export async function clearCanonicalFoodAutoLogSchedule(
  vault: string,
  foodId: string,
): Promise<void> {
  const core = await loadFoodAutoLogCoreRuntime()
  const existing = await core.readFood({
    vaultRoot: vault,
    foodId,
  })

  await core.upsertFood({
    vaultRoot: vault,
    foodId: existing.foodId,
    slug: existing.slug,
    title: existing.title,
    status: existing.status,
    summary: existing.summary,
    kind: existing.kind,
    brand: existing.brand,
    vendor: existing.vendor,
    location: existing.location,
    serving: existing.serving,
    nutrition: existing.nutrition,
    aliases: existing.aliases,
    ingredients: existing.ingredients,
    tags: existing.tags,
    note: existing.note,
    attachedProtocolIds: existing.attachedProtocolIds,
    autoLogDaily: null,
  })
}

export async function runFoodAutoLogCronJob(input: {
  vault: string
  foodId: string
}): Promise<string> {
  const [core, importers] = await Promise.all([
    loadRuntimeModule<FoodAutoLogCoreRuntime>('@murphai/core'),
    loadImporterRuntime(),
  ])
  const food = await core.readFood({
    vaultRoot: input.vault,
    foodId: input.foodId,
  })
  const note = renderAutoLoggedFoodMealNote(food)
  const mealInput: Parameters<typeof importers.addMeal>[0] = {
    vaultRoot: input.vault,
    occurredAt: new Date().toISOString(),
    note,
    source: 'derived',
  }
  const inheritedNutrition = buildInheritedMealNutrition(food.nutrition, food.title)
  if (inheritedNutrition != null) {
    mealInput.nutrition = inheritedNutrition
  }
  const result = await importers.addMeal(mealInput)

  return `Auto-logged recurring food "${food.title}" as meal ${result.mealId}.`
}

async function loadFoodAutoLogCoreRuntime(): Promise<FoodAutoLogCoreRuntime> {
  return loadRuntimeModule<FoodAutoLogCoreRuntime>('@murphai/core')
}

function buildInheritedMealNutrition(
  foodNutrition: FoodNutrition | null | undefined,
  title: string,
): MealNutrition | undefined {
  const totals = foodNutrition?.perServing
  if (!totals) {
    return undefined
  }

  return {
    totals,
    provenance: {
      source: 'inherited',
      ...(foodNutrition.provenance?.confidence
        ? { confidence: foodNutrition.provenance.confidence }
        : {}),
      sourceDetail: `Copied from saved food "${title}".`,
    },
  }
}

function normalizeNullableString(value: string | null | undefined): string | null {
  if (typeof value !== 'string') {
    return null
  }
  const trimmed = value.trim()
  return trimmed.length > 0 ? trimmed : null
}
