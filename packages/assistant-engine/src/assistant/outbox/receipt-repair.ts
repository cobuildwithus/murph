import type {
  AssistantDeliveryError,
  AssistantOutboxIntent,
  AssistantTurnReceipt,
  AssistantTurnTimelineEventKind,
} from '@murphai/operator-config/assistant-cli-contracts'
import { sanitizeAssistantDeliveryErrorForPersistence } from '../redaction.js'
import { updateAssistantTurnReceipt } from '../turns.js'

const ASSISTANT_VAULT_FILE_SEND_CANCELLED_CODE =
  'ASSISTANT_VAULT_FILE_SEND_CANCELLED'

export async function repairAssistantOutboxReceiptForIntent(input: {
  at?: string
  intent: AssistantOutboxIntent
  vault: string
}): Promise<void> {
  const repair = buildAssistantOutboxReceiptRepair(input.intent, input.at)
  if (!repair) {
    return
  }

  await updateAssistantTurnReceipt({
    vault: input.vault,
    turnId: input.intent.turnId,
    mutate(receipt) {
      const hasEvent = receipt.timeline.some((event) =>
        isSameAssistantOutboxReceiptRepairEvent({
          event,
          intentId: input.intent.intentId,
          repair,
        }),
      )
      const updatedAt = laterAssistantTimestamp(receipt.updatedAt, repair.at) ?? repair.at
      const completedAt = laterAssistantTimestamp(
        receipt.completedAt,
        repair.completedAt,
      )

      return {
        ...receipt,
        updatedAt,
        completedAt,
        deliveryDisposition: repair.deliveryDisposition,
        deliveryIntentId: input.intent.intentId,
        lastError: repair.lastError,
        status:
          repair.eventKind === 'delivery.sent' && receipt.status === 'failed'
            ? 'failed'
            : repair.status ?? receipt.status,
        timeline: hasEvent
          ? receipt.timeline
          : [
              ...receipt.timeline,
              {
                at: repair.at,
                kind: repair.eventKind,
                detail: repair.detail,
                metadata: repair.metadata,
              },
            ],
      }
    },
  })
}

function isSameAssistantOutboxReceiptRepairEvent(input: {
  event: AssistantTurnReceipt['timeline'][number]
  intentId: string
  repair: NonNullable<ReturnType<typeof buildAssistantOutboxReceiptRepair>>
}): boolean {
  if (
    input.event.kind !== input.repair.eventKind ||
    input.event.metadata.intentId !== input.intentId
  ) {
    return false
  }

  if (input.repair.eventKind === 'delivery.queued' || input.repair.eventKind === 'delivery.sent') {
    return true
  }

  if (input.repair.eventKind === 'delivery.attempt.started') {
    return (
      input.event.at === input.repair.at &&
      input.event.metadata.attempt === input.repair.metadata.attempt
    )
  }

  return input.event.at === input.repair.at
}

function buildAssistantOutboxReceiptRepair(
  intent: AssistantOutboxIntent,
  atOverride?: string,
): {
  at: string
  completedAt: string | null
  deliveryDisposition: AssistantTurnReceipt['deliveryDisposition']
  detail: string | null
  eventKind: AssistantTurnTimelineEventKind
  lastError: AssistantDeliveryError | null
  metadata: Record<string, string>
  status: AssistantTurnReceipt['status'] | null
} | null {
  if (
    intent.status === 'abandoned'
    && intent.lastError?.code === ASSISTANT_VAULT_FILE_SEND_CANCELLED_CODE
  ) {
    return null
  }

  const at = atOverride ?? intent.updatedAt
  const channel = intent.channel ?? 'unknown'

  if (intent.status === 'awaiting_approval' || intent.status === 'pending') {
    return {
      at,
      completedAt: null,
      deliveryDisposition: 'queued',
      detail:
        intent.status === 'awaiting_approval'
          ? 'outbound delivery awaiting secure approval'
          : 'outbound delivery queued',
      eventKind: 'delivery.queued',
      lastError: null,
      metadata: {
        channel,
        intentId: intent.intentId,
      },
      status: null,
    }
  }

  if (intent.status === 'sending') {
    return {
      at,
      completedAt: null,
      deliveryDisposition: 'queued',
      detail: `attempt ${intent.attemptCount}`,
      eventKind: 'delivery.attempt.started',
      lastError: intent.lastError,
      metadata: {
        attempt: String(intent.attemptCount),
        intentId: intent.intentId,
      },
      status: null,
    }
  }

  if (intent.status === 'sent' && intent.delivery) {
    return {
      at: intent.sentAt ?? at,
      completedAt: intent.sentAt ?? at,
      deliveryDisposition: 'sent',
      detail: intent.delivery.target,
      eventKind: 'delivery.sent',
      lastError: null,
      metadata: {
        channel: intent.delivery.channel,
        intentId: intent.intentId,
        target: intent.delivery.target,
      },
      status: 'completed',
    }
  }

  if (intent.status === 'retryable') {
    return {
      at,
      completedAt: null,
      deliveryDisposition: 'retryable',
      detail: intent.lastError?.message ?? 'outbound delivery retry scheduled',
      eventKind: 'delivery.retry-scheduled',
      lastError: sanitizeAssistantDeliveryErrorForPersistence(intent.lastError),
      metadata: {
        intentId: intent.intentId,
        retryable: 'true',
      },
      status: 'deferred',
    }
  }

  if (intent.status === 'failed' || intent.status === 'abandoned') {
    return {
      at,
      completedAt: at,
      deliveryDisposition: 'failed',
      detail: intent.lastError?.message ?? 'outbound delivery failed',
      eventKind: 'delivery.failed',
      lastError: sanitizeAssistantDeliveryErrorForPersistence(intent.lastError),
      metadata: {
        intentId: intent.intentId,
        retryable: 'false',
      },
      status: 'failed',
    }
  }

  return null
}

function laterAssistantTimestamp(
  left: string | null | undefined,
  right: string | null | undefined,
): string | null {
  if (!left) {
    return right ?? null
  }
  if (!right) {
    return left
  }

  return Date.parse(right) > Date.parse(left) ? right : left
}
