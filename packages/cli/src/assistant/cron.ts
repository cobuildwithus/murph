import {
  maybeGetAssistantCronJobViaDaemon,
  maybeGetAssistantCronTargetViaDaemon,
  maybeGetAssistantCronStatusViaDaemon,
  maybeListAssistantCronJobsViaDaemon,
  maybeListAssistantCronRunsViaDaemon,
  maybeProcessDueAssistantCronViaDaemon,
  maybeSetAssistantCronTargetViaDaemon,
} from '../assistant-daemon-client.js'
import {
  getAssistantCronJob as getAssistantCronJobLocal,
  getAssistantCronJobTarget as getAssistantCronJobTargetLocal,
  getAssistantCronStatus as getAssistantCronStatusLocal,
  listAssistantCronJobs as listAssistantCronJobsLocal,
  listAssistantCronRuns as listAssistantCronRunsLocal,
  processDueAssistantCronJobsLocal,
  setAssistantCronJobTarget as setAssistantCronJobTargetLocal,
} from '@murphai/assistant-core/assistant-cron'
import type {
  AssistantCronJob,
  AssistantCronRunRecord,
  AssistantCronTargetSnapshot,
} from '@murphai/assistant-core/assistant-cli-contracts'

export * from '@murphai/assistant-core/assistant-cron'
export type {
  AssistantCronJob,
  AssistantCronRunRecord,
  AssistantCronTargetSnapshot,
} from '@murphai/assistant-core/assistant-cli-contracts'

export async function listAssistantCronJobs(
  vault: string,
): Promise<AssistantCronJob[]> {
  const remote = await maybeListAssistantCronJobsViaDaemon({ vault })
  if (remote !== null) {
    return remote
  }

  return listAssistantCronJobsLocal(vault)
}

export async function getAssistantCronJob(
  vault: string,
  job: string,
): Promise<AssistantCronJob> {
  const remote = await maybeGetAssistantCronJobViaDaemon({
    job,
    vault,
  })
  if (remote) {
    return remote
  }

  return getAssistantCronJobLocal(vault, job)
}

export async function getAssistantCronJobTarget(
  vault: string,
  job: string,
): Promise<AssistantCronTargetSnapshot> {
  const remote = await maybeGetAssistantCronTargetViaDaemon({
    job,
    vault,
  })
  if (remote) {
    return remote
  }

  return getAssistantCronJobTargetLocal(vault, job)
}

export async function setAssistantCronJobTarget(
  input: Parameters<typeof setAssistantCronJobTargetLocal>[0],
): Promise<Awaited<ReturnType<typeof setAssistantCronJobTargetLocal>>> {
  const remote = await maybeSetAssistantCronTargetViaDaemon(input)
  if (remote) {
    return remote
  }

  return setAssistantCronJobTargetLocal(input)
}

export async function getAssistantCronStatus(
  vault: string,
): Promise<Awaited<ReturnType<typeof getAssistantCronStatusLocal>>> {
  const remote = await maybeGetAssistantCronStatusViaDaemon({ vault })
  if (remote) {
    return remote
  }

  return getAssistantCronStatusLocal(vault)
}

export async function listAssistantCronRuns(input: {
  job: string
  limit?: number
  vault: string
}): Promise<{
  jobId: string
  runs: AssistantCronRunRecord[]
}> {
  const remote = await maybeListAssistantCronRunsViaDaemon(input)
  if (remote !== null) {
    return remote
  }

  return listAssistantCronRunsLocal(input)
}

export async function processDueAssistantCronJobs(
  input: Parameters<typeof processDueAssistantCronJobsLocal>[0],
): Promise<Awaited<ReturnType<typeof processDueAssistantCronJobsLocal>>> {
  const remote = await maybeProcessDueAssistantCronViaDaemon(input)
  if (remote) {
    return remote
  }

  return processDueAssistantCronJobsLocal(input)
}
