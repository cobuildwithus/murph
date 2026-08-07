import { createHash } from 'node:crypto'
import type {
  AssistantSession,
} from '@murphai/operator-config/assistant-cli-contracts'
import type {
  AssistantCodexTurnPromptProfile,
  AssistantCodexTurnToolProfile,
} from './codex-turn/planning.js'
import {
  isHostedProductSupportEscalationFeedback,
  type HostedRuntimeProductFeedbackRecord,
} from '@murphai/hosted-execution/runtime-control'
import {
  deliverAssistantProgressUpdate,
} from './delivery-service.js'
import {
  MAX_PROGRESS_UPDATES_PER_TURN,
  shouldCreateAssistantProgressDelivery,
} from './progress-constants.js'
import {
  normalizeNullableString,
  warnAssistantBestEffortFailure,
} from './shared.js'
import type {
  AssistantAcceptedTurnInputItemInput,
  AssistantAcceptedTurnInputSource,
} from './active-turn-input-journal.js'
import type {
  AssistantMessageInput,
  AssistantTurnSharedPlan,
} from './service-contracts.js'
import type {
  AssistantHostedProductFeedbackCandidateSink,
} from './execution-context.js'


export interface AssistantProgressDelivery {
  close?(): void
  send(
    text: string,
    options?: AssistantProgressDeliverySendOptions,
  ): Promise<AssistantProgressDeliveryResult>
}

export interface AssistantTurnProductFeedbackRecorder {
  recordProductFeedback(
    feedback: Omit<HostedRuntimeProductFeedbackRecord, 'idempotencyKey'>,
  ): Promise<{ recorded: boolean }>
  discardProductFeedback(): void
  readProductFeedback(): HostedRuntimeProductFeedbackRecord | null
}

export type AssistantProgressDeliverySource = 'model' | 'system'

export interface AssistantProgressDeliverySendOptions {
  deliveryContextOrdinal?: number
  required?: boolean
  source?: AssistantProgressDeliverySource
}

export type AssistantProgressDeliveryResult =
  | { kind: 'sent'; source: AssistantProgressDeliverySource }
  | {
      kind: 'skipped'
      reason: 'duplicate' | 'empty' | 'limit' | 'unavailable'
      source: AssistantProgressDeliverySource
    }
  | { kind: 'failed'; source: AssistantProgressDeliverySource }

type DeliverAssistantProgressUpdate = typeof deliverAssistantProgressUpdate
type AssistantProgressDeliveryContext = {
  messageInput: AssistantMessageInput
  session: AssistantSession
}
type AssistantProgressDeliverInput =
  Parameters<DeliverAssistantProgressUpdate>[0] & {
    deliveryContextOrdinal?: number
  }
type AssistantProgressDeliver = (
  input: AssistantProgressDeliverInput
) => ReturnType<DeliverAssistantProgressUpdate>

// Progress updates are best-effort and every suppressed send used to vanish
// without a trace, which made "model says sent, user saw nothing" undebuggable.
// Log one line per send attempt outcome; never include the update text itself.
function logAssistantProgressSendOutcome(details: {
  ordinal: number
  outcome: string
  source: string
  textLength: number
  turnId: string
}): void {
  console.warn(
    `Assistant progress update ${details.outcome} ` +
    `(turn=${details.turnId} ordinal=${details.ordinal} source=${details.source} textLength=${details.textLength}).`,
  )
}

export { shouldCreateAssistantProgressDelivery } from './progress-constants.js'

export function createAssistantProductFeedbackRecorder(input: {
  acceptedInputItems?: readonly AssistantAcceptedTurnInputItemInput[] | null
  getAcceptedInputIds?: (() => readonly string[]) | null
  productFeedbackCandidateSink?: AssistantHostedProductFeedbackCandidateSink | null
}): AssistantTurnProductFeedbackRecorder | null {
  const productFeedbackCandidateSink = input.productFeedbackCandidateSink ?? null
  const initialAcceptedInputIds = resolveAssistantProductFeedbackAcceptedInputIds(
    input.acceptedInputItems ?? [],
  )
  if (!productFeedbackCandidateSink || initialAcceptedInputIds.length === 0) {
    return null
  }

  let productFeedback: HostedRuntimeProductFeedbackRecord | null = null
  let supportEscalationOutcome:
    | 'unattempted'
    | 'attempting'
    | 'delivered'
    | 'failed' = 'unattempted'
  return {
    async recordProductFeedback(feedback) {
      const normalized = normalizeAssistantProductFeedback(feedback)
      const supportEscalation = isHostedProductSupportEscalationFeedback(normalized)
      if (supportEscalation) {
        if (supportEscalationOutcome === 'delivered') {
          return { recorded: false }
        }
        if (supportEscalationOutcome !== 'unattempted') {
          throw new Error('Product support escalation is unavailable for this turn.')
        }
      }
      if (
        productFeedback
        && (
          !supportEscalation
          || isHostedProductSupportEscalationFeedback(productFeedback)
        )
      ) {
        return { recorded: false }
      }
      const acceptedInputIds = input.getAcceptedInputIds?.()
        ?? initialAcceptedInputIds
      const candidate = {
        ...normalized,
        idempotencyKey: buildAssistantProductFeedbackIdempotencyKey({
          acceptedInputIds,
          feedback: normalized,
        }),
      }
      const deliverSupportEscalation =
        productFeedbackCandidateSink.deliverProductSupportEscalation
      if (supportEscalation && deliverSupportEscalation) {
        // Durable-before-confirmation: the support promise ("queued") must be
        // backed by the Web record before the model may state it, so this path
        // waits on the callback instead of joining the best-effort post-reply
        // candidate flush. The first attempt is terminal for this turn, so a
        // same-turn ordinary candidate cannot become a fallback after an
        // ambiguous callback failure.
        supportEscalationOutcome = 'attempting'
        productFeedback = null
        try {
          const delivered = await deliverSupportEscalation(candidate)
          supportEscalationOutcome = 'delivered'
          return { recorded: delivered.recorded }
        } catch (error) {
          supportEscalationOutcome = 'failed'
          throw error
        }
      }
      productFeedback = candidate
      return { recorded: true }
    },
    discardProductFeedback() {
      productFeedback = null
    },
    readProductFeedback() {
      return productFeedback
    },
  }
}

export function isAssistantProductFeedbackAcceptedInputEligible(
  source: AssistantAcceptedTurnInputSource,
): boolean {
  return source === 'assistant-input'
}

export function resolveAssistantProductFeedbackAcceptedInputIds(
  acceptedInputItems: readonly AssistantAcceptedTurnInputItemInput[],
): readonly string[] {
  return acceptedInputItems
    .filter((item) => isAssistantProductFeedbackAcceptedInputEligible(item.source))
    .map((item) => item.id)
}

export function createAssistantProgressDelivery(input: {
  deliver?: AssistantProgressDeliver
  getDeliveryContext?: () => AssistantProgressDeliveryContext
  messageInput: AssistantMessageInput
  onDeliveredSession?: (session: AssistantSession) => void
  session: AssistantSession
  sharedPlan: AssistantTurnSharedPlan
  turnId: string
}): AssistantProgressDelivery {
  const deliver = input.deliver ?? deliverAssistantProgressUpdate
  const abortController = new AbortController()
  const sentTexts = new Set<string>()
  let sentCount = 0
  let deliveryOrdinal = 0

  return {
    async send(rawText: string, options?: AssistantProgressDeliverySendOptions) {
      const source = options?.source ?? 'model'
      const required = options?.required === true
      const logOutcome = (outcome: string) =>
        logAssistantProgressSendOutcome({
          ordinal: deliveryOrdinal,
          outcome,
          source,
          textLength: rawText.length,
          turnId: input.turnId,
        })
      if (abortController.signal.aborted) {
        logOutcome('failed: delivery already closed')
        return {
          kind: 'failed',
          source,
        }
      }
      const text = normalizeAssistantProgressText(rawText)
      if (!text || (!required && sentTexts.has(text))) {
        logOutcome(`skipped: ${text ? 'duplicate' : 'empty'}`)
        return {
          kind: 'skipped',
          reason: text ? 'duplicate' : 'empty',
          source,
        }
      }
      const deliveryContext = input.getDeliveryContext?.() ?? {
        messageInput: input.messageInput,
        session: input.session,
      }
      if (!shouldCreateAssistantProgressDelivery(deliveryContext.messageInput)) {
        logOutcome(
          'skipped: unavailable ' +
          `(deliverResponse=${String(deliveryContext.messageInput.deliverResponse)} ` +
          `dispatchMode=${String(deliveryContext.messageInput.deliveryDispatchMode)} ` +
          `channel=${String(deliveryContext.messageInput.channel)})`,
        )
        return {
          kind: 'skipped',
          reason: 'unavailable',
          source,
        }
      }
      if (!required && sentCount >= MAX_PROGRESS_UPDATES_PER_TURN) {
        logOutcome(`skipped: limit (${sentCount}/${MAX_PROGRESS_UPDATES_PER_TURN})`)
        return {
          kind: 'skipped',
          reason: 'limit',
          source,
        }
      }
      const ordinal = deliveryOrdinal
      deliveryOrdinal += 1
      if (!required) {
        sentCount += 1
        sentTexts.add(text)
      }

      try {
        const progressInput: AssistantProgressDeliverInput = {
          ...(options?.deliveryContextOrdinal === undefined
            ? {}
            : {
                deliveryContextOrdinal: options.deliveryContextOrdinal,
              }),
          input: deliveryContext.messageInput,
          ordinal,
          session: deliveryContext.session,
          signal: abortController.signal,
          sharedPlan: input.sharedPlan,
          text,
          turnId: input.turnId,
        }
        const deliveredSession = await deliver(progressInput)
        input.onDeliveredSession?.(deliveredSession)
        logOutcome('sent')
        return {
          kind: 'sent',
          source,
        }
      } catch (error) {
        warnAssistantBestEffortFailure({
          error,
          operation: 'progress update delivery',
        })
        logOutcome('failed: delivery threw')
        return {
          kind: 'failed',
          source,
        }
      }
    },
    close() {
      abortController.abort()
    },
  }
}

export function buildAssistantProductFeedbackIdempotencyKey(input: {
  acceptedInputIds: readonly string[]
  feedback: Omit<HostedRuntimeProductFeedbackRecord, 'idempotencyKey'>
}): string {
  const latestAcceptedInputId = input.acceptedInputIds.at(-1)
  return createHash('sha256')
    .update(JSON.stringify({
      acceptedInputIds: latestAcceptedInputId ? [latestAcceptedInputId] : [],
      kind: input.feedback.kind,
      relatedChangelogItemIds: [...new Set(input.feedback.relatedChangelogItemIds)].sort(),
    }))
    .digest('hex')
}

function normalizeAssistantProductFeedback(
  feedback: Omit<HostedRuntimeProductFeedbackRecord, 'idempotencyKey'>,
): Omit<HostedRuntimeProductFeedbackRecord, 'idempotencyKey'> {
  return {
    kind: feedback.kind,
    relatedChangelogItemIds: [...new Set(feedback.relatedChangelogItemIds)],
    summary: feedback.summary,
  }
}

export function normalizeAssistantProgressText(rawText: string): string | null {
  const withoutMarkdownLinks = rawText.replace(/\[([^\]\n]+)\]\([^)]+\)/gu, '$1')
  const normalized = normalizeNullableString(
    withoutMarkdownLinks.replace(/\s+/gu, ' '),
  )
  if (!normalized) {
    return null
  }
  return normalized
}
