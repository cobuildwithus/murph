import {
  buildDailyFoodCronExpression,
  buildDailyFoodCronJobName,
  buildDailyFoodCronPrompt,
  buildDailyFoodSchedule,
} from '@murphai/vault-usecases/usecases/food-autolog'
import { loadRuntimeModule } from '@murphai/vault-usecases/runtime-import'
import {
  addAssistantCronJob,
  listAssistantCronJobs,
  removeAssistantCronJob,
} from './cron.js'

interface FoodAutoLogCoreRuntime {
  loadVault(input: {
    vaultRoot: string
  }): Promise<{
    metadata: {
      timezone?: string | null
    }
  }>
}

interface FoodAutoLogSyncRecord {
  foodId: string
  slug: string
  title: string
  autoLogDaily?: {
    time: string
  } | null
}

interface FoodAutoLogSyncJob {
  jobId: string
  name: string
  state: {
    nextRunAt: string | null
  }
}

interface FoodAutoLogHooks {
  syncRecurringFood(input: {
    food: FoodAutoLogSyncRecord
    vault: string
  }): Promise<FoodAutoLogSyncJob | null>
}

type AssistantCronJobRecord = Awaited<ReturnType<typeof listAssistantCronJobs>>[number]

export function createAssistantFoodAutoLogHooks(): FoodAutoLogHooks {
  return {
    syncRecurringFood(input) {
      return reconcileDailyFoodAutoLog(input)
    },
  }
}

async function reconcileDailyFoodAutoLog(input: {
  food: FoodAutoLogSyncRecord
  vault: string
}): Promise<FoodAutoLogSyncJob | null> {
  const existingJobs = (await listAssistantCronJobs(input.vault)).filter(
    (job) => job.foodAutoLog?.foodId === input.food.foodId,
  )

  if (!input.food.autoLogDaily) {
    for (const job of existingJobs) {
      await removeAssistantCronJob(input.vault, job.jobId)
    }
    return null
  }

  const core = await loadFoodAutoLogCoreRuntime()
  const vault = await core.loadVault({
    vaultRoot: input.vault,
  })
  const time = input.food.autoLogDaily.time
  const timeZone = vault.metadata.timezone ?? 'UTC'
  const desiredName = buildDailyFoodCronJobName(input.food.slug)
  const desiredPrompt = buildDailyFoodCronPrompt(input.food.title)
  const desiredExpression = buildDailyFoodCronExpression(time)
  const desiredJob = existingJobs.find((job) =>
    job.name === desiredName &&
    job.prompt === desiredPrompt &&
    isDailyFoodScheduleMatch(job, {
      desiredExpression,
      time,
      timeZone,
    }),
  )

  if (desiredJob && existingJobs.length === 1) {
    return desiredJob
  }

  for (const job of existingJobs) {
    await removeAssistantCronJob(input.vault, job.jobId)
  }

  return addAssistantCronJob({
    vault: input.vault,
    name: desiredName,
    prompt: desiredPrompt,
    schedule: buildDailyFoodSchedule(time, timeZone),
    foodAutoLog: {
      foodId: input.food.foodId,
    },
  })
}

function isDailyFoodScheduleMatch(
  job: AssistantCronJobRecord,
  input: {
    desiredExpression: string
    time: string
    timeZone: string
  },
) {
  if (job.schedule.kind === 'dailyLocal') {
    return job.schedule.localTime === input.time && job.schedule.timeZone === input.timeZone
  }

  return job.schedule.kind === 'cron' && job.schedule.expression === input.desiredExpression
}

async function loadFoodAutoLogCoreRuntime(): Promise<FoodAutoLogCoreRuntime> {
  return loadRuntimeModule<FoodAutoLogCoreRuntime>('@murphai/core')
}
