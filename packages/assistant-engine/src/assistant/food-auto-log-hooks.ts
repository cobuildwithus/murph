import { buildDailyFoodCronJobId } from '@murphai/vault-usecases/records'
import { getAssistantCronJob } from './cron.js'
import { withAssistantCronWriteLock } from './cron/locking.ts'
import {
  createAssistantCronCanonicalRuntimeRecord,
  findAssistantCronCanonicalRuntimeRecord,
  readAssistantCronCanonicalRuntimeStore,
  removeAssistantCronCanonicalRuntimeRecord,
  upsertAssistantCronCanonicalRuntimeRecord,
  writeAssistantCronCanonicalRuntimeStore,
} from './cron/runtime-state.js'
import {
  ensureAssistantCronState,
  readAssistantCronStore,
  writeAssistantCronStore,
} from './cron/store.js'
import { resolveAssistantStatePaths } from './store/paths.js'

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
  const paths = resolveAssistantStatePaths(input.vault)
  const jobId = buildDailyFoodCronJobId(input.food.foodId)
  await ensureAssistantCronState(paths)

  await withAssistantCronWriteLock(paths, async () => {
    const [localStore, runtimeStore] = await Promise.all([
      readAssistantCronStore(paths),
      readAssistantCronCanonicalRuntimeStore(paths),
    ])

    const nextLocalJobs = localStore.jobs.filter(
      (job) => job.foodAutoLog?.foodId !== input.food.foodId,
    )
    const localChanged = nextLocalJobs.length !== localStore.jobs.length

    if (!input.food.autoLogDaily) {
      const runtimeChanged = removeAssistantCronCanonicalRuntimeRecord(runtimeStore, jobId)
      if (localChanged) {
        await writeAssistantCronStore(paths, {
          ...localStore,
          jobs: nextLocalJobs,
        })
      }
      if (runtimeChanged) {
        await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)
      }
      return
    }

    const existingRuntimeRecord = findAssistantCronCanonicalRuntimeRecord(
      runtimeStore,
      jobId,
    )
    if (!existingRuntimeRecord) {
      upsertAssistantCronCanonicalRuntimeRecord(
        runtimeStore,
        createAssistantCronCanonicalRuntimeRecord({
          jobId,
          now: new Date().toISOString(),
        }),
      )
    }

    if (localChanged) {
      await writeAssistantCronStore(paths, {
        ...localStore,
        jobs: nextLocalJobs,
      })
    }
    if (!existingRuntimeRecord) {
      await writeAssistantCronCanonicalRuntimeStore(paths, runtimeStore)
    }
  })

  if (!input.food.autoLogDaily) {
    return null
  }

  const job = await getAssistantCronJob(input.vault, jobId)
  return {
    jobId: job.jobId,
    name: job.name,
    state: {
      nextRunAt: job.state.nextRunAt,
    },
  }
}
