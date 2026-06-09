import type {
  AssistantCronJob,
  AssistantCronTrigger,
} from '@murphai/operator-config/assistant-cli-contracts'

import type { AssistantHostedDeliveryIdempotencyContext } from '../service-contracts.js'
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
    input.job.target.deliverySource?.kind ?? '',
    input.job.target.deliverySource?.fromPhoneNumber ?? '',
    input.job.target.identityId ?? '',
    input.job.target.participantId ?? '',
    input.job.target.threadId ?? '',
    input.job.target.deliveryTarget ?? '',
  ].join('|')
}

export function buildAssistantCronHostedDeliveryIdempotency(input: {
  job: Pick<AssistantCronJob, 'jobId' | 'state' | 'target'>
  trigger: AssistantCronTrigger
}): AssistantHostedDeliveryIdempotencyContext | null {
  const dueAt = normalizeNullableString(input.job.state.nextRunAt)
  if (input.trigger !== 'scheduled' || !dueAt) {
    return null
  }

  return {
    assistantTurnOrdinal: 'assistant-cron:1',
    conversationId: stringifyAssistantCronDeliveryKeyParts([
      input.job.target.channel,
      input.job.target.deliverySource?.kind,
      input.job.target.deliverySource?.fromPhoneNumber,
      input.job.target.identityId,
      input.job.target.participantId,
      input.job.target.threadId,
    ]),
    inboundMailboxItemIds: [
      stringifyAssistantCronDeliveryKeyParts([
        'assistant-cron',
        input.job.jobId,
        dueAt,
      ]),
    ],
    recipientKey: stringifyAssistantCronDeliveryKeyParts([
      input.job.target.channel,
      input.job.target.deliverySource?.kind,
      input.job.target.deliverySource?.fromPhoneNumber,
      input.job.target.deliveryTarget,
      input.job.target.identityId,
      input.job.target.participantId,
      input.job.target.threadId,
    ]),
  }
}

function stringifyAssistantCronDeliveryKeyParts(
  parts: readonly (null | string | undefined)[],
): string {
  return JSON.stringify(parts.map((part) => part ?? null))
}
