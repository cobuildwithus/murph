import type {
  AssistantCronJob,
  AssistantCronTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'

import { normalizeNullableString } from '../shared.js'

export function buildAssistantCronNotificationDedupeToken(input: {
  job: Pick<AssistantCronJob, 'jobId' | 'state' | 'target'>
  trigger: AssistantCronTrigger
}): string | null {
  if (input.trigger !== 'scheduled') {
    return null
  }

  const dueAt = normalizeNullableString(input.job.state.nextRunAt)
  if (!dueAt) {
    return null
  }

  return [
    'assistant-cron',
    input.job.jobId,
    dueAt,
    input.job.target.channel ?? '',
    input.job.target.identityId ?? '',
    input.job.target.participantId ?? '',
    input.job.target.sourceThreadId ?? '',
    input.job.target.deliveryTarget ?? '',
  ].join('|')
}
