import type {
  AssistantCronJob,
} from '@murphai/operator-config/assistant-cli-contracts'
import { computeAssistantCronNextRunAt } from './schedule.js'

export function resolveAssistantCronNextRunAfterSuccess(
  job: AssistantCronJob,
  now: Date,
): string | null {
  if (!job.enabled) {
    return job.state.nextRunAt
  }

  if (job.schedule.kind === 'at') {
    return null
  }

  return computeAssistantCronNextRunAt(job.schedule, now)
}

export function resolveAssistantCronFailureBackoffMs(failureCount: number): number {
  if (failureCount <= 1) {
    return 30_000
  }

  if (failureCount === 2) {
    return 60_000
  }

  if (failureCount === 3) {
    return 5 * 60_000
  }

  if (failureCount === 4) {
    return 15 * 60_000
  }

  return 60 * 60_000
}
