import type {
  HostedRuntimeNewsletterScheduledAuthority,
  HostedRuntimeNewsletterToolResponse,
} from '@murphai/hosted-execution/runtime-control'
import type {
  AssistantOutboxIntent,
} from '@murphai/operator-config/assistant-cli-contracts'
import {
  parseHostedEmailThreadTarget,
  serializeHostedEmailThreadTarget,
} from '@murphai/runtime-state'

import type { AssistantHostedNewsletterTool } from './execution-context.js'
import {
  createAssistantOutboxIntent,
  listAssistantOutboxIntents,
} from './outbox.js'
import {
  buildGroupNewsletterDeliveryKey,
  classifyNewsletterRecipientFamily,
  type NewsletterRecipientGroup,
} from './newsletter-family.js'

type NewsletterPreparation = {
  authorizationProof: string
  authority: HostedRuntimeNewsletterScheduledAuthority
  automationAuthority: NonNullable<AssistantOutboxIntent['automationAuthority']>
  groupId: string
  participantMemberIds: string[]
  skippedNoEmailMemberIds: string[]
}

export function createAssistantNewsletterOutboxTool(input: {
  newsletterTool: AssistantHostedNewsletterTool
  recordDeliveryIntent?: (intent: Pick<AssistantOutboxIntent, 'intentId'>) => void
  sessionId: string
  turnId: string
  vault: string
}): AssistantHostedNewsletterTool & { closeCapability(): void } {
  let prepareAttempted = false
  let sendAttempted = false
  let preparation: NewsletterPreparation | null = null
  const closeCapability = () => {
    preparation = null
    prepareAttempted = true
    sendAttempted = true
  }

  return {
    closeCapability,
    async request(request) {
      if (request.action === 'prepare') {
        if (prepareAttempted || sendAttempted) {
          closeCapability()
          return newsletterUnavailable('prepare', 'newsletter_capability_consumed')
        }
        prepareAttempted = true
        const authority = normalizeNewsletterScheduledAuthority(
          request.scheduledAutomationAuthority,
        )
        if (!authority) {
          closeCapability()
          return newsletterUnavailable('prepare', 'scheduled_automation_required')
        }
        const result = await input.newsletterTool.request({
          action: 'prepare',
        })
        if (
          result.action === 'prepare'
          && result.result.status === 'ok'
        ) {
          preparation = {
            authorizationProof: result.result.authorizationProof,
            authority,
            automationAuthority: {
              automationId: authority.automationId,
              expectedUpdatedAt: authority.expectedUpdatedAt,
            },
            groupId: result.result.groupId,
            participantMemberIds: result.result.participants
              .filter((participant) => participant.hasEmail)
              .map((participant) => participant.memberId),
            skippedNoEmailMemberIds: result.result.participants
              .filter((participant) => !participant.hasEmail)
              .map((participant) => participant.memberId),
          }
        }
        return result
      }

      if (sendAttempted) {
        return newsletterUnavailable('send', 'newsletter_capability_consumed')
      }
      sendAttempted = true
      const prepared = preparation
      preparation = null
      const authority = normalizeNewsletterScheduledAuthority(
        request.scheduledAutomationAuthority,
      )
      if (!authority) {
        return newsletterUnavailable('send', 'scheduled_automation_required')
      }
      if (
        !prepared
        || prepared.authority.automationId !== authority.automationId
        || prepared.authority.expectedUpdatedAt !== authority.expectedUpdatedAt
        || prepared.authority.occurrenceAt !== authority.occurrenceAt
      ) {
        return newsletterUnavailable('send', 'newsletter_preparation_required')
      }
      if (prepared.participantMemberIds.length === 0) {
        return {
          action: 'send',
          result: {
            participantCount: 0,
            skippedNoEmailMemberIds: prepared.skippedNoEmailMemberIds,
            status: 'no_recipients',
          },
        }
      }

      const deliveryIdempotencyKey = buildGroupNewsletterDeliveryKey({
        automationId: prepared.authority.automationId,
        groupId: prepared.groupId,
        occurrenceAt: prepared.authority.occurrenceAt,
      })
      const intents = await listAssistantOutboxIntents(input.vault)
      const currentIntents = intents.filter(
        (intent) => intent.deliveryIdempotencyKey === deliveryIdempotencyKey,
      )
      const parentIntents = currentIntents
        .filter(isNewsletterParentIntent)
        .sort(compareOutboxIntentCreationOrder)
      const activeParent = parentIntents.find(isActiveOutboxIntent)
      if (activeParent) {
        input.recordDeliveryIntent?.({ intentId: activeParent.intentId })
        return newsletterAccepted(prepared)
      }

      const sentParent = parentIntents.find((intent) => intent.status === 'sent')
      if (sentParent) {
        const recipientFamily = classifyNewsletterRecipientFamily(currentIntents)
        if (
          recipientFamily.some((recipient) => recipient.state === 'active')
        ) {
          input.recordDeliveryIntent?.({ intentId: sentParent.intentId })
          return newsletterAccepted(prepared)
        }

        if (sentParent.newsletterAuthorizationProof !== prepared.authorizationProof) {
          return resolveTerminalNewsletterResult({
            preparation: prepared,
            recipientFamily,
            treatSafelyReplayableFailuresAsTerminal: true,
          })
        }

        const recreatedRecipientCount = await createRetryRecipientIntentsFromParent({
          deliveryIdempotencyKey,
          parent: sentParent,
          participantMemberIds: prepared.participantMemberIds,
          recipientFamily,
          vault: input.vault,
        })
        if (recreatedRecipientCount > 0) {
          input.recordDeliveryIntent?.({ intentId: sentParent.intentId })
          return newsletterAccepted(prepared)
        }

        return resolveTerminalNewsletterResult({
          preparation: prepared,
          recipientFamily,
          treatSafelyReplayableFailuresAsTerminal: false,
        })
      }

      if (parentIntents.some(isRetryExhaustedTerminalIntent)) {
        return newsletterRetryExhausted(prepared)
      }

      const parentIntent = await createAssistantOutboxIntent({
        automationAuthority: prepared.automationAuthority,
        channel: 'email',
        dedupeToken: [
          'group-newsletter-parent',
          deliveryIdempotencyKey,
          `attempt-${parentIntents.length}`,
        ].join(':'),
        deliveryIdempotencyKey,
        emailHtml: request.html,
        explicitTarget: serializeHostedEmailThreadTarget({
          groupId: prepared.groupId,
          subject: request.subject,
          targetKind: 'group',
        }),
        message: request.text ?? 'Open this email in an HTML-capable mail client.',
        newsletterAuthorizationProof: prepared.authorizationProof,
        sessionId: input.sessionId,
        subject: null,
        threadIsDirect: false,
        turnId: input.turnId,
        vault: input.vault,
      })
      input.recordDeliveryIntent?.({ intentId: parentIntent.intentId })
      return newsletterAccepted(prepared)
    },
  }
}

function normalizeNewsletterScheduledAuthority(
  authority: HostedRuntimeNewsletterScheduledAuthority | null | undefined,
): HostedRuntimeNewsletterScheduledAuthority | null {
  if (
    !authority
    || authority.automationId.trim().length === 0
    || !Number.isFinite(Date.parse(authority.expectedUpdatedAt))
    || !Number.isFinite(Date.parse(authority.occurrenceAt))
  ) {
    return null
  }
  return authority
}

function newsletterAccepted(
  preparation: NewsletterPreparation,
): HostedRuntimeNewsletterToolResponse {
  return {
    action: 'send',
    result: {
      participantCount: preparation.participantMemberIds.length,
      skippedNoEmailMemberIds: preparation.skippedNoEmailMemberIds,
      status: 'accepted',
    },
  }
}

function newsletterUnavailable(
  action: 'prepare' | 'send',
  unavailableReason: string,
): HostedRuntimeNewsletterToolResponse {
  return {
    action,
    result: { status: 'unavailable', unavailableReason },
  }
}

function newsletterRetryExhausted(
  preparation: NewsletterPreparation,
): HostedRuntimeNewsletterToolResponse {
  return {
    action: 'send',
    result: {
      failedRecipientCount: preparation.participantMemberIds.length,
      participantCount: preparation.participantMemberIds.length,
      sentRecipientCount: 0,
      skippedNoEmailMemberIds: preparation.skippedNoEmailMemberIds,
      status: 'partial_failure',
    },
  }
}

function resolveTerminalNewsletterResult(input: {
  preparation: NewsletterPreparation
  recipientFamily: readonly NewsletterRecipientGroup[]
  treatSafelyReplayableFailuresAsTerminal: boolean
}): HostedRuntimeNewsletterToolResponse {
  const sentRecipientCount = input.recipientFamily.filter(
    (recipient) => recipient.state === 'sent',
  ).length
  const failedRecipientCount = input.recipientFamily.filter(
    (recipient) =>
      recipient.state === 'non_replayable' ||
      (
        input.treatSafelyReplayableFailuresAsTerminal &&
        recipient.state === 'safely_replayable'
      ),
  ).length
  if (failedRecipientCount === 0) {
    return {
      action: 'send',
      result: {
        participantCount: input.preparation.participantMemberIds.length,
        skippedNoEmailMemberIds: input.preparation.skippedNoEmailMemberIds,
        status: 'sent',
      },
    }
  }
  return {
    action: 'send',
    result: {
      failedRecipientCount,
      participantCount: input.preparation.participantMemberIds.length,
      sentRecipientCount,
      skippedNoEmailMemberIds: input.preparation.skippedNoEmailMemberIds,
      status: 'partial_failure',
    },
  }
}

async function createRetryRecipientIntentsFromParent(input: {
  deliveryIdempotencyKey: string
  parent: AssistantOutboxIntent
  participantMemberIds: readonly string[]
  recipientFamily: readonly NewsletterRecipientGroup[]
  vault: string
}): Promise<number> {
  const parentTarget = parseHostedEmailThreadTarget(input.parent.explicitTarget)
  if (!parentTarget || parentTarget.targetKind !== 'group' || !parentTarget.groupId) {
    return 0
  }

  let createdCount = 0
  for (const memberId of input.participantMemberIds) {
    const recipient = input.recipientFamily.find(
      (entry) => entry.memberId === memberId,
    )
    if (!recipient || recipient.state !== 'safely_replayable') {
      continue
    }
    const existingRecipientIntents = recipient.intents

    await createAssistantOutboxIntent({
      actorId: input.parent.actorId,
      answeredMailboxItemIds: input.parent.answeredMailboxItemIds,
      automationAuthority: input.parent.automationAuthority ?? null,
      channel: 'email',
      dedupeToken: [
        'hosted-email-group-recipient',
        input.parent.intentId,
        memberId,
        `retry-${existingRecipientIntents.length}`,
      ].join(':'),
      deliveryIdempotencyKey: input.deliveryIdempotencyKey,
      deliveryTransportIdempotent: false,
      explicitTarget: serializeHostedEmailThreadTarget({
        ...parentTarget,
        recipientMemberId: memberId,
      }),
      identityId: input.parent.identityId,
      media: [],
      message: input.parent.message,
      emailHtml: input.parent.emailHtml ?? null,
      newsletterAuthorizationProof: input.parent.newsletterAuthorizationProof ?? null,
      replyToMessageId: input.parent.replyToMessageId,
      sessionId: input.parent.sessionId,
      subject: null,
      threadId: input.parent.threadId,
      threadIsDirect: false,
      turnId: input.parent.turnId,
      vault: input.vault,
    })
    createdCount += 1
  }
  return createdCount
}

function isNewsletterParentIntent(intent: AssistantOutboxIntent): boolean {
  const target = parseHostedEmailThreadTarget(intent.explicitTarget)
  return target?.targetKind === 'group' && target.recipientMemberId === null
}

function compareOutboxIntentCreationOrder(
  left: AssistantOutboxIntent,
  right: AssistantOutboxIntent,
): number {
  return left.createdAt.localeCompare(right.createdAt)
    || left.intentId.localeCompare(right.intentId)
}

function isActiveOutboxIntent(intent: AssistantOutboxIntent): boolean {
  return intent.status === 'awaiting_approval'
    || intent.status === 'pending'
    || intent.status === 'retryable'
    || intent.status === 'sending'
}

function isRetryExhaustedTerminalIntent(intent: AssistantOutboxIntent): boolean {
  return (intent.status === 'failed' || intent.status === 'abandoned')
    && intent.lastError?.code === 'ASSISTANT_DELIVERY_RETRY_EXHAUSTED'
}
