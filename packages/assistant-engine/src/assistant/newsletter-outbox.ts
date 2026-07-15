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

type NewsletterPreparation = {
  authorizationProof: string
  authority: HostedRuntimeNewsletterScheduledAuthority
  groupId: string
  participantMemberIds: string[]
  skippedNoEmailMemberIds: string[]
}

export function createAssistantNewsletterOutboxTool(input: {
  authority: HostedRuntimeNewsletterScheduledAuthority | null
  newsletterTool: AssistantHostedNewsletterTool
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
        const result = await input.newsletterTool.request({
          action: 'prepare',
          groupId: request.groupId,
        })
        if (
          input.authority
          && result.action === 'prepare'
          && result.result.status === 'ok'
        ) {
          preparation = {
            authorizationProof: result.result.authorizationProof,
            authority: input.authority,
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
      if (!input.authority) {
        return newsletterUnavailable('send', 'scheduled_automation_required')
      }
      if (
        !prepared
        || prepared.groupId !== request.groupId
        || prepared.authority.automationId !== input.authority.automationId
        || prepared.authority.occurrenceAt !== input.authority.occurrenceAt
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

      const deliveryIdempotencyKey = buildNewsletterDeliveryIdempotencyKey({
        authority: prepared.authority,
        groupId: prepared.groupId,
      })
      const intents = await listAssistantOutboxIntents(input.vault)
      const currentIntents = intents.filter(
        (intent) => intent.deliveryIdempotencyKey === deliveryIdempotencyKey,
      )
      const parentIntents = currentIntents
        .filter(isNewsletterParentIntent)
        .sort(compareOutboxIntentCreationOrder)
      if (parentIntents.some(isActiveOutboxIntent)) {
        return newsletterAccepted(prepared)
      }

      const sentParent = parentIntents.find((intent) => intent.status === 'sent')
      if (sentParent) {
        const recipientIntentGroups = groupNewsletterRecipientIntents(currentIntents)
        if (
          [...recipientIntentGroups.values()].some((recipientIntents) =>
            recipientIntents.some(isActiveOutboxIntent)
          )
        ) {
          return newsletterAccepted(prepared)
        }

        if (sentParent.newsletterAuthorizationProof !== prepared.authorizationProof) {
          return resolveTerminalNewsletterResult({
            preparation: prepared,
            recipientIntentGroups,
            treatSafelyReplayableFailuresAsTerminal: true,
          })
        }

        const recreatedRecipientCount = await createRetryRecipientIntentsFromParent({
          deliveryIdempotencyKey,
          parent: sentParent,
          participantMemberIds: prepared.participantMemberIds,
          recipientIntentGroups,
          vault: input.vault,
        })
        if (recreatedRecipientCount > 0) {
          return newsletterAccepted(prepared)
        }

        return resolveTerminalNewsletterResult({
          preparation: prepared,
          recipientIntentGroups,
          treatSafelyReplayableFailuresAsTerminal: false,
        })
      }

      await createAssistantOutboxIntent({
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
      return newsletterAccepted(prepared)
    },
  }
}

function buildNewsletterDeliveryIdempotencyKey(input: {
  authority: HostedRuntimeNewsletterScheduledAuthority
  groupId: string
}): string {
  return [
    'group-newsletter',
    input.authority.automationId,
    input.authority.occurrenceAt,
    input.groupId,
  ].join(':')
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

function resolveTerminalNewsletterResult(input: {
  preparation: NewsletterPreparation
  recipientIntentGroups: ReadonlyMap<string, readonly AssistantOutboxIntent[]>
  treatSafelyReplayableFailuresAsTerminal: boolean
}): HostedRuntimeNewsletterToolResponse {
  const recipientIntentGroups = [...input.recipientIntentGroups.values()]
  const sentRecipientCount = recipientIntentGroups.filter((intents) =>
    intents.some((intent) => intent.status === 'sent')
  ).length
  const failedRecipientCount = recipientIntentGroups.filter((intents) =>
    !intents.some((intent) => intent.status === 'sent')
    && intents.some((intent) =>
      intent.lastError?.code === 'ASSISTANT_DELIVERY_AMBIGUOUS'
      || (
        input.treatSafelyReplayableFailuresAsTerminal
        && isSafelyReplayableTerminalIntent(intent)
      )
    )
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
  recipientIntentGroups: ReadonlyMap<string, readonly AssistantOutboxIntent[]>
  vault: string
}): Promise<number> {
  const parentTarget = parseHostedEmailThreadTarget(input.parent.explicitTarget)
  if (!parentTarget || parentTarget.targetKind !== 'group' || !parentTarget.groupId) {
    return 0
  }

  let createdCount = 0
  for (const memberId of input.participantMemberIds) {
    const existingRecipientIntents = input.recipientIntentGroups.get(memberId) ?? []
    if (existingRecipientIntents.length === 0) {
      continue
    }
    if (existingRecipientIntents.some(isNonReplayableRecipientIntent)) {
      continue
    }
    if (!existingRecipientIntents.every(isSafelyReplayableTerminalIntent)) {
      continue
    }

    await createAssistantOutboxIntent({
      actorId: input.parent.actorId,
      answeredMailboxItemIds: input.parent.answeredMailboxItemIds,
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

function groupNewsletterRecipientIntents(
  intents: readonly AssistantOutboxIntent[],
): Map<string, AssistantOutboxIntent[]> {
  const grouped = new Map<string, AssistantOutboxIntent[]>()
  for (const intent of intents) {
    const memberId = parseHostedEmailThreadTarget(
      intent.explicitTarget,
    )?.recipientMemberId
    if (!memberId) {
      continue
    }
    const entries = grouped.get(memberId) ?? []
    entries.push(intent)
    grouped.set(memberId, entries)
  }
  return grouped
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

function isSafelyReplayableTerminalIntent(intent: AssistantOutboxIntent): boolean {
  return (intent.status === 'failed' || intent.status === 'abandoned')
    && intent.lastError?.code !== 'ASSISTANT_DELIVERY_AMBIGUOUS'
}

function isNonReplayableRecipientIntent(intent: AssistantOutboxIntent): boolean {
  return isActiveOutboxIntent(intent)
    || intent.status === 'sent'
    || intent.lastError?.code === 'ASSISTANT_DELIVERY_AMBIGUOUS'
}
